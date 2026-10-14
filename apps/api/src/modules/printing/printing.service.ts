import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  hasPermission,
  type PrintResult,
  type PrintSaleInput,
  type QuoteInput,
  quoteSchema,
  type ReceiptDoc,
  type ReceiptSettings,
} from '@marina/shared';
import { AppException } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { config } from '../../config';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { ReturnsService } from '../returns/returns.service';
import { SalesService } from '../sales/sales.service';
import { SettingsService } from '../settings/settings.service';
import { drawerKick, encodeReceipt, renderText } from './escpos';
import { CashRegisterService } from '../cash-register/cash-register.service';
import {
  buildDayReport,
  buildReturnReceipt,
  buildSaleReceipt,
  buildTestReceipt,
  designBlocks,
  sampleSale,
} from './receipt-builder';
import { listWindowsPrinters, PrinterError, sendToPrinter } from './transports';

const printerError = (message: string) =>
  new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'PRINTER_ERROR', message);

@Injectable()
export class PrintingService {
  private readonly logger = new Logger('Printing');

  constructor(
    private readonly sales: SalesService,
    private readonly returns: ReturnsService,
    private readonly cash: CashRegisterService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  /** The receipt as blocks, for printing from the browser. */
  async receiptDoc(saleId: string, copy: boolean, actor: Actor): Promise<ReceiptDoc> {
    const sale = await this.sales.get(saleId, actor);
    return buildSaleReceipt(sale, this.settings.all(), { copy });
  }

  async printSale(saleId: string, input: PrintSaleInput, actor: Actor): Promise<PrintResult> {
    const sale = await this.sales.get(saleId, actor);
    const doc = buildSaleReceipt(sale, this.settings.all(), { copy: input.copy });
    const target = await this.send(doc, sale.number, input.openDrawer);
    if (input.copy) {
      await this.audit.log({
        action: 'SALE_REPRINT',
        userId: actor.user.id,
        entityType: 'Sale',
        entityId: sale.id,
        summary: `Reprinted ${sale.number}`,
      });
    }
    return { printed: true, target };
  }

  /** Quotation of the bill on the screen; printed on the thermal printer when `print` is set. */
  async quote(
    input: QuoteInput,
    actor: Actor,
  ): Promise<{ doc: ReceiptDoc; printed: boolean; target?: string }> {
    const parsed = quoteSchema.parse(input);
    const sale = await this.sales.quote(parsed, actor);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + parsed.validDays);
    const doc = buildSaleReceipt(sale, this.settings.all(), { quoteValidUntil: validUntil });
    if (!parsed.print) return { doc, printed: false };
    return { doc, printed: true, target: await this.send(doc, 'quotation', false) };
  }

  /**
   * The receipt design with unsaved changes, on the latest bill (or a sample bill), for the live
   * preview in Settings → Receipt. With `print`, it also prints that preview.
   */
  async preview(
    receipt: ReceiptSettings,
    print: boolean,
    actor: Actor,
  ): Promise<{
    doc: ReceiptDoc;
    pieces: { id: string; blocks: ReceiptDoc['blocks'] }[];
    target?: string;
  }> {
    const latest = await this.sales.latestCompleted(actor);
    const settings = { ...this.settings.all(), receipt };
    const sale = latest ?? sampleSale();
    // The first copy, piece by piece, so the editor can select and move each piece.
    const pieces = designBlocks(sale, settings);
    const doc = buildSaleReceipt(sale, settings);
    if (!print) return { doc, pieces };
    return {
      doc,
      pieces,
      target: await this.send(
        { blocks: pieces.flatMap((p) => p.blocks) },
        'receipt-preview',
        false,
      ),
    };
  }

  async returnDoc(id: string, copy: boolean): Promise<ReceiptDoc> {
    return buildReturnReceipt(await this.returns.get(id), this.settings.all(), { copy });
  }

  async printReturn(id: string, copy: boolean): Promise<PrintResult> {
    const ret = await this.returns.get(id);
    // A cash refund opens the drawer, like a cash sale.
    const target = await this.send(
      buildReturnReceipt(ret, this.settings.all(), { copy }),
      ret.number,
      !copy && ret.refundMethod === 'CASH' && this.settings.get('printer').openDrawerOnCash,
    );
    return { printed: true, target };
  }

  async dayReportDoc(sessionId: string): Promise<ReceiptDoc> {
    return buildDayReport(await this.cash.summary(sessionId), this.settings.all());
  }

  async printDayReport(sessionId: string): Promise<PrintResult> {
    const doc = buildDayReport(await this.cash.summary(sessionId), this.settings.all());
    return { printed: true, target: await this.send(doc, 'day-report', false) };
  }

  async test(): Promise<PrintResult> {
    const p = this.settings.get('printer');
    const target =
      p.mode === 'windows'
        ? p.windowsPrinterName
        : p.mode === 'network'
          ? `${p.networkHost}:${p.networkPort}`
          : p.mode;
    return {
      printed: true,
      target: await this.send(buildTestReceipt(this.settings.all(), target), 'test', false),
    };
  }

  /** Open the drawer without a sale (e.g. to give change). Cashiers need an admin PIN unless allowed. */
  async openDrawer(actor: Actor): Promise<PrintResult> {
    const approverId = hasPermission(actor.user, 'drawer.open')
      ? null
      : await this.approvals.require(
          actor,
          'OPEN_DRAWER',
          'Admin approval needed to open the cash drawer',
        );
    const p = this.settings.get('printer');
    let target: string;
    try {
      target = await sendToPrinter(drawerKick(), p, {
        storageDir: config().storageDir,
        preview: '[open drawer]',
        label: 'drawer',
      });
    } catch (err) {
      throw this.toError(err);
    }
    await this.audit.log({
      action: 'DRAWER_OPEN',
      userId: actor.user.id,
      approvedById: approverId,
      summary: 'Opened the cash drawer without a sale',
    });
    return { printed: true, target };
  }

  async printers(): Promise<string[]> {
    try {
      return await listWindowsPrinters();
    } catch (err) {
      this.logger.warn(`Could not list printers: ${(err as Error).message}`);
      return [];
    }
  }

  private async send(doc: ReceiptDoc, label: string, openDrawer: boolean): Promise<string> {
    const p = this.settings.get('printer');
    const bytes = encodeReceipt(doc, {
      charsPerLine: p.charsPerLine,
      logo: p.logo,
      autoCut: p.autoCut,
      feedLines: p.feedLines,
      openDrawer,
    });
    try {
      return await sendToPrinter(bytes, p, {
        storageDir: config().storageDir,
        preview: renderText(doc, p.charsPerLine),
        label,
      });
    } catch (err) {
      throw this.toError(err);
    }
  }

  private toError(err: unknown) {
    if (err instanceof PrinterError) return printerError(err.message);
    this.logger.error(err instanceof Error ? err.stack : String(err));
    return printerError(
      'The receipt printer is not responding. Check that it is on and has paper.',
    );
  }
}

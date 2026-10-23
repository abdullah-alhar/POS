import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  estimateBlocks,
  hasPermission,
  type PrintResult,
  type PrintSaleInput,
  type QuoteInput,
  quoteSchema,
  type ReceiptDoc,
  receiptSettingsSchema,
  type SaleDto,
} from '@shoppos/shared';
import { AppException, notFound } from '../../common/app-exception';
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
  type DesignPiece,
  type SaleReceiptOptions,
} from './receipt-builder';
import { listWindowsPrinters, PrinterError, sendToPrinter } from './transports';

/** Kinds of bill the receipt editor can preview a design with. */
export const PREVIEW_SCENARIOS = [
  'latest',
  'sample',
  'cash',
  'card',
  'credit',
  'noCustomer',
  'wholesale',
  'quote',
  'reprint',
] as const;

export const receiptPreviewSchema = z.object({
  receipt: receiptSettingsSchema,
  print: z.boolean().default(false),
  /** Which bill: the latest one (default), a sample, or a bill of a kind (credit, quotation …). */
  scenario: z.enum(PREVIEW_SCENARIOS).default('latest'),
  /** Show this bill instead (its number, e.g. INV-2026-000123). */
  billNumber: z.string().trim().max(40).optional(),
  /** Try the design on other paper: 32 letters per line is 58 mm paper. */
  charsPerLine: z.union([z.literal(32), z.literal(42), z.literal(48)]).optional(),
});
export type ReceiptPreviewInput = z.infer<typeof receiptPreviewSchema>;

export interface ReceiptPreview {
  doc: ReceiptDoc;
  /** The first copy piece by piece, so the editor can select and move each piece. */
  pieces: DesignPiece[];
  /** Exactly what the receipt printer prints, as plain text. */
  text: string;
  estimate: { lines: number; mm: number };
  bill: { number: string; source: 'latest' | 'sample' | 'bill' };
  target?: string;
}

/** The same bill, paid or sold another way (only for the preview; nothing is saved). */
function asScenario(sale: SaleDto, scenario: ReceiptPreviewInput['scenario']): SaleDto {
  const one = (method: SaleDto['payments'][number]['method'], reference: string | null = null) => ({
    ...sale,
    payments: [{ method, amount: sale.total, tendered: null, reference }],
    paidTotal: sale.total,
    changeGiven: 0,
  });
  switch (scenario) {
    case 'cash':
      return sale.payments.some((p) => p.method === 'CASH')
        ? sale
        : {
            ...sale,
            payments: [
              {
                method: 'CASH',
                amount: sale.total,
                tendered: sale.total + 50_000,
                reference: null,
              },
            ],
            changeGiven: 50_000,
          };
    case 'card':
      return one('CARD', '4421');
    case 'credit':
      return {
        ...one('CREDIT'),
        customer: sale.customer ?? { id: 'c', name: 'Nimal Perera', phone: '0771234567' },
      };
    case 'noCustomer':
      return { ...sale, customer: null };
    case 'wholesale':
      return { ...sale, priceMode: 'WHOLESALE' };
    default:
      return sale;
  }
}

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
   * The receipt design with unsaved changes, for the live preview in the receipt editor: on the
   * latest bill (or a sample), a bill picked by number, or the same bill paid another way, sold
   * on credit, as a quotation or a reprint. With `print`, it also prints that preview.
   */
  async preview(input: ReceiptPreviewInput, actor: Actor): Promise<ReceiptPreview> {
    let base: SaleDto | null = null;
    let source: ReceiptPreview['bill']['source'] = 'sample';
    if (input.billNumber) {
      base = await this.sales.byNumber(input.billNumber, actor);
      if (!base) throw notFound(`Bill ${input.billNumber}`);
      source = 'bill';
    } else if (input.scenario !== 'sample') {
      base = await this.sales.latestCompleted(actor);
      if (base) source = 'latest';
    }
    const sale = asScenario(base ?? sampleSale(), input.scenario);
    const all = this.settings.all();
    const charsPerLine = input.charsPerLine ?? all.printer.charsPerLine;
    const settings = { ...all, receipt: input.receipt };
    const opts: SaleReceiptOptions = {};
    if (input.scenario === 'quote') {
      opts.quoteValidUntil = new Date();
      opts.quoteValidUntil.setDate(opts.quoteValidUntil.getDate() + 7);
    }
    if (input.scenario === 'reprint') opts.copy = true;

    const pieces = designBlocks(sale, settings, opts);
    const doc = buildSaleReceipt(sale, settings, opts);
    const result: ReceiptPreview = {
      doc,
      pieces,
      text: renderText(doc, charsPerLine),
      estimate: estimateBlocks(doc.blocks, charsPerLine),
      bill: { number: sale.number, source },
    };
    if (!input.print) return result;
    const blocks = pieces.filter((p) => !p.skipped).flatMap((p) => p.blocks);
    return { ...result, target: await this.send({ blocks }, 'receipt-preview', false) };
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

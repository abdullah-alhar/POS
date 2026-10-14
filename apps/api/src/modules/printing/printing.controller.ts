import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  printSaleSchema,
  quoteSchema,
  receiptSettingsSchema,
  type PrintSaleInput,
  type QuoteInput,
  type ReceiptSettings,
} from '@marina/shared';

const receiptPreviewSchema = z.object({
  receipt: receiptSettingsSchema,
  print: z.boolean().default(false),
});
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { CashRegisterModule } from '../cash-register/cash-register.controller';
import { ReturnsModule } from '../returns/returns.controller';
import { SalesModule } from '../sales/sales.module';
import { ZodPipe } from '../../common/zod.pipe';
import { PrintingService } from './printing.service';

@Controller()
export class PrintingController {
  constructor(private readonly printing: PrintingService) {}

  @Post('sales/:id/print')
  @HttpCode(200)
  @RequirePermissions('sales.create')
  print(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(printSaleSchema)) body: PrintSaleInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.printing.printSale(id, body, actor);
  }

  /** Receipt blocks, for printing from the browser when the thermal printer is not used. */
  @Get('sales/:id/receipt')
  @RequirePermissions('sales.create')
  receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('copy') copy: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.printing.receiptDoc(id, copy === 'true' || copy === '1', actor);
  }

  @Post('returns/:id/print')
  @HttpCode(200)
  @RequirePermissions('returns.create')
  printReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(printSaleSchema)) body: PrintSaleInput,
  ) {
    return this.printing.printReturn(id, body.copy);
  }

  @Get('returns/:id/receipt')
  @RequirePermissions('returns.create')
  returnReceipt(@Param('id', ParseUUIDPipe) id: string, @Query('copy') copy: string | undefined) {
    return this.printing.returnDoc(id, copy === 'true' || copy === '1');
  }

  @Post('cash-sessions/:id/print')
  @HttpCode(200)
  @RequirePermissions('cash.register')
  printDay(@Param('id', ParseUUIDPipe) id: string) {
    return this.printing.printDayReport(id);
  }

  @Get('cash-sessions/:id/receipt')
  @RequirePermissions('cash.register')
  dayReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.printing.dayReportDoc(id);
  }

  @Post('printing/open-drawer')
  @HttpCode(200)
  @RequirePermissions('sales.create')
  openDrawer(@CurrentActor() actor: Actor) {
    return this.printing.openDrawer(actor);
  }

  /** Print the bill on the screen as a quotation (nothing is saved). */
  @Post('sales/quote')
  @HttpCode(200)
  @RequirePermissions('sales.create')
  quote(@Body(new ZodPipe(quoteSchema)) body: QuoteInput, @CurrentActor() actor: Actor) {
    return this.printing.quote(body, actor);
  }

  /** Live preview of an unsaved receipt design (and "print this preview"). */
  @Post('printing/receipt-preview')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  preview(
    @Body(new ZodPipe(receiptPreviewSchema)) body: { receipt: ReceiptSettings; print: boolean },
    @CurrentActor() actor: Actor,
  ) {
    return this.printing.preview(body.receipt, body.print, actor);
  }

  @Post('printing/test')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  test() {
    return this.printing.test();
  }

  @Get('printers')
  @RequirePermissions('settings.manage')
  async printers() {
    return { printers: await this.printing.printers() };
  }
}

@Module({
  imports: [SalesModule, ReturnsModule, CashRegisterModule],
  controllers: [PrintingController],
  providers: [PrintingService],
})
export class PrintingModule {}

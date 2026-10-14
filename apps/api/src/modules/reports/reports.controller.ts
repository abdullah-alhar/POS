import { Controller, Get, Module, Query } from '@nestjs/common';
import {
  productReportQuerySchema,
  reportRangeSchema,
  salesReportQuerySchema,
  type ProductReportQuery,
  type ReportRange,
  type SalesReportQuery,
} from '@marina/shared';
import { RequirePermissions } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { ReportsService } from './reports.service';

@Controller('reports')
@RequirePermissions('reports.view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('sales')
  sales(@Query(new ZodPipe(salesReportQuerySchema)) q: SalesReportQuery) {
    return this.reports.sales(q, q.groupBy);
  }

  @Get('products')
  products(@Query(new ZodPipe(productReportQuerySchema)) q: ProductReportQuery) {
    return this.reports.products(q);
  }

  @Get('stock-value')
  stockValue() {
    return this.reports.stockValue();
  }

  @Get('cashiers')
  cashiers(@Query(new ZodPipe(reportRangeSchema)) q: ReportRange) {
    return this.reports.cashiers(q);
  }

  @Get('payments')
  payments(@Query(new ZodPipe(reportRangeSchema)) q: ReportRange) {
    return this.reports.payments(q);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

import { Module } from '@nestjs/common';
import { CashRegisterModule } from '../cash-register/cash-register.controller';
import { HeldBillsService } from './held-bills.service';
import { HeldBillsController, SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [CashRegisterModule],
  controllers: [SalesController, HeldBillsController],
  providers: [SalesService, HeldBillsService],
  exports: [SalesService],
})
export class SalesModule {}

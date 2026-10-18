import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  supplierInputSchema,
  supplierPaymentSchema,
  type SupplierInput,
  type SupplierPaymentInput,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
@RequirePermissions('purchases.manage')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list() {
    return this.suppliers.list();
  }

  @Post()
  create(
    @Body(new ZodPipe(supplierInputSchema)) body: SupplierInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.suppliers.save(null, body, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(supplierInputSchema)) body: SupplierInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.suppliers.save(id, body, actor);
  }

  @Get(':id/payments')
  payments(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.payments(id);
  }

  @Post(':id/payments')
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(supplierPaymentSchema)) body: SupplierPaymentInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.suppliers.pay(id, body, actor);
  }
}

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}

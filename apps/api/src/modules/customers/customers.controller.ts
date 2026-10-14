import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  customerAdjustSchema,
  customerInputSchema,
  customerPaymentSchema,
  customerQuerySchema,
  pageQuerySchema,
  type CustomerAdjustInput,
  type CustomerInput,
  type CustomerPaymentInput,
  type CustomerQuery,
} from '@marina/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** Also used by the till to find a customer by name or phone. */
  @Get()
  @RequirePermissions('sales.create')
  list(@Query(new ZodPipe(customerQuerySchema)) query: CustomerQuery) {
    return this.customers.list(query);
  }

  @Get(':id')
  @RequirePermissions('sales.create')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(
    @Body(new ZodPipe(customerInputSchema)) body: CustomerInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.customers.save(null, body, actor);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(customerInputSchema)) body: CustomerInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.customers.save(id, body, actor);
  }

  @Get(':id/ledger')
  @RequirePermissions('customers.manage')
  ledger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(pageQuerySchema)) q: { page: number; pageSize: number },
  ) {
    return this.customers.ledger(id, q.page, q.pageSize);
  }

  @Get(':id/sales')
  @RequirePermissions('customers.manage')
  sales(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.sales(id);
  }

  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermissions('customers.credit')
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(customerPaymentSchema)) body: CustomerPaymentInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.customers.receivePayment(id, body, actor);
  }

  @Post(':id/adjust')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(customerAdjustSchema)) body: CustomerAdjustInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.customers.adjust(id, body, actor);
  }
}

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}

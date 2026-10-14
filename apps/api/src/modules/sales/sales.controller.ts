import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  checkoutSchema,
  holdBillSchema,
  saleQuerySchema,
  voidSaleSchema,
  type CheckoutInput,
  type HoldBillInput,
  type SaleQuery,
  type VoidSaleInput,
} from '@marina/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { HeldBillsService } from './held-bills.service';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** Save a bill (checkout). Safe to retry: the same clientId never makes two bills. */
  @Post()
  @RequirePermissions('sales.create')
  checkout(@Body(new ZodPipe(checkoutSchema)) body: CheckoutInput, @CurrentActor() actor: Actor) {
    return this.sales.checkout(body, actor);
  }

  @Get()
  @RequirePermissions('sales.create')
  list(@Query(new ZodPipe(saleQuerySchema)) query: SaleQuery, @CurrentActor() actor: Actor) {
    return this.sales.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions('sales.create')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.sales.get(id, actor);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('sales.create')
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(voidSaleSchema)) body: VoidSaleInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.sales.void(id, body, actor);
  }
}

@Controller('held-bills')
@RequirePermissions('sales.create')
export class HeldBillsController {
  constructor(private readonly held: HeldBillsService) {}

  @Get()
  list() {
    return this.held.list();
  }

  @Post()
  hold(@Body(new ZodPipe(holdBillSchema)) body: HoldBillInput, @CurrentActor() actor: Actor) {
    return this.held.hold(body, actor);
  }

  @Post(':id/recall')
  @HttpCode(200)
  recall(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.held.recall(id, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  async discard(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    await this.held.discard(id, actor);
  }
}

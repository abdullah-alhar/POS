import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import {
  movementQuerySchema,
  pageQuerySchema,
  stockAdjustmentSchema,
  type MovementQuery,
  type StockAdjustmentInput,
} from '@marina/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { InventoryService } from './inventory.service';

@Controller('stock')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('movements')
  @RequirePermissions('products.view')
  movements(@Query(new ZodPipe(movementQuerySchema)) query: MovementQuery) {
    return this.inventory.movements(query);
  }

  @Get('low-stock')
  @RequirePermissions('products.view')
  lowStock() {
    return this.inventory.lowStock();
  }

  @Get('adjustments')
  @RequirePermissions('products.view')
  adjustments(@Query(new ZodPipe(pageQuerySchema)) query: { page: number; pageSize: number }) {
    return this.inventory.adjustments(query.page, query.pageSize);
  }

  @Post('adjustments')
  @RequirePermissions('stock.adjust')
  adjust(
    @Body(new ZodPipe(stockAdjustmentSchema)) body: StockAdjustmentInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.inventory.adjust(body, actor);
  }
}

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}

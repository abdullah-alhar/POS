import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  purchaseInputSchema,
  purchaseQuerySchema,
  type PurchaseInput,
  type PurchaseQuery,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { PurchasesService } from './purchases.service';

@Controller('purchases')
@RequirePermissions('purchases.manage')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(@Query(new ZodPipe(purchaseQuerySchema)) query: PurchaseQuery) {
    return this.purchases.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.get(id);
  }

  @Post()
  create(
    @Body(new ZodPipe(purchaseInputSchema)) body: PurchaseInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.purchases.create(body, actor);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(purchaseInputSchema)) body: PurchaseInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.purchases.update(id, body, actor);
  }

  @Post(':id/receive')
  @HttpCode(200)
  receive(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.purchases.receive(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.purchases.cancel(id, actor);
  }
}

@Module({
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}

import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  returnInputSchema,
  returnQuerySchema,
  type ReturnInput,
  type ReturnQuery,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { ReturnsService } from './returns.service';

@Controller()
@RequirePermissions('returns.create')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  /** What can be returned from a bill; accepts the bill id or its number (scan the receipt). */
  @Get('sales/:idOrNumber/returnable')
  returnable(@Param('idOrNumber') idOrNumber: string, @CurrentActor() actor: Actor) {
    return this.returns.returnable(idOrNumber, actor);
  }

  @Get('returns')
  list(@Query(new ZodPipe(returnQuerySchema)) query: ReturnQuery) {
    return this.returns.list(query);
  }

  @Get('returns/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.returns.get(id);
  }

  @Post('returns')
  create(@Body(new ZodPipe(returnInputSchema)) body: ReturnInput, @CurrentActor() actor: Actor) {
    return this.returns.create(body, actor);
  }
}

@Module({
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}

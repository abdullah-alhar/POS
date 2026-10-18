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
import {
  cashMovementSchema,
  closeDaySchema,
  openCashSessionSchema,
  pageQuerySchema,
  type CashMovementInput,
  type CloseDayInput,
  type OpenCashSessionInput,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { CashRegisterService } from './cash-register.service';

@Controller('cash-sessions')
export class CashRegisterController {
  constructor(private readonly cash: CashRegisterService) {}

  @Get('current')
  async current() {
    return { session: await this.cash.current() };
  }

  @Get('current/summary')
  @RequirePermissions('cash.register')
  async currentSummary() {
    return { summary: await this.cash.currentSummary() };
  }

  @Post('open')
  @RequirePermissions('cash.register')
  open(
    @Body(new ZodPipe(openCashSessionSchema)) body: OpenCashSessionInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.cash.open(body, actor);
  }

  @Post('current/movements')
  @HttpCode(200)
  @RequirePermissions('cash.register')
  movement(
    @Body(new ZodPipe(cashMovementSchema)) body: CashMovementInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.cash.movement(body, actor);
  }

  @Post('current/close')
  @HttpCode(200)
  @RequirePermissions('cash.register')
  close(@Body(new ZodPipe(closeDaySchema)) body: CloseDayInput, @CurrentActor() actor: Actor) {
    return this.cash.close(body, actor);
  }

  @Get()
  @RequirePermissions('reports.view')
  list(@Query(new ZodPipe(pageQuerySchema)) q: { page: number; pageSize: number }) {
    return this.cash.list(q.page, q.pageSize);
  }

  @Get(':id')
  @RequirePermissions('cash.register')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.cash.summary(id);
  }
}

@Module({
  controllers: [CashRegisterController],
  providers: [CashRegisterService],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}

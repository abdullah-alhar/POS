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
  cancelSchema,
  expenseInputSchema,
  expenseQuerySchema,
  type CancelInput,
  type ExpenseInput,
  type ExpenseQuery,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@RequirePermissions('expenses.manage')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query(new ZodPipe(expenseQuerySchema)) query: ExpenseQuery) {
    return this.expenses.list(query);
  }

  @Get('categories')
  categories() {
    return this.expenses.categories();
  }

  @Post()
  create(@Body(new ZodPipe(expenseInputSchema)) body: ExpenseInput, @CurrentActor() actor: Actor) {
    return this.expenses.create(body, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(cancelSchema)) body: CancelInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.expenses.cancel(id, body.reason, actor);
  }
}

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}

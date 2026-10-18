import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createUserSchema,
  resetCredentialsSchema,
  updateUserSchema,
  type CreateUserInput,
  type ResetCredentialsInput,
  type UpdateUserInput,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { UsersService } from './users.service';

@Controller('users')
@RequirePermissions('users.manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.users.list(actor);
  }

  @Post()
  create(@Body(new ZodPipe(createUserSchema)) body: CreateUserInput, @CurrentActor() actor: Actor) {
    return this.users.create(body, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.users.update(id, body, actor);
  }

  @Post(':id/reset-credentials')
  @HttpCode(204)
  async resetCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetCredentialsSchema)) body: ResetCredentialsInput,
    @CurrentActor() actor: Actor,
  ) {
    await this.users.resetCredentials(id, body, actor);
  }
}

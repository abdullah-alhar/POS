import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  approveSchema,
  changePasswordSchema,
  changePinSchema,
  loginSchema,
  pinLoginSchema,
  updateAvatarSchema,
  type ApproveInput,
  type ChangePasswordInput,
  type ChangePinInput,
  type LoginInput,
  type PinLoginInput,
  type UpdateAvatarInput,
} from '@shoppos/shared';
import { CurrentActor, Public, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { ApprovalsService } from './approvals.service';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Public()
  @Get('tiles')
  tiles() {
    return this.auth.tiles();
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.loginWithPassword(body, res, req.ip);
  }

  @Public()
  @Post('pin-login')
  @HttpCode(200)
  pinLogin(
    @Body(new ZodPipe(pinLoginSchema)) body: PinLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.loginWithPin(body, res, req.ip);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.user ? { user: req.user, approvalTokens: [] } : null, res);
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    const { tokenVersion: _, ...user } = actor.user;
    return user;
  }

  /** Any user can set or remove their own profile photo. */
  @Put('me/avatar')
  @HttpCode(204)
  async updateAvatar(
    @Body(new ZodPipe(updateAvatarSchema)) body: UpdateAvatarInput,
    @CurrentActor() actor: Actor,
  ) {
    await this.auth.updateAvatar(body, actor);
  }

  @Post('approve')
  @HttpCode(200)
  approve(@Body(new ZodPipe(approveSchema)) body: ApproveInput, @CurrentActor() actor: Actor) {
    return this.approvals.approve(body, actor);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(body, actor, res);
  }

  @Post('change-pin')
  @HttpCode(204)
  async changePin(
    @Body(new ZodPipe(changePinSchema)) body: ChangePinInput,
    @CurrentActor() actor: Actor,
  ) {
    await this.auth.changePin(body, actor);
  }
}

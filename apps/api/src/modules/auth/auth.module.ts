import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../../config';
import { ApprovalsService } from './approvals.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => ({ secret: config().jwtSecret }) })],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    ApprovalsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [ApprovalsService, SessionService],
})
export class AuthModule {}

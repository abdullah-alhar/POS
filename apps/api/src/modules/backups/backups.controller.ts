import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  driveConnectSchema,
  restoreBackupSchema,
  type DriveConnectInput,
  type RestoreBackupInput,
} from '@shoppos/shared';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { CashRegisterModule } from '../cash-register/cash-register.controller';
import { BackupsService } from './backups.service';

@Controller('backups')
@RequirePermissions('backups.manage')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Get('status')
  status() {
    return this.backups.status();
  }

  @Get('usb')
  usb() {
    return this.backups.usbFiles();
  }

  @Post()
  create(@CurrentActor() actor: Actor) {
    return this.backups.create('MANUAL', actor);
  }

  @Post('sync')
  @HttpCode(200)
  sync() {
    return this.backups.syncOffsite();
  }

  @Post('restore')
  @HttpCode(200)
  restore(
    @Body(new ZodPipe(restoreBackupSchema)) body: RestoreBackupInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.backups.restore(body, actor);
  }

  @Get('files/:name')
  download(@Param('name') name: string) {
    return new StreamableFile(this.backups.download(name), {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${name}"`,
    });
  }

  @Post('drive/connect')
  @HttpCode(200)
  connectDrive(
    @Body(new ZodPipe(driveConnectSchema)) body: DriveConnectInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.backups.connectDrive(body, actor);
  }

  @Post('drive/disconnect')
  @HttpCode(200)
  disconnectDrive(@CurrentActor() actor: Actor) {
    return this.backups.disconnectDrive(actor);
  }
}

@Module({
  imports: [CashRegisterModule],
  controllers: [BackupsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}

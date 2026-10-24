import { Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { CurrentActor, type Actor } from '../../common/decorators';
import { InventoryModule } from '../inventory/inventory.controller';
import { NotificationsService } from './notifications.service';

/** The bell in the sidebar: for every signed-in user, each seeing only what they may. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.notifications.list(actor);
  }

  /** The bell was opened: everything up to now is read. */
  @Post('seen')
  @HttpCode(204)
  async seen(@CurrentActor() actor: Actor) {
    await this.notifications.markSeen(actor);
  }
}

@Module({
  imports: [InventoryModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}

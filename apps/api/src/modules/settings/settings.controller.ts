import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  hasPermission,
  SECTION_PERMISSION,
  SETTINGS_SCHEMAS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '@marina/shared';
import { badRequest, forbidden } from '../../common/app-exception';
import { CurrentActor, Public, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all() {
    return this.settings.all();
  }

  @Public()
  @Get('public')
  publicSettings() {
    return this.settings.public();
  }

  /** Most sections need settings.manage; branding is for the Super Admin only. */
  @Put(':section')
  update(@Param('section') section: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    if (!SETTINGS_SECTIONS.includes(section as SettingsSection)) {
      throw badRequest(`Unknown settings section "${section}"`);
    }
    const key = section as SettingsSection;
    if (!hasPermission(actor.user, SECTION_PERMISSION[key] ?? 'settings.manage')) {
      throw forbidden(
        key === 'branding'
          ? 'Only the Super Admin can change the logo and colours'
          : 'You do not have permission to change settings',
      );
    }
    const value = new ZodPipe(SETTINGS_SCHEMAS[key]).transform(body);
    return this.settings.update(key, value as never, actor);
  }
}

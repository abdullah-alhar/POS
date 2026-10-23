import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  hasPermission,
  SECTION_PERMISSION,
  SETTINGS_SCHEMAS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '@shoppos/shared';
import { badRequest, forbidden } from '../../common/app-exception';
import { CurrentActor, Public, RequirePermissions, type Actor } from '../../common/decorators';
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

  /** Earlier versions (from the audit log), to compare with now and restore. */
  @Get('history')
  @RequirePermissions('settings.manage')
  history(@Query('section') section?: string, @Query('limit') limit?: string) {
    if (section && !SETTINGS_SECTIONS.includes(section as SettingsSection)) {
      throw badRequest(`Unknown settings section "${section}"`);
    }
    const take = Math.min(100, Math.max(1, Number(limit) || 30));
    return this.settings.history(section as SettingsSection | undefined, take);
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

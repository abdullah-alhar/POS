import { Controller, Get, HttpCode, HttpStatus, Logger, Module, Post } from '@nestjs/common';
import { isAdminRole } from '@marina/shared';
import { AppException } from '../../common/app-exception';
import { CurrentActor, Public, type Actor } from '../../common/decorators';
import { runPowerShell } from '../../common/powershell';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_VERSION } from '../../version';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';

/**
 * Closes the kiosk browser window. Only browser processes started with the POS's own profile
 * folder (…\MarinaPOS\chrome) are stopped, so other Chrome/Edge windows are left alone.
 */
const CLOSE_KIOSK_SCRIPT = `
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*MarinaPOS\\chrome*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;

@Controller()
export class SystemController {
  private readonly logger = new Logger('System');

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  /** Used by the Windows start script to wait until the POS is ready. */
  @Public()
  @Get('health')
  async health() {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version: APP_VERSION,
      time: new Date(),
    };
  }

  /**
   * "Exit POS": closes the full-screen window so the computer can be used for something else.
   * Admins can do it; a cashier needs an admin PIN (so staff cannot leave the till on their own).
   */
  @Post('system/exit-kiosk')
  @HttpCode(200)
  async exitKiosk(@CurrentActor() actor: Actor) {
    const approvedBy = isAdminRole(actor.user.role)
      ? null
      : await this.approvals.require(
          actor,
          'EXIT_POS',
          'Admin approval needed to close the POS screen',
        );
    if (process.platform !== 'win32') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'BAD_REQUEST',
        'Closing the POS window only works on the shop computer. Press Alt+F4 to close this window.',
      );
    }
    await this.audit.log({
      action: 'POS_EXIT',
      userId: actor.user.id,
      approvedById: approvedBy,
      summary: `${actor.user.fullName} closed the full-screen POS`,
    });
    // Answer first, then close the window a moment later.
    setTimeout(() => {
      runPowerShell(CLOSE_KIOSK_SCRIPT).catch((err: unknown) =>
        this.logger.warn(`Could not close the kiosk window: ${(err as Error).message}`),
      );
    }, 400);
    return { closing: true };
  }
}

@Module({ controllers: [SystemController] })
export class SystemModule {}

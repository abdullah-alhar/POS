import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  APPROVAL_ACTIONS,
  isAdminRole,
  type ApprovalAction,
  type ApprovalResult,
  type ApproveInput,
} from '@marina/shared';
import { approvalRequired, forbidden } from '../../common/app-exception';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AttemptLimiter } from './attempt-limiter';
import { APPROVAL_TOKEN_SECONDS, type ApprovalPayload } from './auth.types';
import { verifySecret } from './password';

/**
 * Admin approval: an admin types their PIN on the cashier's screen and the cashier gets a
 * short-lived, single-use token for one action.
 */
export interface ApprovalNeed {
  action: ApprovalAction;
  message?: string;
}

@Injectable()
export class ApprovalsService {
  private readonly usedTokens = new Map<string, number>();
  private readonly limiter = new AttemptLimiter(5, 5 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Does this user need an admin's approval for this action right now? */
  needsApproval(actor: Actor, action: ApprovalAction): boolean {
    if (isAdminRole(actor.user.role)) return false;
    return this.settings.get('approvals').requireApprovalFor.includes(action);
  }

  async approve(input: ApproveInput, actor: Actor): Promise<ApprovalResult> {
    const limiterKey = `approve:${actor.user.id}`;
    this.limiter.assertAllowed(limiterKey);

    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      // Try the shop's own admins first.
      orderBy: { role: 'asc' },
    });
    let approver: (typeof admins)[number] | undefined;
    for (const admin of admins) {
      if (await verifySecret(input.pin, admin.pinHash)) {
        approver = admin;
        break;
      }
    }
    if (!approver) {
      this.limiter.fail(limiterKey);
      await this.audit.log({
        action: 'APPROVAL_DENIED',
        userId: actor.user.id,
        summary: `Wrong admin PIN for: ${APPROVAL_ACTIONS[input.action]}`,
        meta: { action: input.action, note: input.note, ip: actor.ip },
      });
      throw forbidden('Wrong admin PIN');
    }
    this.limiter.reset(limiterKey);

    const payload: ApprovalPayload = {
      typ: 'approval',
      sub: approver.id,
      act: input.action,
      req: actor.user.id,
      jti: randomUUID(),
    };
    const token = await this.jwt.signAsync(payload, { expiresIn: APPROVAL_TOKEN_SECONDS });
    await this.audit.log({
      action: 'APPROVAL_GRANTED',
      userId: actor.user.id,
      approvedById: approver.id,
      summary: `${approver.fullName} approved: ${APPROVAL_ACTIONS[input.action]}`,
      meta: { action: input.action, note: input.note },
    });
    return {
      token,
      approvedBy: { id: approver.id, fullName: approver.fullName },
      expiresAt: new Date(Date.now() + APPROVAL_TOKEN_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Call before doing a protected action. Returns the id of the approving admin, or null when
   * no approval was needed. Throws APPROVAL_REQUIRED when the browser must ask for an admin PIN.
   * The token is used up by this call.
   */
  async require(actor: Actor, action: ApprovalAction, message?: string): Promise<string | null> {
    const result = await this.requireAll(actor, [{ action, message }]);
    return result[action] ?? null;
  }

  /**
   * Like require(), for an operation that may need several approvals (e.g. a checkout with a
   * price override and a big discount). Tokens are only used up when every approval is present,
   * so the browser can collect them one by one and resend the request.
   */
  async requireAll(
    actor: Actor,
    needs: ApprovalNeed[],
  ): Promise<Partial<Record<ApprovalAction, string | null>>> {
    const result: Partial<Record<ApprovalAction, string | null>> = {};
    const pending = needs.filter((n) => {
      if (this.needsApproval(actor, n.action)) return true;
      result[n.action] = null;
      return false;
    });
    if (!pending.length) return result;

    this.pruneUsed();
    const tokens = await this.validTokens(actor);
    const chosen: ApprovalPayload[] = [];
    for (const need of pending) {
      const match = tokens.find((t) => t.act === need.action && !chosen.includes(t));
      if (!match) {
        throw approvalRequired(
          need.action,
          need.message ?? `Admin approval needed: ${APPROVAL_ACTIONS[need.action]}`,
        );
      }
      chosen.push(match);
      result[need.action] = match.sub;
    }
    for (const t of chosen) this.usedTokens.set(t.jti, (t.exp ?? 0) * 1000);
    return result;
  }

  /** Approval tokens sent with this request that are genuine, unexpired, unused and for this user. */
  private async validTokens(actor: Actor): Promise<ApprovalPayload[]> {
    const valid: ApprovalPayload[] = [];
    for (const raw of actor.approvalTokens) {
      try {
        const p = await this.jwt.verifyAsync<ApprovalPayload>(raw);
        if (p.typ === 'approval' && p.req === actor.user.id && !this.usedTokens.has(p.jti)) {
          valid.push(p);
        }
      } catch {
        // Expired or forged: ignore; the request will ask for approval again.
      }
    }
    return valid;
  }

  private pruneUsed() {
    const now = Date.now();
    for (const [jti, exp] of this.usedTokens) if (exp < now) this.usedTokens.delete(jti);
  }
}

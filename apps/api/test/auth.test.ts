import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createUser,
  loginAs,
  resetDb,
  sampleProduct,
  standardUsers,
  startApp,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await resetDb(ctx);
});

describe('login', () => {
  it('blocks API calls without a session', async () => {
    const res = await ctx.http().get('/api/products').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('logs in with a password and sets an httpOnly cookie', async () => {
    await createUser(ctx, { username: 'owner', role: 'ADMIN' });
    const agent = ctx.http();
    const res = await agent
      .post('/api/auth/login')
      .send({ username: 'Owner', password: 'secret123' })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('pos_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.username).toBe('owner');
    expect(me.body.role).toBe('ADMIN');
  });

  it('logs in with a PIN', async () => {
    const user = await createUser(ctx, { username: 'nimal', pin: '4321' });
    const agent = ctx.http();
    await agent.post('/api/auth/pin-login').send({ userId: user.id, pin: '4321' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('locks a user after 5 wrong PINs', async () => {
    const user = await createUser(ctx, { username: 'nimal', pin: '4321' });
    for (let i = 0; i < 5; i++) {
      await ctx
        .http()
        .post('/api/auth/pin-login')
        .send({ userId: user.id, pin: '0000' })
        .expect(401);
    }
    const res = await ctx.http().post('/api/auth/pin-login').send({ userId: user.id, pin: '4321' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('records failed and successful logins in the audit log', async () => {
    await createUser(ctx, { username: 'owner', role: 'ADMIN' });
    await ctx
      .http()
      .post('/api/auth/login')
      .send({ username: 'owner', password: 'bad' })
      .expect(401);
    await loginAs(ctx, 'owner');
    const actions = (await ctx.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['LOGIN_FAILED', 'LOGIN']);
  });

  it('kicks out a user as soon as they are deactivated', async () => {
    const { adminHttp, cashier, cashierHttp } = await standardUsers(ctx);
    await cashierHttp.get('/api/auth/me').expect(200);
    await adminHttp.patch(`/api/users/${cashier.id}`).send({ isActive: false }).expect(200);
    await cashierHttp.get('/api/auth/me').expect(401);
  });

  it('ends other sessions when the password changes', async () => {
    await createUser(ctx, { username: 'owner', role: 'ADMIN' });
    const first = await loginAs(ctx, 'owner');
    const second = await loginAs(ctx, 'owner');
    await second
      .post('/api/auth/change-password')
      .send({ currentPassword: 'secret123', newPassword: 'newpass456' })
      .expect(204);
    await second.get('/api/auth/me').expect(200);
    await first.get('/api/auth/me').expect(401);
  });
});

describe('permissions', () => {
  it('stops cashiers from managing users', async () => {
    const { cashierHttp } = await standardUsers(ctx);
    const res = await cashierHttp.get('/api/users').expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('keeps at least one active admin', async () => {
    const { admin, adminHttp } = await standardUsers(ctx);
    const res = await adminHttp
      .patch(`/api/users/${admin.id}`)
      .send({ isActive: false })
      .expect(400);
    expect(res.body.message).toMatch(/yourself/);
  });
});

describe('admin approval', () => {
  async function productWithPrice(ctx: TestContext) {
    const { adminHttp, ...rest } = await standardUsers(ctx);
    const res = await adminHttp.post('/api/products').send(sampleProduct()).expect(201);
    return { ...rest, adminHttp, product: res.body };
  }

  it('lets an admin change prices without a PIN', async () => {
    const { adminHttp, product } = await productWithPrice(ctx);
    const variant = product.variants[0];
    const res = await adminHttp
      .patch(`/api/variants/${variant.id}/prices`)
      .send({ retailPrice: 390_000 })
      .expect(200);
    expect(res.body.retailPrice).toBe(390_000);
  });

  it('asks for an admin PIN when a cashier changes a price', async () => {
    const { cashierHttp, admin, product } = await productWithPrice(ctx);
    const variant = product.variants[0];

    const blocked = await cashierHttp
      .patch(`/api/variants/${variant.id}/prices`)
      .send({ retailPrice: 390_000 })
      .expect(403);
    expect(blocked.body.code).toBe('APPROVAL_REQUIRED');
    expect(blocked.body.details.action).toBe('PRICE_CHANGE');

    await cashierHttp
      .post('/api/auth/approve')
      .send({ action: 'PRICE_CHANGE', pin: '0000' })
      .expect(403);

    const approval = await cashierHttp
      .post('/api/auth/approve')
      .send({ action: 'PRICE_CHANGE', pin: '9999', note: 'test' })
      .expect(200);
    expect(approval.body.approvedBy.id).toBe(admin.id);

    await cashierHttp
      .patch(`/api/variants/${variant.id}/prices`)
      .set('x-approval-token', approval.body.token)
      .send({ retailPrice: 390_000 })
      .expect(200);

    // The same approval cannot be used twice.
    const reused = await cashierHttp
      .patch(`/api/variants/${variant.id}/prices`)
      .set('x-approval-token', approval.body.token)
      .send({ retailPrice: 380_000 })
      .expect(403);
    expect(reused.body.code).toBe('APPROVAL_REQUIRED');

    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'PRICE_CHANGE' } });
    expect(log.approvedById).toBe(admin.id);
    expect(log.summary).toContain('Rs 4,500.00 → Rs 3,900.00');
  });

  it('does not accept an approval given for a different action', async () => {
    const { cashierHttp, product } = await productWithPrice(ctx);
    const approval = await cashierHttp
      .post('/api/auth/approve')
      .send({ action: 'VOID_SALE', pin: '9999' })
      .expect(200);
    await cashierHttp
      .patch(`/api/variants/${product.variants[0].id}/prices`)
      .set('x-approval-token', approval.body.token)
      .send({ retailPrice: 1 })
      .expect(403);
  });

  it('skips approval when the owner turned it off for price changes', async () => {
    const { adminHttp, cashierHttp, product } = await productWithPrice(ctx);
    await adminHttp
      .put('/api/settings/approvals')
      .send({ cashierMaxDiscountBp: 1000, requireApprovalFor: ['VOID_SALE'] })
      .expect(200);
    await cashierHttp
      .patch(`/api/variants/${product.variants[0].id}/prices`)
      .send({ retailPrice: 390_000 })
      .expect(200);
  });
});

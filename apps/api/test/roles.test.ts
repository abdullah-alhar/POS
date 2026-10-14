import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@marina/shared';
import { createUser, loginAs, resetDb, standardUsers, startApp, type TestContext } from './helpers';

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

// 1×1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function withSuperAdmin(ctx: TestContext) {
  const users = await standardUsers(ctx);
  const superAdmin = await createUser(ctx, { username: 'maker', role: 'SUPER_ADMIN', pin: '7777' });
  return { ...users, superAdmin, superHttp: await loginAs(ctx, 'maker') };
}

describe('Super Admin', () => {
  it('is hidden from the login tiles and from the shop admin', async () => {
    const { adminHttp, superAdmin } = await withSuperAdmin(ctx);
    const tiles = await ctx.http().get('/api/auth/tiles').expect(200);
    expect(tiles.body.map((t: { fullName: string }) => t.fullName).sort()).toEqual([
      'Cash',
      'Owner',
    ]);

    const list = await adminHttp.get('/api/users').expect(200);
    expect(list.body.find((u: { id: string }) => u.id === superAdmin.id)).toBeUndefined();
    await adminHttp.patch(`/api/users/${superAdmin.id}`).send({ isActive: false }).expect(404);
    await adminHttp
      .post(`/api/users/${superAdmin.id}/reset-credentials`)
      .send({ pin: '1234' })
      .expect(404);
  });

  it('cannot be created by the shop admin', async () => {
    const { adminHttp, superHttp } = await withSuperAdmin(ctx);
    const user = {
      username: 'maker2',
      fullName: 'Maker Two',
      role: 'SUPER_ADMIN',
      password: 'secret123',
      pin: '1234',
    };
    await adminHttp.post('/api/users').send(user).expect(403);
    await superHttp.post('/api/users').send(user).expect(201);
  });

  it('is the only one who can change branding', async () => {
    const { adminHttp, superHttp } = await withSuperAdmin(ctx);
    const branding = {
      ...DEFAULT_SETTINGS.branding,
      appName: 'Other Shop',
      primaryColor: '#2563EB',
    };

    const denied = await adminHttp.put('/api/settings/branding').send(branding).expect(403);
    expect(denied.body.message).toMatch(/Super Admin/);

    const saved = await superHttp.put('/api/settings/branding').send(branding).expect(200);
    expect(saved.body.primaryColor).toBe('#2563eb');
    const pub = await ctx.http().get('/api/settings/public').expect(200);
    expect(pub.body.branding.appName).toBe('Other Shop');

    // The shop admin still manages normal settings.
    await adminHttp
      .put('/api/settings/shop')
      .send({ name: 'Marina Cellular', address: 'Colombo', phone: '', email: '' })
      .expect(200);
  });

  it('cannot give branding rights to a cashier', async () => {
    const { adminHttp, cashier } = await withSuperAdmin(ctx);
    const res = await adminHttp
      .patch(`/api/users/${cashier.id}`)
      .send({ permissions: ['sales.create', 'branding.manage'] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('can approve cashier actions with their PIN', async () => {
    const { cashierHttp, superAdmin } = await withSuperAdmin(ctx);
    const res = await cashierHttp
      .post('/api/auth/approve')
      .send({ action: 'PRICE_CHANGE', pin: '7777' })
      .expect(200);
    expect(res.body.approvedBy.id).toBe(superAdmin.id);
  });
});

describe('profile photos', () => {
  it('lets any user set and remove their own photo', async () => {
    const { cashierHttp, cashier } = await standardUsers(ctx);
    await cashierHttp.put('/api/auth/me/avatar').send({ avatar: PNG }).expect(204);
    expect((await cashierHttp.get('/api/auth/me').expect(200)).body.avatar).toBe(PNG);

    const tiles = await ctx.http().get('/api/auth/tiles').expect(200);
    expect(tiles.body.find((t: { id: string }) => t.id === cashier.id).avatar).toBe(PNG);

    await cashierHttp.put('/api/auth/me/avatar').send({ avatar: null }).expect(204);
    expect((await cashierHttp.get('/api/auth/me').expect(200)).body.avatar).toBeNull();
  });

  it('rejects files that are not images', async () => {
    const { cashierHttp } = await standardUsers(ctx);
    const res = await cashierHttp
      .put('/api/auth/me/avatar')
      .send({ avatar: 'data:text/html;base64,PHNjcmlwdD4=' })
      .expect(400);
    expect(res.body.message).toMatch(/PNG, JPEG or WebP/);
  });

  it('lets the admin set a photo for a user, without storing it in the audit log', async () => {
    const { adminHttp, cashier } = await standardUsers(ctx);
    const res = await adminHttp.patch(`/api/users/${cashier.id}`).send({ avatar: PNG }).expect(200);
    expect(res.body.avatar).toBe(PNG);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_UPDATE' } });
    expect(JSON.stringify(log.after)).toContain('[photo]');
    expect(JSON.stringify(log.after)).not.toContain('base64');
  });
});

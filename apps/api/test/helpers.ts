import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { DEFAULT_CASHIER_PERMISSIONS, type Permission } from '@shoppos/shared';
import { createApp } from '../src/bootstrap';
import { hashSecret } from '../src/modules/auth/password';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => TestAgent;
}

export async function startApp(): Promise<TestContext> {
  const app = await createApp({ logger: false });
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request.agent(app.getHttpServer()),
  };
}

/** Empty every table (TRUNCATE skips the delete-protection triggers) and reload settings. */
export async function resetDb(ctx: TestContext) {
  const tables = await ctx.prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await ctx.prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await ctx.app.get(SettingsService).reload();
}

export async function createUser(
  ctx: TestContext,
  opts: {
    username: string;
    role?: 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER';
    password?: string;
    pin?: string;
    permissions?: Permission[];
  },
) {
  return ctx.prisma.user.create({
    data: {
      username: opts.username,
      fullName: opts.username[0]!.toUpperCase() + opts.username.slice(1),
      role: opts.role ?? 'CASHIER',
      passwordHash: await hashSecret(opts.password ?? 'secret123'),
      pinHash: await hashSecret(opts.pin ?? '1111'),
      permissions: opts.permissions ?? DEFAULT_CASHIER_PERMISSIONS,
    },
  });
}

/** A logged-in HTTP client (cookies are kept between requests). */
export async function loginAs(ctx: TestContext, username: string, password = 'secret123') {
  const agent = ctx.http();
  await agent.post('/api/auth/login').send({ username, password }).expect(200);
  return agent;
}

/** Admin "owner" (PIN 9999) and cashier "cash" (PIN 1111) with products.manage. */
export async function standardUsers(ctx: TestContext) {
  const admin = await createUser(ctx, { username: 'owner', role: 'ADMIN', pin: '9999' });
  const cashier = await createUser(ctx, {
    username: 'cash',
    permissions: [...DEFAULT_CASHIER_PERMISSIONS, 'products.manage'],
  });
  return {
    admin,
    cashier,
    adminHttp: await loginAs(ctx, 'owner'),
    cashierHttp: await loginAs(ctx, 'cash'),
  };
}

export const sampleProduct = (overrides: Record<string, unknown> = {}) => ({
  name: 'Anker 20W Charger',
  variants: [
    {
      name: 'White',
      retailPrice: 450_000,
      wholesalePrice: 380_000,
      costPrice: 280_000,
      openingStock: 10,
    },
    {
      name: 'Black',
      retailPrice: 450_000,
      wholesalePrice: 380_000,
      costPrice: 280_000,
      openingStock: 0,
    },
  ],
  ...overrides,
});

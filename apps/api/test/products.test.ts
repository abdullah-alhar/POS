import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isValidEan13 } from '@shoppos/shared';
import { nextDocumentNumber } from '../src/prisma/counters';
import { resetDb, sampleProduct, standardUsers, startApp, type TestContext } from './helpers';

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

describe('products', () => {
  it('creates a product with variants, SKUs, barcodes and opening stock', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const res = await adminHttp
      .post('/api/products')
      .send(
        sampleProduct({
          variants: [
            {
              name: 'White',
              retailPrice: 450_000,
              wholesalePrice: 380_000,
              costPrice: 280_000,
              openingStock: 10,
              generateBarcode: true,
            },
            {
              name: 'Black',
              retailPrice: 450_000,
              wholesalePrice: 380_000,
              costPrice: 280_000,
              barcodes: ['6941812725611'],
            },
          ],
        }),
      )
      .expect(201);

    const [white, black] = res.body.variants;
    expect(white.sku).toBe('P000001');
    expect(black.sku).toBe('P000002');
    expect(isValidEan13(white.barcodes[0])).toBe(true);
    expect(black.barcodes).toEqual(['6941812725611']);
    expect(white.stockQty).toBe(10);

    const movements = await ctx.prisma.stockMovement.findMany();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'OPENING',
      qtyChange: 10,
      qtyAfter: 10,
      variantId: white.id,
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PRODUCT_CREATE' } })).toBe(1);
  });

  it('refuses a barcode that another product already uses', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const one = sampleProduct({
      variants: [{ retailPrice: 100, wholesalePrice: 100, costPrice: 50, barcodes: ['123456'] }],
    });
    await adminHttp.post('/api/products').send(one).expect(201);
    const res = await adminHttp
      .post('/api/products')
      .send({ ...one, name: 'Other product' })
      .expect(409);
    expect(res.body.message).toBe('Barcode 123456 is already used by "Anker 20W Charger"');
    expect(await ctx.prisma.product.count()).toBe(1);
  });

  it('rejects money with decimals (cents must be whole numbers)', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const res = await adminHttp
      .post('/api/products')
      .send(
        sampleProduct({ variants: [{ retailPrice: 100.5, wholesalePrice: 100, costPrice: 50 }] }),
      )
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fields['variants.0.retailPrice']).toBeDefined();
  });

  it('hides removed variants instead of deleting them, and lets barcodes move', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const created = (
      await adminHttp
        .post('/api/products')
        .send(
          sampleProduct({
            variants: [
              {
                name: 'White',
                retailPrice: 100,
                wholesalePrice: 90,
                costPrice: 50,
                barcodes: ['AAA111'],
              },
              { name: 'Black', retailPrice: 100, wholesalePrice: 90, costPrice: 50 },
            ],
          }),
        )
        .expect(201)
    ).body;
    const [white, black] = created.variants;

    const updated = await adminHttp
      .put(`/api/products/${created.id}`)
      .send({
        name: 'Anker 20W Charger (new)',
        variants: [{ ...black, barcodes: ['AAA111'], sku: black.sku }],
      })
      .expect(200);

    expect(updated.body.name).toBe('Anker 20W Charger (new)');
    const whiteAfter = updated.body.variants.find((v: { id: string }) => v.id === white.id);
    const blackAfter = updated.body.variants.find((v: { id: string }) => v.id === black.id);
    expect(whiteAfter.isActive).toBe(false);
    expect(whiteAfter.barcodes).toEqual([]);
    expect(blackAfter.barcodes).toEqual(['AAA111']);
  });

  it('searches by words, barcode and SKU, and filters low stock', async () => {
    const { adminHttp } = await standardUsers(ctx);
    await adminHttp.post('/api/products').send(sampleProduct()).expect(201);
    await adminHttp
      .post('/api/products')
      .send({
        name: 'JBL Go 4 Speaker',
        variants: [
          {
            retailPrice: 100,
            wholesalePrice: 90,
            costPrice: 50,
            openingStock: 50,
            reorderLevel: 5,
            barcodes: ['999888'],
          },
        ],
      })
      .expect(201);

    const words = await adminHttp.get('/api/products?q=anker%2020w').expect(200);
    expect(words.body.items.map((p: { name: string }) => p.name)).toEqual(['Anker 20W Charger']);

    const barcode = await adminHttp.get('/api/products?q=999888').expect(200);
    expect(barcode.body.items.map((p: { name: string }) => p.name)).toEqual(['JBL Go 4 Speaker']);

    const sku = await adminHttp.get('/api/products?q=p000003').expect(200);
    expect(sku.body.total).toBe(1);

    // Anker "Black" has 0 stock and reorder level 0 → low stock. JBL has 50 → fine.
    const low = await adminHttp.get('/api/products?lowStock=true').expect(200);
    expect(low.body.items.map((p: { name: string }) => p.name)).toEqual(['Anker 20W Charger']);
  });

  it('builds the billing index and looks up items by code', async () => {
    const { cashierHttp, adminHttp } = await standardUsers(ctx);
    const created = (
      await adminHttp
        .post('/api/products')
        .send(
          sampleProduct({
            variants: [
              {
                name: 'White',
                retailPrice: 450_000,
                wholesalePrice: 380_000,
                costPrice: 1,
                barcodes: ['555'],
              },
            ],
          }),
        )
        .expect(201)
    ).body;
    await adminHttp
      .post('/api/products')
      .send({
        name: 'Old item',
        isActive: false,
        variants: [{ retailPrice: 1, wholesalePrice: 1, costPrice: 1 }],
      })
      .expect(201);

    const index = await cashierHttp.get('/api/catalog/pos-index').expect(200);
    expect(index.body.items).toHaveLength(1);
    expect(index.body.items[0]).toMatchObject({
      name: 'Anker 20W Charger – White',
      barcodes: ['555'],
      retailPrice: 450_000,
      taxRateBp: 0,
    });
    expect(index.headers.etag).toBeDefined();

    const found = await cashierHttp.get('/api/variants/lookup?code=555').expect(200);
    expect(found.body.variantId).toBe(created.variants[0].id);
    await cashierHttp.get('/api/variants/lookup?code=nothing').expect(404);
  });

  it('cannot delete stock history, even with SQL', async () => {
    const { adminHttp } = await standardUsers(ctx);
    await adminHttp.post('/api/products').send(sampleProduct()).expect(201);
    await expect(ctx.prisma.stockMovement.deleteMany()).rejects.toThrow(/cannot be deleted/);
    await expect(ctx.prisma.auditLog.updateMany({ data: { summary: 'x' } })).rejects.toThrow(
      /cannot be updated/,
    );
  });
});

describe('document numbers', () => {
  it('are sequential with no gaps or duplicates, even when made at the same time', async () => {
    const date = new Date('2026-05-01T10:00:00');
    const numbers = await Promise.all(
      Array.from({ length: 15 }, () =>
        ctx.prisma.$transaction((tx) => nextDocumentNumber(tx, 'INV', date)),
      ),
    );
    expect(new Set(numbers).size).toBe(15);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `INV-2026-${String(i + 1).padStart(6, '0')}`),
    );
  });

  it('gives the number back when the transaction fails', async () => {
    const date = new Date('2026-05-01T10:00:00');
    await ctx.prisma.$transaction((tx) => nextDocumentNumber(tx, 'INV', date));
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await nextDocumentNumber(tx, 'INV', date);
        throw new Error('payment failed');
      }),
    ).rejects.toThrow('payment failed');
    const next = await ctx.prisma.$transaction((tx) => nextDocumentNumber(tx, 'INV', date));
    expect(next).toBe('INV-2026-000002');
  });

  it('restarts every year', async () => {
    const a = await ctx.prisma.$transaction((tx) =>
      nextDocumentNumber(tx, 'INV', new Date('2026-12-31T23:00:00')),
    );
    const b = await ctx.prisma.$transaction((tx) =>
      nextDocumentNumber(tx, 'INV', new Date('2027-01-01T08:00:00')),
    );
    expect(a).toBe('INV-2026-000001');
    expect(b).toBe('INV-2027-000001');
  });
});

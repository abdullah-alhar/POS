import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  RECEIPT_TEMPLATES,
  type ReceiptDoc,
  type ReceiptElement,
} from '@shoppos/shared';
import { renderText } from '../src/modules/printing/escpos';
import { buildSaleReceipt, sampleSale } from '../src/modules/printing/receipt-builder';
import { resetDb, standardUsers, startApp, type TestContext } from './helpers';

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

const text = (doc: ReceiptDoc) => renderText(doc, 48);
const t = (id: string, value: string, extra: Partial<ReceiptElement> = {}) =>
  ({
    id,
    type: 'text',
    text: value,
    align: 'left',
    bold: false,
    size: 'normal',
    ...extra,
  }) as ReceiptElement;
const withLayout = (layout: ReceiptElement[]) => ({
  ...DEFAULT_SETTINGS,
  receipt: { ...DEFAULT_SETTINGS.receipt, layout },
});

describe('receipt design pieces', () => {
  it('prints only on the bills a piece is meant for, and never hidden pieces', () => {
    const settings = withLayout([
      t('a', 'Pay within 30 days', { when: 'credit' }),
      t('b', 'Thanks for paying cash', { when: 'cash' }),
      t('c', 'Secret', { hidden: true }),
      t('d', 'Warranty card inside', { when: 'warranty' }),
    ]);
    const cash = text(buildSaleReceipt(sampleSale(), settings));
    expect(cash).toContain('Thanks for paying cash');
    expect(cash).toContain('Warranty card inside');
    expect(cash).not.toContain('Pay within 30 days');
    expect(cash).not.toContain('Secret');

    const credit = sampleSale();
    credit.payments = [{ method: 'CREDIT', amount: credit.total, tendered: null, reference: null }];
    const out = text(buildSaleReceipt(credit, settings));
    expect(out).toContain('Pay within 30 days');
    expect(out).not.toContain('Thanks for paying cash');
  });

  it('fills in the new fields and prints two columns, signatures and numbered items', () => {
    const sale = sampleSale();
    sale.note = 'Deliver on Monday';
    const settings = withLayout([
      {
        id: 'p',
        type: 'pair',
        left: 'Bill {bill_no}',
        right: '{time}',
        bold: false,
        size: 'normal',
      },
      t('n', 'Note: {note}'),
      t('m', 'Paid by {payment_method}, {item_count} items, total {total}'),
      {
        id: 'i',
        type: 'items',
        layout: 'one-line',
        showSku: false,
        showDiscounts: false,
        showWarranty: false,
        showSerial: false,
        numbered: true,
      },
      { id: 's', type: 'signature', label: 'Received by' },
      { id: 'd', type: 'divider', style: 'stars' },
    ]);
    const out = text(buildSaleReceipt(sale, settings)).split('\n');
    expect(out[0]).toMatch(/^Bill INV-\d{4}-000123 +\d\d:\d\d$/);
    expect(out[0]).toHaveLength(48);
    expect(out).toContain('Note: Deliver on Monday');
    expect(out).toContain('Paid by Cash, 4 items, total Rs 6,750');
    expect(out.some((l) => l.startsWith('1. Anker 20W USB-C Charger - White'))).toBe(true);
    expect(out.some((l) => l.startsWith('2. 2 x Tempered Glass'))).toBe(true);
    expect(out.some((l) => l.trim() === 'Received by')).toBe(true);
    expect(out).toContain('*'.repeat(48));
  });

  it('prints a simple total in normal letters when asked', () => {
    const doc = buildSaleReceipt(
      sampleSale(),
      withLayout([{ id: 't', type: 'totals', simple: true, bigTotal: false }]),
    );
    expect(doc.blocks).toEqual([
      { type: 'row', left: 'TOTAL', right: 'Rs 6,750', bold: true, large: false },
    ]);
  });

  it('builds every ready-made design', () => {
    for (const tpl of Object.values(RECEIPT_TEMPLATES)) {
      const out = text(buildSaleReceipt(sampleSale(), withLayout(tpl.build())));
      expect(out).toContain('TOTAL');
    }
  });
});

describe('receipt preview', () => {
  it('previews a design as a credit sale, a quotation, a reprint and on 58 mm paper', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const receipt = {
      ...DEFAULT_SETTINGS.receipt,
      layout: [
        t('a', 'Bill {bill_no}'),
        t('b', 'Pay within 30 days', { when: 'credit' }),
        { id: 'c', type: 'totals' },
        { id: 'd', type: 'payments' },
      ],
    };
    const preview = (body: object) =>
      adminHttp
        .post('/api/printing/receipt-preview')
        .send({ receipt, ...body })
        .expect(200);

    const plain = (await preview({})).body;
    // No sales yet: a sample bill is used.
    expect(plain.bill.source).toBe('sample');
    expect(plain.pieces.find((p: { id: string }) => p.id === 'b').skipped).toBe('condition');
    expect(plain.text).not.toContain('Pay within 30 days');
    expect(plain.estimate.mm).toBeGreaterThan(20);

    const credit = (await preview({ scenario: 'credit' })).body;
    expect(credit.text).toContain('Pay within 30 days');
    expect(credit.text).toContain('*** SHOP COPY ***');
    expect(credit.pieces.find((p: { id: string }) => p.id === 'b').skipped).toBeUndefined();

    const quote = (await preview({ scenario: 'quote' })).body;
    expect(quote.text).toContain('QUOTATION');
    expect(quote.text).not.toContain('Cash');

    expect((await preview({ scenario: 'reprint' })).body.text).toContain('*** REPRINT ***');

    const narrow = (await preview({ charsPerLine: 32 })).body.text as string;
    expect(Math.max(...narrow.split('\n').map((l) => l.length))).toBeLessThanOrEqual(32);

    await adminHttp
      .post('/api/printing/receipt-preview')
      .send({ receipt, billNumber: 'INV-1999-000001' })
      .expect(404);
  });
});

describe('settings history', () => {
  it('keeps every version with a readable summary, for admins only', async () => {
    const { adminHttp, cashierHttp } = await standardUsers(ctx);
    const pos = (await adminHttp.get('/api/settings').expect(200)).body.pos;
    await adminHttp
      .put('/api/settings/pos')
      .send({ ...pos, roundingStep: 1000 })
      .expect(200);
    await adminHttp
      .put('/api/settings/pos')
      .send({ ...pos, roundingStep: 1000, autoLockMinutes: 5 })
      .expect(200);

    const history = (await adminHttp.get('/api/settings/history?section=pos').expect(200)).body;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      section: 'pos',
      userName: 'Owner',
      summary: 'Changed Billing: Lock the screen after Never → 5 minutes',
      after: { autoLockMinutes: 5 },
    });
    expect(history[1].summary).toBe('Changed Billing: Round bill totals to Nearest 1 → Nearest 10');
    expect(history[1].before).toMatchObject({ roundingStep: 100 });

    await adminHttp.get('/api/settings/history?section=nope').expect(400);
    await cashierHttp.get('/api/settings/history').expect(403);
  });

  it('saves the AI settings only with an address in the shop', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const ok = { enabled: true, url: 'http://127.0.0.1:11434', model: 'qwen3.5:4b' };
    await adminHttp.put('/api/settings/ai').send(ok).expect(200);
    const res = await adminHttp
      .put('/api/settings/ai')
      .send({ ...ok, url: 'https://ai.example.com' })
      .expect(400);
    expect(res.body.message).toMatch(/this computer or the shop network/);
  });

  it('keeps named receipt designs', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const design = {
      id: 'x1',
      name: 'Eid sale',
      savedAt: new Date().toISOString(),
      layout: RECEIPT_TEMPLATES.modern.build(),
    };
    await adminHttp
      .put('/api/settings/receiptLibrary')
      .send({ designs: [design] })
      .expect(200);
    const saved = (await adminHttp.get('/api/settings').expect(200)).body.receiptLibrary;
    expect(saved.designs[0].name).toBe('Eid sale');
  });
});

/** A stand-in for Ollama on this computer: answers with whatever the test sets. */
function fakeOllama() {
  const state = {
    models: ['qwen3.5:4b'],
    answer: {} as unknown,
    requests: [] as { path: string; body: Record<string, unknown> }[],
  };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests.push({ path: req.url ?? '', body: body ? JSON.parse(body) : {} });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: state.models.map((name) => ({ name })) }));
      } else {
        res.end(
          JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(state.answer) } }),
        );
      }
    });
  });
  return {
    state,
    start: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        ),
      ),
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('assistant', () => {
  it('answers common requests itself, without AI', async () => {
    const { adminHttp, cashierHttp } = await standardUsers(ctx);
    const layout = RECEIPT_TEMPLATES.classic.build();
    const res = await adminHttp
      .post('/api/assistant/receipt')
      .send({ message: 'make the total small and hide the barcode', layout })
      .expect(200);
    expect(res.body.source).toBe('built-in');
    expect(res.body.actions).toEqual([
      { op: 'update', target: 'total', size: 'normal' },
      { op: 'hide', target: 'barcode' },
    ]);

    const settings = await adminHttp
      .post('/api/assistant/settings')
      .send({ message: 'round to the nearest Rs 10' })
      .expect(200);
    expect(settings.body).toMatchObject({
      source: 'built-in',
      changes: [{ path: 'pos.roundingStep', value: 1000 }],
    });
    // Nothing is saved until the owner approves the change.
    expect((await adminHttp.get('/api/settings').expect(200)).body.pos.roundingStep).toBe(100);

    const unknown = await adminHttp
      .post('/api/assistant/receipt')
      .send({ message: 'write a poem about tea', layout })
      .expect(200);
    expect(unknown.body.actions).toEqual([]);
    expect(unknown.body.reply).toMatch(/turn on the free local AI/);

    await cashierHttp.post('/api/assistant/receipt').send({ message: 'x', layout }).expect(403);
  });

  it('asks the local AI model for other requests and keeps only allowed actions', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const ollama = fakeOllama();
    const url = await ollama.start();
    try {
      await adminHttp
        .put('/api/settings/ai')
        .send({ enabled: true, url, model: 'qwen3.5:4b' })
        .expect(200);
      const status = (await adminHttp.get('/api/assistant/status').expect(200)).body;
      expect(status).toMatchObject({
        enabled: true,
        reachable: true,
        modelReady: true,
        problem: null,
      });

      ollama.state.answer = {
        reply: 'I added a tea message at the bottom.',
        actions: [
          { op: 'add', piece: 'text', text: 'Fresh Ceylon tea served daily', position: 'bottom' },
          { op: 'format-disk' },
          { op: 'update', target: 'totals', bigTotal: 'yes please' },
        ],
      };
      const layout = RECEIPT_TEMPLATES.classic.build();
      const res = await adminHttp
        .post('/api/assistant/receipt')
        .send({ message: 'write something nice about our tea', layout })
        .expect(200);
      expect(res.body).toEqual({
        source: 'ai',
        reply: 'I added a tea message at the bottom.',
        actions: [
          { op: 'add', piece: 'text', text: 'Fresh Ceylon tea served daily', position: 'bottom' },
        ],
      });
      // The model gets the design, a JSON schema to answer with, and no bill or customer data.
      const chat = ollama.state.requests.find((r) => r.path === '/api/chat')!;
      expect(chat.body).toMatchObject({ model: 'qwen3.5:4b', stream: false, think: false });
      expect(chat.body.format).toMatchObject({ type: 'object' });
      const prompt = JSON.stringify(chat.body.messages);
      expect(prompt).toContain('write something nice about our tea');
      expect(prompt).toContain(layout[0]!.id);

      ollama.state.answer = {
        reply: 'Cashiers can now give 12.5% off.',
        changes: [
          { path: 'approvals.cashierMaxDiscountBp', value: 12.5 },
          { path: 'branding.appName', value: 'Hacked' },
          { path: 'pos.roundingStep', value: 7 },
        ],
      };
      const s = await adminHttp
        .post('/api/assistant/settings')
        .send({ message: 'let the cashiers be a bit more generous with discounts' })
        .expect(200);
      expect(s.body.source).toBe('ai');
      expect(s.body.changes).toEqual([{ path: 'approvals.cashierMaxDiscountBp', value: 1250 }]);
      expect(s.body.problems).toEqual(['Round bill totals to cannot be 7.']);

      ollama.state.models = [];
      const missing = (await adminHttp.get('/api/assistant/status').expect(200)).body;
      expect(missing.modelReady).toBe(false);
      expect(missing.problem).toMatch(/ollama pull qwen3.5:4b/);
      const down = await adminHttp
        .post('/api/assistant/settings')
        .send({ message: 'something only the AI understands' })
        .expect(200);
      // The fake server still answers chats; a stopped server gives a clear error instead.
      expect(down.body.source).toBe('ai');
    } finally {
      await ollama.stop();
    }
    const stopped = await adminHttp
      .post('/api/assistant/settings')
      .send({ message: 'something only the AI understands' })
      .expect(503);
    expect(stopped.body).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(stopped.body.message).toMatch(/ollama/i);
  });
});

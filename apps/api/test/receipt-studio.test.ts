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

  it('saves the AI settings only with safe addresses', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const ok = { ...DEFAULT_SETTINGS.ai, mode: 'local', localUrl: 'http://127.0.0.1:11434' };
    await adminHttp.put('/api/settings/ai').send(ok).expect(200);
    const local = await adminHttp
      .put('/api/settings/ai')
      .send({ ...ok, localUrl: 'https://ai.example.com' })
      .expect(400);
    expect(local.body.message).toMatch(/this computer or the shop network/);
    const plain = await adminHttp
      .put('/api/settings/ai')
      .send({
        ...ok,
        mode: 'online',
        provider: 'custom',
        customUrl: 'http://ai.example.com/v1',
        model: 'x',
      })
      .expect(400);
    expect(plain.body.message).toMatch(/https/);
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

/** A stand-in AI server on this computer: Ollama and OpenAI-compatible, answering what the test sets. */
function fakeAi() {
  const state = {
    models: ['qwen3.5:4b'],
    answer: {} as unknown,
    status: 200,
    requests: [] as { path: string; body: Record<string, unknown>; auth?: string }[],
  };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests.push({
        path: req.url ?? '',
        body: body ? JSON.parse(body) : {},
        auth: req.headers.authorization,
      });
      res.setHeader('Content-Type', 'application/json');
      if (state.status !== 200) {
        res.statusCode = state.status;
        res.end(JSON.stringify({ error: { message: 'nope' } }));
      } else if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: state.models.map((name) => ({ name })) }));
      } else if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: state.models.map((id) => ({ id })) }));
      } else if (req.url === '/v1/chat/completions') {
        const content = '```json\n' + JSON.stringify(state.answer) + '\n```';
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
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
  it('answers common requests itself, without AI or internet', async () => {
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
    expect(unknown.body.reply).toMatch(/turn on a free AI/);

    await cashierHttp.post('/api/assistant/receipt').send({ message: 'x', layout }).expect(403);
  });

  it('uses a free online AI with a key that is stored encrypted and never shown', async () => {
    const { adminHttp, cashierHttp } = await standardUsers(ctx);
    const fake = fakeAi();
    const url = await fake.start();
    try {
      const ai = {
        ...DEFAULT_SETTINGS.ai,
        mode: 'online',
        provider: 'custom',
        customUrl: `${url}/v1`,
        model: 'free-model',
      };
      await adminHttp.put('/api/settings/ai').send(ai).expect(200);
      await adminHttp
        .put('/api/assistant/keys/custom')
        .send({ key: 'sk-test-1234567890abcd' })
        .expect(200);

      // The key is never sent back, only a hint; it is not stored as plain text either.
      const status = (await adminHttp.get('/api/assistant/status').expect(200)).body;
      expect(status).toMatchObject({ mode: 'online', ready: true, keys: { custom: 'sk-…abcd' } });
      const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'ai-keys' } });
      expect(JSON.stringify(row.value)).not.toContain('1234567890');
      expect(JSON.stringify((await adminHttp.get('/api/settings').expect(200)).body)).not.toContain(
        '1234567890',
      );
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'AI_KEY_SAVED' },
      });
      expect(JSON.stringify(audit)).not.toContain('1234567890');
      await cashierHttp.get('/api/assistant/status').expect(403);
      await cashierHttp
        .put('/api/assistant/keys/groq')
        .send({ key: 'gsk_aaaaaaaaaaaaaaaa' })
        .expect(403);

      // Test before saving: lists the models and asks a tiny question.
      fake.state.answer = { ok: true };
      const test = (await adminHttp.post('/api/assistant/test').send({ ai }).expect(200)).body;
      expect(test).toMatchObject({ ready: true, models: ['qwen3.5:4b'], problem: null });

      fake.state.answer = {
        reply: 'I added a tea message at the bottom.',
        actions: [
          { op: 'add', piece: 'text', text: 'Fresh Ceylon tea served daily', position: 'bottom' },
          { op: 'format-disk' },
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
      const chat = fake.state.requests.find((r) => r.path === '/v1/chat/completions')!;
      expect(chat.auth).toBe('Bearer sk-test-1234567890abcd');
      expect(chat.body).toMatchObject({
        model: 'free-model',
        response_format: { type: 'json_object' },
      });

      // A key that does not work: the built-in answer still comes, with the reason.
      fake.state.status = 401;
      const bad = await adminHttp
        .post('/api/assistant/receipt')
        .send({ message: 'write something nice about our tea', layout })
        .expect(200);
      expect(bad.body).toMatchObject({ source: 'built-in', actions: [] });
      expect(bad.body.aiProblem).toMatch(/did not accept the key/);
      fake.state.status = 200;

      await adminHttp.delete('/api/assistant/keys/custom').expect(200);
      expect((await adminHttp.get('/api/assistant/status').expect(200)).body.keys).toEqual({});
    } finally {
      await fake.stop();
    }
  });

  it('keeps working when there is no internet', async () => {
    const { adminHttp } = await standardUsers(ctx);
    // Nothing listens on this port: like a laptop without internet.
    const ai = {
      ...DEFAULT_SETTINGS.ai,
      mode: 'online',
      provider: 'custom',
      customUrl: 'http://127.0.0.1:9/v1',
      model: 'm',
    };
    await adminHttp.put('/api/settings/ai').send(ai).expect(200);
    const res = await adminHttp
      .post('/api/assistant/settings')
      .send({ message: 'something only an AI understands' })
      .expect(200);
    expect(res.body).toMatchObject({ source: 'built-in', changes: [] });
    expect(res.body.aiProblem).toMatch(/No internet/);
    // The built-in assistant still works.
    const ok = await adminHttp
      .post('/api/assistant/settings')
      .send({ message: 'lock the screen after 10 minutes' })
      .expect(200);
    expect(ok.body.changes).toEqual([{ path: 'pos.autoLockMinutes', value: 10 }]);
  });

  it('asks the local AI model and keeps only allowed settings', async () => {
    const { adminHttp } = await standardUsers(ctx);
    const fake = fakeAi();
    const url = await fake.start();
    try {
      await adminHttp
        .put('/api/settings/ai')
        .send({ ...DEFAULT_SETTINGS.ai, mode: 'local', localUrl: url })
        .expect(200);
      expect((await adminHttp.get('/api/assistant/status').expect(200)).body).toMatchObject({
        mode: 'local',
        ready: true,
      });
      fake.state.answer = {
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
      const chat = fake.state.requests.find((r) => r.path === '/api/chat')!;
      expect(chat.body).toMatchObject({ model: 'qwen3.5:4b', stream: false, think: false });
    } finally {
      await fake.stop();
    }
  });
});

describe('ask', () => {
  it("answers questions from the shop data, offline and within each user's rights", async () => {
    const { adminHttp, cashierHttp } = await standardUsers(ctx);
    await adminHttp.post('/api/products').send(sampleProduct()).expect(201);
    await adminHttp
      .post('/api/customers')
      .send({ name: 'Nimal Perera', phone: '0771234567', creditLimit: 5_000_000 })
      .expect(201);

    const ask = (http: typeof adminHttp, message: string) =>
      http
        .post('/api/assistant/ask')
        .send({ message })
        .expect(200)
        .then((r) => r.body);

    const sales = await ask(adminHttp, 'How are sales today?');
    expect(sales.source).toBe('built-in');
    expect(sales.reply).toMatch(/No sales yet today/);
    expect(sales.facts.map((f: { label: string }) => f.label)).toEqual([
      'Sales',
      'Bills',
      'Average bill',
      'Profit',
    ]);

    const compare = await ask(adminHttp, 'compare this month with last month');
    expect(compare.table.columns).toEqual(['', 'This month', 'Last month', 'Change']);

    const item = await ask(adminHttp, 'how many anker chargers left');
    expect(item.table.rows.map((r: string[]) => r[0]).sort()).toEqual([
      'Anker 20W Charger – Black',
      'Anker 20W Charger – White',
    ]);
    expect(item.table.columns).toContain('Cost');

    const low = await ask(adminHttp, 'what is running low?');
    expect(low.reply).toMatch(/out of stock/);

    expect((await ask(adminHttp, 'how much does nimal owe')).reply).toBe(
      'Nimal Perera owes nothing.',
    );
    expect(await ask(adminHttp, 'open reports')).toMatchObject({ navigate: '/reports' });
    expect((await ask(adminHttp, 'How do I close the day?')).reply).toMatch(/^Closing the day:/);
    expect((await ask(adminHttp, 'round bill totals to the nearest Rs 5')).settings).toEqual([
      { path: 'pos.roundingStep', value: 500 },
    ]);

    // A cashier cannot see sales figures or cost prices, but can look up prices and stock.
    expect((await ask(cashierHttp, 'How are sales today?')).reply).toMatch(
      /do not have permission/,
    );
    const cashierItem = await ask(cashierHttp, 'price of anker charger');
    expect(cashierItem.table.columns).not.toContain('Cost');
    expect((await ask(cashierHttp, 'lock the screen after 5 minutes')).reply).toMatch(
      /do not have permission/,
    );

    const unknown = await ask(adminHttp, 'write me a poem about tea');
    expect(unknown.suggestions.length).toBeGreaterThan(3);
  });

  it('lets an AI choose the skill without seeing any shop data', async () => {
    const { adminHttp } = await standardUsers(ctx);
    await adminHttp.post('/api/products').send(sampleProduct()).expect(201);
    const fake = fakeAi();
    const url = await fake.start();
    try {
      await adminHttp
        .put('/api/settings/ai')
        .send({
          ...DEFAULT_SETTINGS.ai,
          mode: 'online',
          provider: 'custom',
          customUrl: `${url}/v1`,
          model: 'm',
        })
        .expect(200);
      fake.state.answer = { skill: 'item', query: 'anker', reply: 'Here is the Anker charger.' };
      const res = await adminHttp
        .post('/api/assistant/ask')
        .send({ message: 'do we still have those white chargers from anker' })
        .expect(200);
      expect(res.body.source).toBe('ai');
      expect(res.body.reply).toMatch(/^Here is the Anker charger/);
      expect(res.body.table.rows).toHaveLength(2);
      const prompt = JSON.stringify(
        fake.state.requests.find((r) => r.path === '/v1/chat/completions')!.body,
      );
      expect(prompt).not.toContain('450');
      expect(prompt).not.toMatch(/Anker 20W/);

      fake.state.answer = { skill: 'chat', reply: 'Put chargers next to the phones.' };
      const tip = await adminHttp
        .post('/api/assistant/ask')
        .send({ message: 'ideas to sell more chargers?' })
        .expect(200);
      expect(tip.body).toEqual({ reply: 'Put chargers next to the phones.', source: 'ai' });
    } finally {
      await fake.stop();
    }
  });
});

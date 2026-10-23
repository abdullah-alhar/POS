import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  applySettingChanges,
  ASK_EXAMPLES,
  ASK_PAGES,
  ASK_PERIODS,
  ASK_SKILLS,
  askIntentSchema,
  formatMoney,
  hasPermission,
  HELP_TOPICS,
  interpretAsk,
  interpretSettingsCommand,
  periodRange,
  previousPeriod,
  type AskAnswer,
  type AskIntent,
  type AskPeriod,
  type SalesReport,
} from '@shoppos/shared';
import type { Actor } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { variantLabel } from '../catalog/products.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { InventoryService } from '../inventory/inventory.service';
import { localToday, ReportsService } from '../reports/reports.service';
import { SettingsService } from '../settings/settings.service';
import { AiError } from './ai-error';
import { AiService } from './ai.service';
import { replyText } from './assistant.service';

/** What the AI may answer: one skill with its details, or a short general answer ("chat"). */
const AI_ANSWER = z.object({
  skill: z.enum([...(Object.keys(ASK_SKILLS) as [string, ...string[]]), 'chat', 'none']),
  period: z.string().optional(),
  period2: z.string().optional(),
  query: z.string().optional(),
  page: z.string().optional(),
  topic: z.string().optional(),
  limit: z.number().optional(),
  reply: z.string().max(800),
});

const AI_SYSTEM = `You are the helper inside a small shop's point-of-sale system. Read the shop owner's or cashier's question and choose ONE skill; the system then works out the answer from the shop's data. You never see the data, so never make up numbers, names or prices.

Skills:
${Object.entries(ASK_SKILLS)
  .map(([k, v]) => `- ${k}: ${v.label}`)
  .join('\n')}
- chat: a general question about running a shop that needs no shop data; put a short, practical answer (at most 5 sentences) in "reply".
- none: the question cannot be answered; say what you can do in "reply".

Details to fill in when the skill needs them:
- period / period2 (sales, compare, best, slow, expenses): ${Object.keys(ASK_PERIODS).join(', ')}
- query (item, customer): the item or customer name to look up
- page (goto): ${Object.keys(ASK_PAGES).join(', ')}
- topic (help): ${Object.entries(HELP_TOPICS)
  .map(([k, v]) => `${k} (${v.title})`)
  .join(', ')}
- limit (best): how many items, 1-20
"reply" is one short, friendly sentence introducing the answer (for chat and none, the whole answer). Reply in the language of the question.`;

const pct = (now: number, before: number) =>
  before === 0
    ? now === 0
      ? '0%'
      : 'new'
    : `${now >= before ? '+' : ''}${Math.round(((now - before) / Math.abs(before)) * 100)}%`;

/**
 * "Ask": the assistant on every page. Common questions are understood without AI; others go to
 * the AI only to choose a skill. Every answer is worked out here from the shop's own data, and
 * only what the user may see (sales and profit need "reports", balances need "customers" …).
 */
@Injectable()
export class AskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
    private readonly cash: CashRegisterService,
    private readonly ai: AiService,
  ) {}

  private money(cents: number) {
    const { currencySymbol, showCents } = this.settings.get('pos');
    return formatMoney(cents, { symbol: currencySymbol, showCents });
  }

  async ask(message: string, actor: Actor): Promise<AskAnswer> {
    let intent: AskIntent | null = interpretAsk(message);
    if (!intent && interpretSettingsCommand(message, this.settings.all()).understood)
      intent = { skill: 'settings' };
    if (intent) return this.run(intent, message, actor, 'built-in');

    if (!(await this.ai.available())) {
      return {
        ...this.notUnderstood(),
        reply: `I did not understand that. ${await this.ai.unavailableReason()} Here are questions I can answer:`,
      };
    }
    let raw: z.infer<typeof AI_ANSWER>;
    try {
      raw = (await this.ai.json(AI_SYSTEM, `Question: ${message}`, AI_ANSWER)) as z.infer<
        typeof AI_ANSWER
      >;
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      return {
        ...this.notUnderstood(),
        reply: `I did not understand that, and the AI could not help: ${err.message}`,
        aiProblem: err.message,
      };
    }
    if (raw?.skill === 'chat' || raw?.skill === 'none') {
      return {
        reply: replyText(raw.reply, 0),
        source: 'ai',
        suggestions: raw.skill === 'none' ? ASK_EXAMPLES.slice(0, 4) : undefined,
      };
    }
    const parsed = askIntentSchema.safeParse({
      ...raw,
      reply: undefined,
      limit: raw?.limit ? Math.round(raw.limit) : undefined,
    });
    if (!parsed.success) {
      return {
        ...this.notUnderstood(),
        reply: 'I could not work that out. Try one of these:',
        source: 'ai',
      };
    }
    return this.run(
      parsed.data,
      message,
      actor,
      'ai',
      typeof raw.reply === 'string' ? raw.reply : '',
    );
  }

  private notUnderstood(): AskAnswer {
    return { reply: '', source: 'built-in', suggestions: ASK_EXAMPLES };
  }

  private async run(
    intent: AskIntent,
    message: string,
    actor: Actor,
    source: AskAnswer['source'],
    intro = '',
  ): Promise<AskAnswer> {
    const permission = ASK_SKILLS[intent.skill].permission;
    if (permission && !hasPermission(actor.user, permission)) {
      return {
        reply: `You do not have permission to see that (${ASK_SKILLS[intent.skill].label.toLowerCase()}). Ask the shop owner.`,
        source,
      };
    }
    const answer = await this.skill(intent, message, actor);
    const reply =
      source === 'ai' && intro && !answer.navigate ? `${intro}\n${answer.reply}` : answer.reply;
    return { ...answer, reply, source };
  }

  private async skill(
    intent: AskIntent,
    message: string,
    actor: Actor,
  ): Promise<Omit<AskAnswer, 'source'>> {
    const today = localToday();
    switch (intent.skill) {
      case 'sales':
        return this.sales(intent.period ?? 'today', today, actor);
      case 'compare':
        return this.compare(
          intent.period ?? 'this_month',
          intent.period2 ?? previousPeriod(intent.period ?? 'this_month'),
          today,
        );
      case 'best':
        return this.best(intent.period ?? 'this_month', intent.limit ?? 10, today);
      case 'slow':
        return this.slow(intent.period ?? 'last_30_days', today);
      case 'expenses':
        return this.expenses(intent.period ?? 'this_month', today);
      case 'lowStock':
        return this.lowStock();
      case 'item':
        return this.item(intent.query ?? message, actor);
      case 'customer':
        return this.customer(intent.query ?? message);
      case 'owed':
        return this.owed();
      case 'cash':
        return this.cashNow();
      case 'goto': {
        const page = ASK_PAGES[intent.page ?? 'home'] ?? ASK_PAGES.home!;
        return { reply: `Opening ${page.label}.`, navigate: page.to };
      }
      case 'help': {
        const topic = HELP_TOPICS[intent.topic ?? ''] ?? HELP_TOPICS.sale!;
        const page = topic.page ? ASK_PAGES[topic.page] : undefined;
        return {
          reply: `${topic.title}:\n${topic.answer.map((a) => `• ${a}`).join('\n')}`,
          links: page ? [{ label: `Open ${page.label}`, to: page.to }] : undefined,
        };
      }
      case 'settings': {
        const current = this.settings.all();
        const r = interpretSettingsCommand(message, current);
        const checked = applySettingChanges(current, r.actions);
        if (!r.understood || !checked.sections.length) {
          return {
            reply: r.understood
              ? 'That is already how it is set.'
              : 'Open Settings to change that.',
            links: [{ label: 'Open Settings', to: '/settings' }],
          };
        }
        return {
          reply: 'Here is what would change. Nothing is saved until you approve it.',
          settings: r.actions.filter((c) =>
            checked.sections.includes(c.path.split('.')[0] as never),
          ),
        };
      }
    }
  }

  private async totals(period: AskPeriod, today: string): Promise<SalesReport['totals']> {
    return (await this.reports.sales(periodRange(period, today), 'month')).totals;
  }

  private async sales(
    period: AskPeriod,
    today: string,
    actor: Actor,
  ): Promise<Omit<AskAnswer, 'source'>> {
    const t = await this.totals(period, today);
    const label = ASK_PERIODS[period];
    const avg = t.bills ? Math.round(t.sales / t.bills) : 0;
    const before = previousPeriod(period);
    const prev = before !== period ? await this.totals(before, today) : null;
    const trend = prev
      ? ` That is ${pct(t.netSales, prev.netSales)} compared with ${ASK_PERIODS[before].toLowerCase()} (${this.money(prev.netSales)}).`
      : '';
    return {
      reply: t.bills
        ? `${label}: ${this.money(t.netSales)} from ${t.bills} bill${t.bills === 1 ? '' : 's'}, profit ${this.money(t.netProfit)}.${trend}`
        : `No sales ${label.toLowerCase() === 'today' ? 'yet today' : `for ${label.toLowerCase()}`}.${trend}`,
      facts: [
        {
          label: 'Sales',
          value: this.money(t.netSales),
          hint: t.returns ? `after ${this.money(t.returns)} returns` : undefined,
        },
        { label: 'Bills', value: String(t.bills) },
        { label: 'Average bill', value: this.money(avg) },
        {
          label: 'Profit',
          value: this.money(t.netProfit),
          hint: t.expenses ? `after ${this.money(t.expenses)} expenses` : undefined,
        },
      ],
      links: [{ label: 'Open reports', to: '/reports' }],
      suggestions: [
        `Best sellers ${label.toLowerCase()}`,
        `Compare ${label.toLowerCase()} with ${ASK_PERIODS[before].toLowerCase()}`,
      ].filter(() => hasPermission(actor.user, 'reports.view')),
    };
  }

  private async compare(
    a: AskPeriod,
    b: AskPeriod,
    today: string,
  ): Promise<Omit<AskAnswer, 'source'>> {
    const [x, y] = await Promise.all([this.totals(a, today), this.totals(b, today)]);
    const avg = (t: SalesReport['totals']) => (t.bills ? Math.round(t.sales / t.bills) : 0);
    const rows: [string, number, number, boolean][] = [
      ['Sales', x.netSales, y.netSales, true],
      ['Bills', x.bills, y.bills, false],
      ['Average bill', avg(x), avg(y), true],
      ['Gross profit', x.grossProfit, y.grossProfit, true],
      ['Expenses', x.expenses, y.expenses, true],
      ['Profit', x.netProfit, y.netProfit, true],
    ];
    const running = ['today', 'this_week', 'this_month', 'this_year'].includes(a);
    const direction = x.netSales >= y.netSales ? 'more' : 'less';
    return {
      reply: `${ASK_PERIODS[a]}: ${this.money(x.netSales)}, ${pct(x.netSales, y.netSales).replace(/^[+-]/, '')} ${direction} than ${ASK_PERIODS[b].toLowerCase()} (${this.money(y.netSales)}).${running ? ` ${ASK_PERIODS[a]} is not over yet.` : ''}`,
      table: {
        columns: ['', ASK_PERIODS[a], ASK_PERIODS[b], 'Change'],
        align: ['left', 'right', 'right', 'right'],
        rows: rows.map(([label, now, before, isMoney]) => [
          label,
          isMoney ? this.money(now) : String(now),
          isMoney ? this.money(before) : String(before),
          pct(now, before),
        ]),
      },
      links: [{ label: 'Open reports', to: '/reports' }],
    };
  }

  private async best(
    period: AskPeriod,
    limit: number,
    today: string,
  ): Promise<Omit<AskAnswer, 'source'>> {
    const rows = await this.reports.products({
      ...periodRange(period, today),
      sort: 'best',
      limit,
    });
    const sold = rows.filter((r) => r.qtySold > 0);
    if (!sold.length) return { reply: `Nothing was sold ${ASK_PERIODS[period].toLowerCase()}.` };
    return {
      reply: `Best seller ${ASK_PERIODS[period].toLowerCase()}: ${sold[0]!.name} (${sold[0]!.qtySold} sold, ${this.money(sold[0]!.sales)}).`,
      table: {
        columns: ['Item', 'Sold', 'Sales', 'Profit'],
        align: ['left', 'right', 'right', 'right'],
        rows: sold.map((r) => [
          r.name,
          String(r.qtySold),
          this.money(r.sales),
          this.money(r.profit),
        ]),
      },
      links: [{ label: 'Open reports', to: '/reports' }],
    };
  }

  private async slow(period: AskPeriod, today: string): Promise<Omit<AskAnswer, 'source'>> {
    const rows = await this.reports.products({
      ...periodRange(period, today),
      sort: 'slow',
      limit: 10,
    });
    const idle = rows.filter((r) => r.stockQty > 0);
    if (!idle.length) return { reply: 'Every item in stock has been selling. Well done!' };
    return {
      reply: `${idle.length} item${idle.length === 1 ? '' : 's'} in stock sold little or nothing (${ASK_PERIODS[period].toLowerCase()}). A discount or a better place on the shelf can help.`,
      table: {
        columns: ['Item', 'In stock', 'Sold', 'Last sold'],
        align: ['left', 'right', 'right', 'right'],
        rows: idle.map((r) => [
          r.name,
          String(r.stockQty),
          String(r.qtySold),
          r.lastSoldAt ? new Date(r.lastSoldAt).toLocaleDateString() : 'never',
        ]),
      },
    };
  }

  private async expenses(period: AskPeriod, today: string): Promise<Omit<AskAnswer, 'source'>> {
    const { from, to } = periodRange(period, today);
    const rows = await this.prisma.expense.groupBy({
      by: ['category'],
      where: {
        cancelledAt: null,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });
    const total = rows.reduce((t, r) => t + (r._sum.amount ?? 0), 0);
    return {
      reply: total
        ? `Expenses ${ASK_PERIODS[period].toLowerCase()}: ${this.money(total)}${rows[0] ? `, mostly ${rows[0].category} (${this.money(rows[0]._sum.amount ?? 0)})` : ''}.`
        : `No expenses recorded ${ASK_PERIODS[period].toLowerCase()}.`,
      table: rows.length
        ? {
            columns: ['Category', 'Amount'],
            align: ['left', 'right'],
            rows: rows.map((r) => [r.category, this.money(r._sum.amount ?? 0)]),
          }
        : undefined,
      links: [{ label: 'Open expenses', to: '/expenses' }],
    };
  }

  private async lowStock(): Promise<Omit<AskAnswer, 'source'>> {
    const items = await this.inventory.lowStock();
    if (!items.length) return { reply: 'Nothing is running low. Stock looks good.' };
    const out = items.filter((i) => i.stockQty <= 0).length;
    return {
      reply: `${items.length} item${items.length === 1 ? ' is' : 's are'} running low${out ? `, ${out} already out of stock` : ''}.`,
      table: {
        columns: ['Item', 'In stock', 'Reorder at'],
        align: ['left', 'right', 'right'],
        rows: items.slice(0, 15).map((i) => [i.name, String(i.stockQty), String(i.reorderLevel)]),
      },
      links: [
        { label: 'Open stock', to: '/stock' },
        { label: 'New purchase', to: '/purchases' },
      ],
    };
  }

  private async item(query: string, actor: Actor): Promise<Omit<AskAnswer, 'source'>> {
    const find = (words: string[]) =>
      this.prisma.productVariant.findMany({
        where: {
          isActive: true,
          product: { isActive: true },
          OR: [
            { sku: { equals: query.trim().toUpperCase() } },
            { barcodes: { some: { code: query.trim() } } },
            {
              AND: words.map((w) => ({
                OR: [
                  { product: { name: { contains: w, mode: 'insensitive' as const } } },
                  { name: { contains: w, mode: 'insensitive' as const } },
                ],
              })),
            },
          ],
        },
        include: { product: true },
        orderBy: { product: { name: 'asc' } },
        take: 8,
      });
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 5);
    let found = await find(words);
    // "chargers" → "charger"
    if (!found.length) found = await find(words.map((w) => w.replace(/(es|s)$/, '')));
    if (!found.length)
      return {
        reply: `I could not find "${query}". Try another word, the code or scan the barcode in Price check (Ctrl+I).`,
      };
    const canCost = hasPermission(actor.user, 'reports.view');
    const first = found[0]!;
    const stock = (v: (typeof found)[number]) =>
      v.product.trackStock ? String(v.stockQty) : 'not counted';
    return {
      reply:
        found.length === 1
          ? `${variantLabel(first.product.name, first.name)}: ${this.money(first.retailPrice)} (wholesale ${this.money(first.wholesalePrice)}), ${first.product.trackStock ? `${first.stockQty} in stock` : 'stock not counted'}.`
          : `${found.length} items match "${query}":`,
      table: {
        columns: ['Item', 'Retail', 'Wholesale', ...(canCost ? ['Cost'] : []), 'In stock'],
        align: ['left', 'right', 'right', ...(canCost ? (['right'] as const) : []), 'right'],
        rows: found.map((v) => [
          variantLabel(v.product.name, v.name),
          this.money(v.retailPrice),
          this.money(v.wholesalePrice),
          ...(canCost ? [this.money(v.costPrice)] : []),
          stock(v),
        ]),
      },
    };
  }

  private async customer(query: string): Promise<Omit<AskAnswer, 'source'>> {
    const digits = query.replace(/\D/g, '');
    const found = await this.prisma.customer.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query.trim(), mode: 'insensitive' } },
          ...(digits.length >= 6 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      orderBy: { name: 'asc' },
      take: 5,
    });
    if (!found.length)
      return {
        reply: `No customer called "${query}".`,
        links: [{ label: 'Open customers', to: '/customers' }],
      };
    const c = found[0]!;
    return {
      reply:
        found.length === 1
          ? c.balance > 0
            ? `${c.name} owes ${this.money(c.balance)}${c.creditLimit ? ` (credit limit ${this.money(c.creditLimit)})` : ''}.`
            : `${c.name} owes nothing.`
          : `${found.length} customers match "${query}":`,
      table: {
        columns: ['Customer', 'Phone', 'Owes', 'Credit limit'],
        align: ['left', 'left', 'right', 'right'],
        rows: found.map((x) => [
          x.name,
          x.phone ?? '',
          this.money(x.balance),
          this.money(x.creditLimit),
        ]),
      },
      links: [
        {
          label: `Open ${found.length === 1 ? c.name : 'customers'}`,
          to: found.length === 1 ? `/customers/${c.id}` : '/customers',
        },
      ],
    };
  }

  private async owed(): Promise<Omit<AskAnswer, 'source'>> {
    const [top, sum] = await Promise.all([
      this.prisma.customer.findMany({
        where: { balance: { gt: 0 } },
        orderBy: { balance: 'desc' },
        take: 10,
      }),
      this.prisma.customer.aggregate({
        where: { balance: { gt: 0 } },
        _sum: { balance: true },
        _count: true,
      }),
    ]);
    if (!top.length) return { reply: 'Nobody owes the shop money.' };
    return {
      reply: `${sum._count} customer${sum._count === 1 ? ' owes' : 's owe'} ${this.money(sum._sum.balance ?? 0)} in total. The most: ${top[0]!.name} (${this.money(top[0]!.balance)}).`,
      table: {
        columns: ['Customer', 'Phone', 'Owes'],
        align: ['left', 'left', 'right'],
        rows: top.map((c) => [c.name, c.phone ?? '', this.money(c.balance)]),
      },
      links: [{ label: 'Open customers', to: '/customers' }],
    };
  }

  private async cashNow(): Promise<Omit<AskAnswer, 'source'>> {
    const s = await this.cash.currentSummary();
    if (!s)
      return {
        reply: 'The day is not open, so there is no cash count yet.',
        links: [{ label: 'Open the cash register', to: '/cash' }],
      };
    return {
      reply: `There should be ${this.money(s.expectedCash)} in the drawer (${s.billCount} bill${s.billCount === 1 ? '' : 's'} today).`,
      facts: [
        { label: 'Expected cash', value: this.money(s.expectedCash) },
        { label: 'Opening cash', value: this.money(s.openingCash) },
        { label: 'Cash sales', value: this.money(s.cashSales) },
        { label: 'Card and bank', value: this.money(s.cardSales + s.bankSales) },
      ],
      links: [{ label: 'Open the cash register', to: '/cash' }],
    };
  }
}

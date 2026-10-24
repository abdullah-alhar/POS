import { Injectable, Logger } from '@nestjs/common';
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
  smallTalk,
  type AskAnswer,
  type AskIntent,
  type AskPeriod,
  type AskRequest,
  type AskSkill,
  type Permission,
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
import { AI_PLAN, AI_STEP, AI_WORDS, Masker, PLAN_SYSTEM, WORDS_SYSTEM } from './ask-ai';
import { AiService } from './ai.service';
import { AssistantService } from './assistant.service';

/** Skills whose results the AI may explain in its own words. */
const EXPLAIN = new Set<AskSkill>([
  'sales',
  'compare',
  'best',
  'slow',
  'expenses',
  'lowStock',
  'item',
  'customer',
  'owed',
  'cash',
  'help',
]);

/** "and last month?": a short follow-up that only makes sense with the question before it. */
const FOLLOW_UP = /^(and|what about|how about|also|same|then|but|or|vs|versus)\b/i;

const AI_SETTINGS_LINK = { label: 'Set up the free AI', to: '/settings?s=assistant' };

/** What one skill found: its answer plus what must not be sent to an AI as it is. */
type Part = Omit<AskAnswer, 'source' | 'cards'> & {
  title?: string;
  facts?: NonNullable<AskAnswer['cards']>[number]['facts'];
  table?: NonNullable<AskAnswer['cards']>[number]['table'];
  /** Customer names: replaced by codes before an AI reads the results. */
  private?: string[];
};

const pct = (now: number, before: number) =>
  before === 0
    ? now === 0
      ? '0%'
      : 'new'
    : `${now >= before ? '+' : ''}${Math.round(((now - before) / Math.abs(before)) * 100)}%`;

/**
 * "Ask": the assistant on every page. Common questions are understood without AI. With an AI,
 * any question is understood (any language, follow-ups, several things at once): the AI picks
 * skills, and every answer is still worked out here from the shop's own data, only with what
 * the user may see (sales and profit need "reports", balances need "customers" …). If the shop
 * allows it, the AI then reads the results to answer in its own words; customer names are
 * replaced by codes first and phone numbers are left out.
 */
@Injectable()
export class AskService {
  private readonly logger = new Logger('Ask');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
    private readonly cash: CashRegisterService,
    private readonly ai: AiService,
    private readonly assistant: AssistantService,
  ) {}

  private money(cents: number) {
    const { currencySymbol, showCents } = this.settings.get('pos');
    return formatMoney(cents, { symbol: currencySymbol, showCents });
  }

  async ask(request: AskRequest | string, actor: Actor): Promise<AskAnswer> {
    const { message, history = [] } =
      typeof request === 'string' ? { message: request, history: [] } : request;
    const aiOn = await this.ai.available();
    let intent: AskIntent | null = interpretAsk(message);
    if (!intent && interpretSettingsCommand(message, this.settings.all()).understood)
      intent = { skill: 'settings' };

    // Understood here (unless it is a follow-up the AI should read with the question before).
    if (intent && !(aiOn && history.length && FOLLOW_UP.test(message.trim()))) {
      const part = await this.part(intent, message, actor);
      if (!aiOn || !EXPLAIN.has(intent.skill)) return this.combine([part], 'built-in');
      return this.inWords(message, history, [part], 'built-in');
    }
    if (!aiOn) {
      return this.notUnderstood(
        actor,
        hasPermission(actor.user, 'settings.manage')
          ? 'I did not understand that yet. Try one of these, or turn on the free AI so I understand any question, in any language.'
          : 'I did not understand that. Try one of these:',
      );
    }

    let plan: z.infer<typeof AI_PLAN>;
    try {
      plan = (await this.ai.json(
        PLAN_SYSTEM,
        this.conversation(message, history, new Masker()),
        AI_PLAN,
      )) as z.infer<typeof AI_PLAN>;
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      if (intent) return this.combine([await this.part(intent, message, actor)], 'built-in');
      return {
        ...this.notUnderstood(
          actor,
          'I could not reach the AI just now, so I only understand the usual questions. Try one of these:',
        ),
        aiProblem: err.message,
      };
    }
    // Older models may answer with one skill instead of a list of steps.
    const raw = plan as unknown as { steps?: unknown; skill?: unknown; reply?: unknown };
    const steps = (Array.isArray(raw.steps) ? raw.steps : raw.skill ? [raw] : [])
      .map((step) => {
        const st = step as z.infer<typeof AI_STEP>;
        return askIntentSchema.safeParse({
          ...st,
          query: typeof st.query === 'string' ? st.query.slice(0, 80) : undefined,
          limit:
            typeof st.limit === 'number'
              ? Math.min(20, Math.max(1, Math.round(st.limit)))
              : undefined,
        });
      })
      .filter((r) => r.success)
      .map((r) => r.data)
      .slice(0, 3);
    const intro = typeof raw.reply === 'string' ? raw.reply.trim().slice(0, 1500) : '';
    if (!steps.length) {
      return {
        reply: intro || 'I could not work that out. Try one of these:',
        source: 'ai',
        suggestions: intro ? undefined : this.examples(actor).slice(0, 4),
      };
    }
    const parts = [];
    for (const step of steps) parts.push(await this.part(step, message, actor));
    if (!steps.some((s) => EXPLAIN.has(s.skill))) return this.combine(parts, 'ai', intro);
    return this.inWords(message, history, parts, 'ai', intro);
  }

  /** Earlier questions and the new one, as the AI reads them. */
  private conversation(message: string, history: string[], masker: Masker) {
    const before = history.slice(-6).map((q) => `- ${masker.mask(q)}`);
    return `${before.length ? `Earlier questions in this chat (oldest first):\n${before.join('\n')}\n\n` : ''}Latest question: ${masker.mask(message)}`;
  }

  /**
   * Let the AI answer in its own words from the results (when the shop allows it). Without the
   * AI, or if it fails, the built-in answers are given as they are.
   */
  private async inWords(
    message: string,
    history: string[],
    parts: Part[],
    source: AskAnswer['source'],
    intro = '',
  ): Promise<AskAnswer> {
    const plain = this.combine(parts, source, intro);
    if (!this.settings.get('ai').shareResults) return plain;
    const masker = new Masker();
    for (const p of parts) masker.add(p.private);
    const results = parts.map((p) => masker.mask(this.describe(p))).join('\n\n');
    try {
      const out = (await this.ai.json(
        WORDS_SYSTEM,
        `${this.conversation(message, history, masker)}\n\nResults:\n${results}`,
        AI_WORDS,
      )) as { reply?: unknown };
      const reply = typeof out?.reply === 'string' ? out.reply.trim() : '';
      if (!reply) return plain;
      return { ...plain, reply: masker.unmask(reply).slice(0, 2000), source: 'ai' };
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      this.logger.warn(`Answered without the AI's words: ${err.message}`);
      return plain;
    }
  }

  /** One part of the results as text for the AI: no phone numbers, at most 15 rows. */
  private describe(p: Part) {
    const lines = [`### ${p.title ?? 'Answer'}`, p.reply];
    for (const f of p.facts ?? [])
      lines.push(`${f.label}: ${f.value}${f.hint ? ` (${f.hint})` : ''}`);
    if (p.table) {
      const keep = p.table.columns.map((c, i) => (c === 'Phone' ? -1 : i)).filter((i) => i >= 0);
      lines.push(keep.map((i) => p.table!.columns[i] || 'What').join(' | '));
      for (const row of p.table.rows.slice(0, 15))
        lines.push(`- ${keep.map((i) => row[i]).join(' | ')}`);
      if (p.table.rows.length > 15) lines.push(`(${p.table.rows.length - 15} more rows)`);
    }
    return lines.join('\n');
  }

  /** The parts of an answer, put together. */
  private combine(parts: Part[], source: AskAnswer['source'], intro = ''): AskAnswer {
    const many = parts.length > 1;
    const cards = parts
      .filter((p) => p.facts || p.table)
      .map((p) => ({ ...(many && p.title && { title: p.title }), facts: p.facts, table: p.table }));
    const links = parts.flatMap((p) => p.links ?? []);
    const answer: AskAnswer = {
      reply: [many || source === 'ai' ? intro : '', ...parts.map((p) => p.reply)]
        .filter(Boolean)
        .join('\n\n'),
      source,
    };
    if (cards.length) answer.cards = cards;
    if (links.length)
      answer.links = links
        .filter((l, i) => links.findIndex((x) => x.to === l.to) === i)
        .slice(0, 4);
    const navigate = parts.find((p) => p.navigate)?.navigate;
    if (navigate) answer.navigate = navigate;
    const settings = parts.find((p) => p.settings?.length)?.settings;
    if (settings) answer.settings = settings;
    const suggestions = parts.find((p) => p.suggestions?.length)?.suggestions;
    if (suggestions) answer.suggestions = suggestions;
    return answer;
  }

  /** Example questions this user may ask. */
  private examples(actor: Actor) {
    return ASK_EXAMPLES.filter((q) => {
      const skill = interpretAsk(q)?.skill;
      const permission = skill ? ASK_SKILLS[skill].permission : null;
      return !permission || hasPermission(actor.user, permission);
    });
  }

  private notUnderstood(actor: Actor, reply: string): AskAnswer {
    return {
      reply,
      source: 'built-in',
      suggestions: this.examples(actor),
      ...(hasPermission(actor.user, 'settings.manage') && { links: [AI_SETTINGS_LINK] }),
    };
  }

  /** Work out one skill, if this user may see it. */
  private async part(intent: AskIntent, message: string, actor: Actor): Promise<Part> {
    const permission = ASK_SKILLS[intent.skill].permission;
    const title = this.title(intent);
    if (permission && !hasPermission(actor.user, permission)) {
      return {
        title,
        reply: `You do not have permission to see that (${ASK_SKILLS[intent.skill].label.toLowerCase()}). Ask the shop owner.`,
      };
    }
    return { title, ...(await this.skill(intent, message, actor)) };
  }

  private title(intent: AskIntent) {
    const period = (p?: AskPeriod) => ASK_PERIODS[p ?? 'today'];
    switch (intent.skill) {
      case 'sales':
        return `Sales, ${period(intent.period).toLowerCase()}`;
      case 'compare':
        return `${period(intent.period ?? 'this_month')} and ${period(intent.period2 ?? previousPeriod(intent.period ?? 'this_month')).toLowerCase()}`;
      case 'best':
        return `Best sellers, ${period(intent.period ?? 'this_month').toLowerCase()}`;
      case 'slow':
        return `Not selling, ${period(intent.period ?? 'last_30_days').toLowerCase()}`;
      case 'expenses':
        return `Expenses, ${period(intent.period ?? 'this_month').toLowerCase()}`;
      case 'item':
        return `Items: ${intent.query ?? ''}`;
      case 'customer':
        return 'Customer';
      default:
        return ASK_SKILLS[intent.skill].label;
    }
  }

  private async skill(intent: AskIntent, message: string, actor: Actor): Promise<Part> {
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
        // The built-in assistant first; in other words or languages the settings AI.
        const answer = await this.assistant.settingsChange(message);
        const checked = applySettingChanges(current, answer.changes);
        if (!checked.sections.length) {
          return {
            reply: answer.changes.length
              ? 'That is already how it is set.'
              : 'I could not find that setting. Open Settings to change it.',
            links: [{ label: 'Open Settings', to: '/settings' }],
          };
        }
        return {
          reply:
            answer.source === 'ai' && answer.reply
              ? `${answer.reply}\nNothing is saved until you approve it.`
              : 'Here is what would change. Nothing is saved until you approve it.',
          settings: answer.changes.filter((c) =>
            checked.sections.includes(c.path.split('.')[0] as never),
          ),
        };
      }
      case 'hello':
        return this.hello(message, actor);
    }
  }

  private hello(message: string, actor: Actor): Part {
    const kind = smallTalk(message);
    if (kind === 'thanks') return { reply: "You're welcome! Anything else?" };
    const can = (p: Permission) => hasPermission(actor.user, p);
    const abilities = [
      can('reports.view') &&
        '- **Sales and profit**: today, this month, compare periods, best and slow sellers',
      can('products.view') &&
        '- **Stock and prices**: what is running low, price and stock of any item',
      can('customers.manage') && '- **Customers**: who owes money and how much',
      can('cash.register') && '- **Cash**: how much should be in the drawer',
      '- **How to** do anything in the system, and **open any page**',
      can('settings.manage') && '- **Change settings** in plain words (you approve first)',
    ].filter(Boolean);
    return {
      reply: `${kind === 'about' ? 'I can help with:' : 'Hi! I can help with:'}\n${abilities.join('\n')}\n\nWhat would you like to know?`,
      suggestions: this.examples(actor).slice(0, 6),
    };
  }

  private async totals(period: AskPeriod, today: string): Promise<SalesReport['totals']> {
    return (await this.reports.sales(periodRange(period, today), 'month')).totals;
  }

  private async sales(period: AskPeriod, today: string, actor: Actor): Promise<Part> {
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

  private async compare(a: AskPeriod, b: AskPeriod, today: string): Promise<Part> {
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
      reply: `${ASK_PERIODS[a]}: ${this.money(x.netSales)}, ${
        y.netSales === 0
          ? `and no sales ${ASK_PERIODS[b].toLowerCase()}`
          : x.netSales === y.netSales
            ? `the same as ${ASK_PERIODS[b].toLowerCase()}`
            : `${pct(x.netSales, y.netSales).replace(/^[+-]/, '')} ${direction} than ${ASK_PERIODS[b].toLowerCase()} (${this.money(y.netSales)})`
      }.${running ? ` ${ASK_PERIODS[a]} is not over yet.` : ''}`,
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

  private async best(period: AskPeriod, limit: number, today: string): Promise<Part> {
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

  private async slow(period: AskPeriod, today: string): Promise<Part> {
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

  private async expenses(period: AskPeriod, today: string): Promise<Part> {
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

  private async lowStock(): Promise<Part> {
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

  private async item(query: string, actor: Actor): Promise<Part> {
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

  private async customer(query: string): Promise<Part> {
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
      private: found.map((x) => x.name),
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

  private async owed(): Promise<Part> {
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
      private: top.map((c) => c.name),
      table: {
        columns: ['Customer', 'Phone', 'Owes'],
        align: ['left', 'left', 'right'],
        rows: top.map((c) => [c.name, c.phone ?? '', this.money(c.balance)]),
      },
      links: [{ label: 'Open customers', to: '/customers' }],
    };
  }

  private async cashNow(): Promise<Part> {
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

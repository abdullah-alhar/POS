import { z } from 'zod';
import { bpToPercentText, parsePercent } from './money';
import { ALL_APPROVAL_ACTIONS, APPROVAL_ACTIONS, type ApprovalAction } from './permissions';
import { formatSetting, SETTING_INFO } from './settings-tools';
import { SETTINGS_SCHEMAS, type AllSettings, type SettingsSection } from './schemas/settings';
import { NUMBER_WORDS } from './assistant-words';
import type { AssistantReply } from './receipt-assistant';

/**
 * The assistant of Settings: "round totals to Rs 10", "cashiers can give 15% discount" … become
 * setting changes from a fixed list, checked with the same schemas as the forms, and shown to the
 * owner before anything is saved. Understood without internet; an AI can produce the same changes.
 */

// ── Settings ──

/**
 * Settings the assistant may change (never branding, backups folders, the AI itself or the
 * receipt design, which has its own editor). `percent` values are stored as basis points.
 */
export const ASSISTANT_SETTINGS: Record<
  string,
  {
    kind: 'boolean' | 'number' | 'text' | 'percent' | 'choice' | 'list';
    options?: readonly (string | number)[];
    hint: string;
  }
> = {
  'shop.name': { kind: 'text', hint: 'shop name printed on receipts' },
  'shop.address': { kind: 'text', hint: 'shop address' },
  'shop.phone': { kind: 'text', hint: 'shop phone number' },
  'shop.email': { kind: 'text', hint: 'shop email' },
  'receipt.copies': { kind: 'choice', options: [1, 2, 3], hint: 'copies of every receipt' },
  'receipt.shopCopyForCredit': {
    kind: 'boolean',
    hint: 'extra shop copy with a signature line for credit sales',
  },
  'pos.currencySymbol': { kind: 'text', hint: 'currency symbol, e.g. Rs' },
  'pos.roundingStep': {
    kind: 'choice',
    options: [1, 100, 500, 1000],
    hint: 'round bill totals: 1 = no rounding (cents), 100 = nearest 1, 500 = nearest 5, 1000 = nearest 10',
  },
  'pos.showCents': { kind: 'boolean', hint: 'show cents in prices' },
  'pos.allowZeroStockSale': { kind: 'boolean', hint: 'allow selling items with no stock' },
  'pos.defaultPriceMode': {
    kind: 'choice',
    options: ['RETAIL', 'WHOLESALE'],
    hint: 'price mode of new bills',
  },
  'pos.autoPrintReceipt': {
    kind: 'boolean',
    hint: 'print the receipt automatically after payment',
  },
  'pos.autoLockMinutes': {
    kind: 'choice',
    options: [0, 2, 5, 10, 15, 30, 60],
    hint: 'lock the screen after this many idle minutes, 0 = never',
  },
  'pos.confirmRemoveItem': { kind: 'boolean', hint: 'ask before removing an item from the bill' },
  'approvals.cashierMaxDiscountBp': {
    kind: 'percent',
    hint: 'biggest discount (percent) a cashier may give without an admin PIN',
  },
  'approvals.requireApprovalFor': {
    kind: 'list',
    options: ALL_APPROVAL_ACTIONS,
    hint: 'actions where a cashier needs an admin PIN',
  },
  'printer.charsPerLine': {
    kind: 'choice',
    options: [32, 42, 48],
    hint: 'letters per receipt line: 48 for 80 mm paper, 32 for 58 mm',
  },
  'printer.autoCut': { kind: 'boolean', hint: 'cut the paper after each receipt' },
  'printer.openDrawerOnCash': {
    kind: 'boolean',
    hint: 'open the cash drawer after a cash payment',
  },
  'printer.feedLines': { kind: 'number', hint: 'blank lines before the cut (0-10)' },
  'backup.dailyAt': { kind: 'text', hint: 'daily backup time HH:MM, empty = off' },
  'backup.onDayClose': { kind: 'boolean', hint: 'back up when the day is closed' },
  'backup.keep': { kind: 'number', hint: 'how many backups to keep (3-365)' },
};

export const settingChangeSchema = z.object({
  path: z.string().max(60),
  value: z.union([
    z.string().max(300),
    z.number(),
    z.boolean(),
    z.array(z.string().max(40)).max(20),
  ]),
});
export type SettingChange = z.infer<typeof settingChangeSchema>;

export const SETTINGS_ASSISTANT_EXAMPLES = [
  'Round bill totals to the nearest Rs 10',
  'Cashiers can give up to 15% discount',
  'Lock the screen after 5 minutes',
  'Print 2 copies of every receipt',
  "Don't print receipts automatically",
  'We use 58 mm paper',
  'Back up every day at 22:00',
];

const turnOff =
  /\b(off|stop|don'?t|do not|disable|never|no longer|not|without|turn off|switch off)\b/;

const APPROVAL_WORDS: [RegExp, ApprovalAction][] = [
  [/void/, 'VOID_SALE'],
  [/discount/, 'LARGE_DISCOUNT'],
  [/price/, 'PRICE_CHANGE'],
  [/refund|return/, 'REFUND'],
  [/cash ?out|take cash/, 'CASH_OUT'],
  [/stock/, 'STOCK_ADJUST'],
  [/drawer/, 'OPEN_DRAWER'],
  [/exit|close the (pos|full)/, 'EXIT_POS'],
  [/credit/, 'CREDIT_LIMIT'],
];

function interpretSettingsClause(clause: string, s: AllSettings): SettingChange[] | null {
  const raw = clause.trim().replace(/[.!]+$/, '');
  const t = raw.toLowerCase();
  const off = turnOff.test(t);

  if (/\bround/.test(t)) {
    if (/\b(no rounding|don'?t round|do not round|exact|cents|off)\b/.test(t))
      return [{ path: 'pos.roundingStep', value: 1 }];
    const n = /(?:nearest|to)\s*(?:rs\.?|rupees?)?\s*(1|5|10)\b/.exec(t)?.[1];
    if (n) return [{ path: 'pos.roundingStep', value: Number(n) * 100 }];
  }
  if (
    /auto(matic(ally)?)?[- ]?print|print (the )?receipts? (automatically|after (payment|paying))|print.*automatically/.test(
      t,
    )
  )
    return [{ path: 'pos.autoPrintReceipt', value: !off }];
  if (/\bcents\b/.test(t))
    return [{ path: 'pos.showCents', value: !/\b(hide|no|don'?t|without|off)\b/.test(t) }];
  if (/(no|zero|without|out of|negative) stock|stock (is|runs) out/.test(t))
    return [
      {
        path: 'pos.allowZeroStockSale',
        value: !/\b(don'?t|do not|block|stop|never|prevent|not allow|disallow)\b/.test(t),
      },
    ];
  if (/(ask|confirm).*remov|remov.*(ask|confirm)/.test(t))
    return [{ path: 'pos.confirmRemoveItem', value: !off }];
  if (/(start|default|new bills).*(wholesale|retail)/.test(t))
    return [{ path: 'pos.defaultPriceMode', value: /wholesale/.test(t) ? 'WHOLESALE' : 'RETAIL' }];
  if (/\block\b/.test(t) && /screen|idle|minute|automatically/.test(t)) {
    if (/never|don'?t|do not|off/.test(t)) return [{ path: 'pos.autoLockMinutes', value: 0 }];
    const m = /(\d+)\s*(min|minutes?)/.exec(t);
    if (m) {
      const want = Number(m[1]);
      const opts = [2, 5, 10, 15, 30, 60];
      const near = opts.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
      return [{ path: 'pos.autoLockMinutes', value: near }];
    }
  }
  const cur = /currency(?: symbol)?\s*(?:to|is|=|:|as)\s*(\S{1,5})/i.exec(raw);
  if (cur) return [{ path: 'pos.currencySymbol', value: cur[1]! }];

  const pct = /(\d+(?:\.\d+)?)\s*(%|percent)/.exec(t);
  if (pct && /discount/.test(t) && /cashier|without|limit|up to|max/.test(t)) {
    const bp = parsePercent(pct[1]!);
    if (bp !== null) return [{ path: 'approvals.cashierMaxDiscountBp', value: bp }];
  }
  if (/\b(admin|pin|approval|approve)\b/.test(t)) {
    const actions = APPROVAL_WORDS.filter(([re]) => re.test(t)).map(([, a]) => a);
    if (actions.length) {
      const remove = /\b(don'?t|do not|no|without|stop|never|not)\b/.test(t);
      const now = new Set(s.approvals.requireApprovalFor);
      for (const a of actions) {
        if (remove) now.delete(a);
        else now.add(a);
      }
      return [
        {
          path: 'approvals.requireApprovalFor',
          value: ALL_APPROVAL_ACTIONS.filter((a) => now.has(a)),
        },
      ];
    }
  }

  const copies = /\b(\d|one|two|three|single)\s+(copies|copy)\b/.exec(t);
  if (copies && !/shop copy/.test(t)) {
    const n = NUMBER_WORDS[copies[1]!] ?? Number(copies[1]);
    if (n >= 1 && n <= 3) return [{ path: 'receipt.copies', value: n }];
  }
  if (/shop copy/.test(t)) return [{ path: 'receipt.shopCopyForCredit', value: !off }];

  const shop =
    /^(?:(?:the|our|my)\s+)?(?:shop\s+)?(name|phone(?: number)?|telephone|address|e-?mail)\s+(?:is|to|=|:|should be)\s+(.+)$/i.exec(
      raw.replace(/^(change|set|update)\s+(the\s+)?/i, ''),
    );
  if (shop) {
    const key = /phone|tele/.test(shop[1]!.toLowerCase())
      ? 'phone'
      : /mail/.test(shop[1]!.toLowerCase())
        ? 'email'
        : shop[1]!.toLowerCase();
    return [{ path: `shop.${key}`, value: shop[2]!.trim().replace(/^["“']|["”']$/g, '') }];
  }

  if (/\b58\s*mm\b/.test(t)) return [{ path: 'printer.charsPerLine', value: 32 }];
  if (/\b80\s*mm\b/.test(t)) return [{ path: 'printer.charsPerLine', value: 48 }];
  if (/drawer/.test(t) && /open|kick/.test(t))
    return [{ path: 'printer.openDrawerOnCash', value: !off }];
  if (/\b(auto[- ]?)?cut\b/.test(t) && /paper|cut/.test(t))
    return [{ path: 'printer.autoCut', value: !off }];

  if (/back ?up/.test(t)) {
    const time =
      /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/.exec(t) ?? /\b(\d{1,2})[:.](\d{2})\b/.exec(t);
    if (time) {
      let h = Number(time[1]);
      if (time[3] === 'pm' && h < 12) h += 12;
      if (time[3] === 'am' && h === 12) h = 0;
      const value = `${String(h).padStart(2, '0')}:${time[2] ?? '00'}`;
      return [{ path: 'backup.dailyAt', value }];
    }
    if (/(no|stop|don'?t|turn off).*daily|daily.*(off)/.test(t))
      return [{ path: 'backup.dailyAt', value: '' }];
    const keep = /keep\s*(\d+)/.exec(t);
    if (keep) return [{ path: 'backup.keep', value: Number(keep[1]) }];
    if (/close/.test(t)) return [{ path: 'backup.onDayClose', value: !off }];
  }
  return null;
}

/** The built-in settings assistant (instant, offline). Changes are shown for approval first. */
export function interpretSettingsCommand(
  message: string,
  settings: AllSettings,
): AssistantReply<SettingChange> {
  const text = message.trim();
  if (!text)
    return { understood: false, reply: 'Type the setting you want to change.', actions: [] };
  if (/^(help|\?|what can you do|examples?)\??$/i.test(text)) {
    return {
      understood: true,
      reply: `Tell me what to change, for example:\n• ${SETTINGS_ASSISTANT_EXAMPLES.join('\n• ')}`,
      actions: [],
    };
  }
  const changes: SettingChange[] = [];
  for (const clause of text.split(
    /\s*(?:;|\n|,?\s+and then\s+|,?\s+also\s+|\.\s+|,?\s+and\s+(?=(?:set|make|turn|round|lock|print|cashiers?|our|the|we|back|use|show|hide|don'?t|ask|allow)\b))\s*/i,
  )) {
    if (!clause.trim()) continue;
    const found = interpretSettingsClause(clause, settings);
    if (!found) {
      return {
        understood: false,
        reply: `I did not understand "${clause.trim()}". Try for example: "${SETTINGS_ASSISTANT_EXAMPLES[0]}" or "${SETTINGS_ASSISTANT_EXAMPLES[2]}".`,
        actions: [],
      };
    }
    changes.push(...found);
  }
  return { understood: true, reply: '', actions: changes };
}

export interface SettingChangesResult {
  /** The settings with the changes (only sections that changed differ). */
  next: AllSettings;
  sections: SettingsSection[];
  /** Readable list: "Round bill totals to: Nearest 1 → Nearest 10". */
  summary: string[];
  problems: string[];
}

/**
 * Apply setting changes from the assistant: only settings in `ASSISTANT_SETTINGS`, each section
 * checked with the same rules the server uses. A change that breaks a rule is refused.
 */
export function applySettingChanges(
  settings: AllSettings,
  changes: readonly SettingChange[],
): SettingChangesResult {
  const next = JSON.parse(JSON.stringify(settings)) as AllSettings;
  const sections = new Set<SettingsSection>();
  const summary: string[] = [];
  const problems: string[] = [];
  for (const raw of changes) {
    const parsed = settingChangeSchema.safeParse(raw);
    const info = parsed.success ? ASSISTANT_SETTINGS[parsed.data.path] : undefined;
    if (!parsed.success || !info) {
      problems.push(
        `"${String((raw as { path?: unknown }).path ?? '?')}" cannot be changed by the assistant.`,
      );
      continue;
    }
    const { path } = parsed.data;
    let value: unknown = parsed.data.value;
    if (info.kind === 'boolean' && typeof value === 'string')
      value = /^(true|on|yes|1)$/i.test(value);
    if (
      (info.kind === 'number' ||
        info.kind === 'percent' ||
        (info.kind === 'choice' && typeof info.options?.[0] === 'number')) &&
      typeof value === 'string'
    )
      value = Number(value);
    if (info.kind === 'choice' && !info.options?.includes(value as never)) {
      problems.push(`${SETTING_INFO[path]?.label ?? path} cannot be ${String(value)}.`);
      continue;
    }
    const [section, key] = path.split('.') as [SettingsSection, string];
    const before = (settings[section] as Record<string, unknown>)[key];
    (next[section] as Record<string, unknown>)[key] = value;
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      sections.add(section);
      summary.push(
        `${SETTING_INFO[path]?.label ?? path}: ${formatSetting(path, before)} → ${formatSetting(path, value)}`,
      );
    }
  }
  for (const section of [...sections]) {
    const ok = SETTINGS_SCHEMAS[section].safeParse(next[section]);
    if (!ok.success) {
      problems.push(ok.error.issues[0]?.message ?? `Invalid ${section} settings`);
      (next as Record<SettingsSection, unknown>)[section] = settings[section];
      sections.delete(section);
    } else {
      (next as Record<SettingsSection, unknown>)[section] = ok.data;
    }
  }
  return { next, sections: [...sections], summary, problems };
}

/** Field names for prompts and help: "{bill_no} = Bill number". */

export const APPROVAL_HELP = ALL_APPROVAL_ACTIONS.map((a) => `${a} = ${APPROVAL_ACTIONS[a]}`).join(
  ', ',
);

/** "10%" for basis points, for replies. */
export const percentText = (bp: number) => `${bpToPercentText(bp)}%`;

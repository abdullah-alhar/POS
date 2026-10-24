import { z } from 'zod';
import type { Permission } from './permissions';

/**
 * "Ask" — the assistant on every page. Questions in plain words become one of a few skills
 * (today's sales, compare two months, best sellers, low stock, a customer's balance, open a page,
 * how do I …). The built-in interpreter below understands the usual questions without internet.
 * An AI, when the shop has one, understands everything else (any language, follow-up questions)
 * by picking skills; every number is still worked out on the shop computer from the shop's own
 * data. Only when the shop allows it does the AI read those results to explain them in its own
 * words, with customer names replaced by codes.
 */

export const ASK_PERIODS = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_year: 'This year',
  last_year: 'Last year',
} as const;
export type AskPeriod = keyof typeof ASK_PERIODS;
const PERIOD_KEYS = Object.keys(ASK_PERIODS) as [AskPeriod, ...AskPeriod[]];

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The dates of a period (both days included), from today's date YYYY-MM-DD. */
export function periodRange(period: AskPeriod, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: monday, to: today };
    case 'last_week':
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'this_month':
      return { from: monthStart(y, m), to: today };
    case 'last_month': {
      const from = m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1);
      return { from, to: addDays(monthStart(y, m), -1) };
    }
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
    case 'this_year':
      return { from: `${y}-01-01`, to: today };
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

/** The period just before, to compare with ("this month" → "last month"). */
export function previousPeriod(period: AskPeriod): AskPeriod {
  const map: Partial<Record<AskPeriod, AskPeriod>> = {
    today: 'yesterday',
    this_week: 'last_week',
    this_month: 'last_month',
    this_year: 'last_year',
  };
  return map[period] ?? period;
}

/** Pages Ask can open, with the words people use for them. */
export const ASK_PAGES: Record<string, { label: string; to: string; words: string[] }> = {
  home: { label: 'Home', to: '/dashboard', words: ['home', 'dashboard', 'start', 'main'] },
  billing: {
    label: 'Billing',
    to: '/billing',
    words: ['billing', 'till', 'sell', 'new sale', 'pos', 'checkout', 'cashier screen'],
  },
  sales: {
    label: 'Bills',
    to: '/sales',
    words: ['bills', 'sales history', 'invoices', 'old bills', 'receipts history'],
  },
  returns: { label: 'Returns', to: '/returns', words: ['returns', 'refunds'] },
  newReturn: {
    label: 'New return',
    to: '/returns/new',
    words: ['new return', 'return an item', 'make a return', 'refund an item'],
  },
  customers: {
    label: 'Customers',
    to: '/customers',
    words: ['customers', 'credit customers', 'customer list'],
  },
  products: {
    label: 'Products',
    to: '/products',
    words: ['products', 'items', 'item list', 'product list', 'prices'],
  },
  newProduct: {
    label: 'New product',
    to: '/products/new',
    words: ['new product', 'add product', 'add item', 'add a product', 'add an item'],
  },
  stock: {
    label: 'Stock',
    to: '/stock',
    words: ['stock', 'inventory', 'stock count', 'adjust stock'],
  },
  labels: {
    label: 'Barcode labels',
    to: '/labels',
    words: ['labels', 'barcode labels', 'stickers', 'print barcodes'],
  },
  catalog: { label: 'Categories and brands', to: '/catalog', words: ['categories', 'brands'] },
  purchases: {
    label: 'Purchases',
    to: '/purchases',
    words: ['purchases', 'stock arrived', 'goods received', 'buying'],
  },
  suppliers: { label: 'Suppliers', to: '/suppliers', words: ['suppliers', 'vendors'] },
  cash: {
    label: 'Cash register',
    to: '/cash',
    words: [
      'cash',
      'cash register',
      'drawer',
      'close the day',
      'end of day',
      'open the day',
      'day end',
    ],
  },
  expenses: { label: 'Expenses', to: '/expenses', words: ['expenses', 'costs', 'bills to pay'] },
  reports: {
    label: 'Reports',
    to: '/reports',
    words: ['reports', 'profit report', 'sales report', 'charts'],
  },
  settings: {
    label: 'Settings',
    to: '/settings',
    words: ['settings', 'setup', 'options', 'preferences'],
  },
  receipt: {
    label: 'Receipt Studio',
    to: '/settings/receipt',
    words: [
      'receipt studio',
      'receipt design',
      'receipt editor',
      'bill design',
      'design the receipt',
    ],
  },
  printer: {
    label: 'Printer settings',
    to: '/settings?s=printer',
    words: ['printer', 'printer settings', 'receipt printer'],
  },
  ai: {
    label: 'AI settings',
    to: '/settings?s=assistant',
    words: ['ai settings', 'ai', 'assistant settings', 'groq', 'api key'],
  },
  users: {
    label: 'Users',
    to: '/users',
    words: ['users', 'cashiers', 'staff', 'pins', 'employees'],
  },
  backups: { label: 'Backups', to: '/backups', words: ['backups', 'backup', 'restore', 'usb'] },
  audit: {
    label: 'Audit log',
    to: '/audit',
    words: ['audit', 'audit log', 'who did', 'activity log'],
  },
};
const PAGE_KEYS = Object.keys(ASK_PAGES) as [string, ...string[]];

/** Short how-to answers (from the owner's guide), found by their words, even offline. */
export const HELP_TOPICS: Record<
  string,
  { title: string; words: string[]; answer: string[]; page?: string }
> = {
  sale: {
    title: 'Making a sale',
    words: ['sale', 'sell', 'bill', 'scan', 'checkout', 'pay', 'payment'],
    answer: [
      'Open Billing and scan the item, or type its name, code or barcode and press Enter.',
      'Type 3 then * before scanning to add 3. F3 picks a customer, F8 gives a discount.',
      'Press F4 to pay: type the amount and Enter (C cash, K card, B bank transfer, A on account).',
    ],
    page: 'billing',
  },
  discount: {
    title: 'Giving a discount',
    words: ['discount', 'reduce', 'cheaper', 'off'],
    answer: [
      'Item discount: select the item and press Ctrl+D (or double-click it).',
      'Whole bill: press F8. Cashiers need an admin PIN above their limit (Settings → Admin approval).',
    ],
    page: 'billing',
  },
  hold: {
    title: 'Holding a bill for later',
    words: ['hold', 'park', 'later', 'recall', 'wait'],
    answer: ['F6 holds the bill on the screen; F7 brings a held bill back.'],
    page: 'billing',
  },
  quote: {
    title: 'Printing a quotation',
    words: ['quotation', 'quote', 'estimate', 'price offer'],
    answer: [
      'Ring the items up on Billing and press Ctrl+Q. Nothing is sold and the bill stays on the screen.',
    ],
    page: 'billing',
  },
  returns: {
    title: 'Taking a return',
    words: ['return', 'refund', 'exchange', 'give back'],
    answer: [
      'Returns → New return. Scan the receipt barcode (or type the bill number).',
      'Choose the items and how many, tick Damaged if it cannot be sold again, and choose how the money is given back.',
    ],
    page: 'newReturn',
  },
  closeDay: {
    title: 'Closing the day',
    words: ['close', 'end of day', 'day end', 'count cash', 'z report', 'closing'],
    answer: [
      'Home → Close the day (or Cash). Count the notes and coins and type how many of each.',
      'The screen shows if the drawer is short or over. Press Close the day and print: the report prints and a backup is made.',
    ],
    page: 'cash',
  },
  openDay: {
    title: 'Opening the day',
    words: ['open the day', 'start the day', 'opening cash', 'float'],
    answer: [
      'Billing asks for it before the first sale: type the cash in the drawer (the float) and press Open.',
    ],
    page: 'cash',
  },
  credit: {
    title: 'Selling on credit and taking payments',
    words: ['credit', 'account', 'owe', 'debt', 'pay later', 'payment from customer'],
    answer: [
      'Give the customer a credit limit (Customers → the customer). On Billing press F3, pick them, then F4 → On account.',
      'When they pay: Customers → open the customer → Receive payment.',
    ],
    page: 'customers',
  },
  products: {
    title: 'Adding products and prices',
    words: ['product', 'item', 'price', 'add item', 'import', 'excel', 'barcode'],
    answer: [
      'Products → New product: name, prices, barcode, stock. Warranty and IMEI tracking are there too.',
      'Many at once: Products → Import reads an Excel or CSV list.',
    ],
    page: 'products',
  },
  purchase: {
    title: 'Adding stock that arrived',
    words: ['purchase', 'stock arrived', 'supplier', 'receive', 'restock', 'goods'],
    answer: [
      'Purchases → New purchase. Add the items and quantities, then Receive into stock. Cost prices update too.',
    ],
    page: 'purchases',
  },
  labels: {
    title: 'Printing barcode labels',
    words: ['label', 'sticker', 'print barcode'],
    answer: ['Products → Barcode labels: choose items and how many, then print the sheet.'],
    page: 'labels',
  },
  users: {
    title: 'Adding a cashier',
    words: ['cashier', 'user', 'staff', 'pin', 'password', 'employee'],
    answer: ['Settings → Users → Add user: give a name, a PIN and tick what they may do.'],
    page: 'users',
  },
  backup: {
    title: 'Backups',
    words: ['backup', 'restore', 'usb', 'google drive', 'lose data'],
    answer: [
      'A backup is made every night and when you close the day.',
      'Settings → Backups: add a USB folder or Google Drive so a broken laptop does not lose the shop data.',
    ],
    page: 'backups',
  },
  receipt: {
    title: 'Changing the receipt',
    words: ['receipt', 'logo', 'footer', 'header', 'qr', 'whatsapp', 'print design'],
    answer: [
      'Settings → Receipt → Open the Receipt Studio. Click, drag and style the pieces, or tell its assistant what you want.',
    ],
    page: 'receipt',
  },
  printer: {
    title: 'Printer problems',
    words: ['printer', 'not printing', 'paper', 'drawer', 'cash drawer'],
    answer: [
      'Check the printer is on, has paper and the cable is in. Settings → Printer → Test print.',
      'If it still fails the receipt prints through Chrome, so a sale is never stuck.',
    ],
    page: 'printer',
  },
  warranty: {
    title: 'Warranty and IMEI',
    words: ['warranty', 'imei', 'serial', 'guarantee'],
    answer: [
      'Turn on Serial number / IMEI and set the warranty on the product. Type the IMEI on Sales → Bills to find the bill later.',
    ],
    page: 'sales',
  },
  expenses: {
    title: 'Recording expenses',
    words: ['expense', 'rent', 'electricity', 'salary', 'spent'],
    answer: [
      'Cash → Expenses → Add expense. Choose "Cash from the drawer" if the money came from the till.',
    ],
    page: 'expenses',
  },
  ai: {
    title: 'Turning on a free AI',
    words: ['ai', 'groq', 'gemini', 'api key', 'smart', 'chatgpt'],
    answer: [
      'Settings → Assistant → choose "Free online AI", pick Groq and paste a free key from console.groq.com.',
      'Everything also works without AI and without internet.',
    ],
    page: 'ai',
  },
};
const TOPIC_KEYS = Object.keys(HELP_TOPICS) as [string, ...string[]];

export const ASK_SKILLS = {
  sales: { label: 'Sales and profit for a period', permission: 'reports.view' },
  compare: { label: 'Compare two periods', permission: 'reports.view' },
  best: { label: 'Best-selling items', permission: 'reports.view' },
  slow: { label: 'Items that are not selling', permission: 'reports.view' },
  expenses: { label: 'Expenses for a period', permission: 'reports.view' },
  lowStock: { label: 'Items running low or out of stock', permission: 'products.view' },
  item: { label: 'Stock and price of an item', permission: 'products.view' },
  customer: { label: "A customer's balance", permission: 'customers.manage' },
  owed: { label: 'Customers who owe money', permission: 'customers.manage' },
  cash: { label: 'Cash in the drawer today', permission: 'cash.register' },
  goto: { label: 'Open a page', permission: null },
  help: { label: 'How to do something', permission: null },
  settings: { label: 'Change a setting', permission: 'settings.manage' },
  hello: { label: 'Say hello, thanks, or what the assistant can do', permission: null },
} as const satisfies Record<string, { label: string; permission: Permission | null }>;
export type AskSkill = keyof typeof ASK_SKILLS;
const SKILL_KEYS = Object.keys(ASK_SKILLS) as [AskSkill, ...AskSkill[]];

/** What to do with a question (flat, so a small AI model can fill it in too). */
export const askIntentSchema = z.object({
  skill: z.enum(SKILL_KEYS),
  period: z.enum(PERIOD_KEYS).optional(),
  /** compare: the second period. */
  period2: z.enum(PERIOD_KEYS).optional(),
  /** item / customer: what to look for. */
  query: z.string().trim().max(80).optional(),
  page: z.enum(PAGE_KEYS).optional(),
  topic: z.enum(TOPIC_KEYS).optional(),
  limit: z.int().min(1).max(20).optional(),
});
export type AskIntent = z.infer<typeof askIntentSchema>;

/** Ready-made questions, shown as buttons (also tried by the tests). */
export const ASK_EXAMPLES = [
  'How are sales today?',
  'Compare this month with last month',
  'Best sellers this week',
  'What is running low?',
  'Who owes us money?',
  'How much cash is in the drawer?',
  'How do I close the day?',
  'Open reports',
];

const PERIOD_WORDS: [RegExp, AskPeriod][] = [
  [/\btoday\b|\bthis day\b|\bso far\b/, 'today'],
  [/\byesterday\b/, 'yesterday'],
  [/\blast week\b|\bprevious week\b/, 'last_week'],
  [/\bthis week\b|\bweek so far\b/, 'this_week'],
  [/\blast month\b|\bprevious month\b/, 'last_month'],
  [/\bthis month\b|\bmonth so far\b/, 'this_month'],
  [/\b(last|past) 7 days\b|\b(last|past) seven days\b/, 'last_7_days'],
  [/\b(last|past) 30 days\b|\b(last|past) thirty days\b/, 'last_30_days'],
  [/\blast year\b|\bprevious year\b/, 'last_year'],
  [/\bthis year\b|\byear so far\b/, 'this_year'],
];

/** Periods named in the text, in the order they appear. */
function periodsIn(text: string): AskPeriod[] {
  const found: { at: number; p: AskPeriod }[] = [];
  for (const [re, p] of PERIOD_WORDS) {
    const m = new RegExp(re.source, 'g');
    let hit: RegExpExecArray | null;
    while ((hit = m.exec(text))) found.push({ at: hit.index, p });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

function findPage(words: string): string | undefined {
  const w = words
    .replace(/\b(the|page|screen|please|my|our)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!w) return undefined;
  let best: { key: string; score: number } | undefined;
  for (const [key, page] of Object.entries(ASK_PAGES)) {
    for (const word of page.words) {
      const score = w === word ? 100 : w.includes(word) ? word.length : 0;
      if (score && (!best || score > best.score)) best = { key, score };
    }
  }
  return best?.key;
}

/** The how-to topic whose words best match the question. */
export function findHelpTopic(text: string): string | undefined {
  const t = text.toLowerCase();
  let best: { key: string; score: number } | undefined;
  for (const [key, topic] of Object.entries(HELP_TOPICS)) {
    const score = topic.words.reduce((n, w) => n + (t.includes(w) ? w.length + 2 : 0), 0);
    if (score && (!best || score > best.score)) best = { key, score };
  }
  return best?.key;
}

const normalise = (message: string) =>
  message
    .toLowerCase()
    .replace(/[?!.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const GREETINGS =
  'hi+|hello+|hey+|hai|hiya|helo|yo|good (?:morning|afternoon|evening|day)|salam|salaam|assalamu ?alaikum|ayubowan|vanakkam|namaste|hola|bonjour|ආයුබෝවන්|வணக்கம்';
const GREETING_START = new RegExp(`^(?:${GREETINGS})(?: there| assistant| ask| friend)?\\b\\s*`);

/**
 * Greetings, thanks and "what can you do?" in a few words: answered at once, also offline.
 */
export function smallTalk(message: string): 'greeting' | 'thanks' | 'about' | null {
  const t = normalise(message);
  if (!t) return null;
  if (new RegExp(`^(?:${GREETINGS})(?: there| assistant| ask| friend| all| everyone)?$`).test(t))
    return 'greeting';
  if (/^(?:how are you(?: doing| today)?|how r u|how's it going|whats up|what's up|sup)$/.test(t))
    return 'greeting';
  if (
    /^(?:(?:ok(?:ay)?|great|nice|good|cool|perfect|super|awesome|fine) ?)*(?:thanks?(?: you)?(?: so much| a lot| very much)?|thank u|thx|ty|cheers|tnx)?$/.test(
      t,
    ) &&
    t.length <= 40
  )
    return 'thanks';
  if (
    /^(?:help|help me|menu|what can you do|what can i ask(?: you)?|what do you do|who are you|what are you|how do(?:es)? (?:you|this|it) work|what can this do)$/.test(
      t,
    )
  )
    return 'about';
  return null;
}

/** What Ask is sent: the question and the questions asked before it (for "and last month?"). */
export const askRequestSchema = z.object({
  message: z.string().trim().min(1, 'Type a question').max(1000, 'Keep the question shorter'),
  history: z.array(z.string().trim().max(500)).max(6).default([]),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

/**
 * Understand a question without any AI. Returns null when it is not understood (the AI, if the
 * shop has one, is asked next; otherwise Ask suggests what it can do).
 */
export function interpretAsk(message: string): AskIntent | null {
  const words = normalise(message);
  if (smallTalk(message)) return { skill: 'hello' };
  // "hi, how are sales today?" is a question with a greeting in front.
  const t = ` ${words.replace(GREETING_START, '').trim()} `;
  const periods = periodsIn(t);
  const howTo =
    /^ (how (do|can|should) (i|we|you)|how to|where (do|can|is)|what is the way|can i|help( me)?|explain|teach)\b/.test(
      t,
    );

  // Asking for advice ("ideas to sell more") is not asking for figures: that is for the AI.
  const advice =
    /\b(ideas?|tips?|advice|suggest|increase|improve|grow|boost|strategy|promote|marketing|attract)\b/.test(
      t,
    );

  if (!howTo && !advice) {
    // Comparing periods.
    if (
      /\b(compare|comparison|vs|versus|against|better than|worse than|difference between)\b/.test(t)
    ) {
      const first = periods[0] ?? 'this_month';
      return { skill: 'compare', period: first, period2: periods[1] ?? previousPeriod(first) };
    }
    // Items: best and slow sellers.
    if (/\b(slow|not selling|dead stock|least (sold|selling)|nobody buys|no sales)\b/.test(t))
      return { skill: 'slow', period: periods[0] ?? 'last_30_days' };
    if (
      /\b(best|top|most popular|most sold|selling most|sold most|fast moving|hot)\b/.test(t) &&
      /\b(sell|seller|sellers|selling|sold|item|items|product|products|popular|moving)\b/.test(t)
    ) {
      const n = /\btop (\d{1,2})\b/.exec(t)?.[1];
      return {
        skill: 'best',
        period: periods[0] ?? 'this_month',
        ...(n && { limit: Math.min(20, Number(n)) }),
      };
    }
    // Stock.
    if (
      /\b(low stock|running (low|out)|out of stock|reorder|re-order|need to (buy|order)|what (should|do) (i|we) (buy|order)|finished items|almost finished)\b/.test(
        t,
      )
    )
      return { skill: 'lowStock' };
    // Customers.
    const owe =
      /\b(?:how much (?:does|do|is)|what does) (.+?) (?:owe|owes|have to pay|balance)\b/.exec(t);
    if (owe && !/\b(customers|everyone|people|they)\b/.test(owe[1]!))
      return { skill: 'customer', query: owe[1]!.trim() };
    const balance = /\b(?:balance|credit|debt) (?:of|for) (.+?) $/.exec(t);
    if (balance) return { skill: 'customer', query: balance[1]!.trim() };
    if (
      /\b(who owes|owe us|owes us|outstanding|unpaid|debtors|customers? (with )?(credit|debt|balance)|money (owed|due))\b/.test(
        t,
      )
    )
      return { skill: 'owed' };
    // Cash.
    if (
      /\b(cash in (the )?(drawer|till)|how much cash|drawer (total|balance|cash)|expected cash|cash (now|today))\b/.test(
        t,
      )
    )
      return { skill: 'cash' };
    // Expenses.
    if (/\b(expenses?|spent|spending|costs)\b/.test(t) && !/\b(add|record|enter|new)\b/.test(t))
      return { skill: 'expenses', period: periods[0] ?? 'this_month' };
    // Sales and profit.
    if (
      /\b(sales|sold|sell|revenue|income|profit|business|takings|turnover|earned|earn|made|bills|how (are|is|was|were) (we|things|it|sales|business))\b/.test(
        t,
      ) &&
      !/\b(bill design|receipt)\b/.test(t)
    )
      return { skill: 'sales', period: periods[0] ?? 'today' };
    // Item stock or price.
    const item =
      /\b(?:how many|stock of|price of|cost of|how much (?:is|are|for)|do we have(?: any)?|is there(?: any)?|have we got) (.+?)(?: (?:left|in stock|available|now|today))? $/.exec(
        t,
      ) ?? /\b(?:find|look up|check|search(?: for)?) (?:the )?(?:item |product )?(.+?) $/.exec(t);
    if (item && item[1]!.trim().length >= 2 && !/^(money|cash|bills?)$/.test(item[1]!.trim()))
      return {
        skill: 'item',
        query: item[1]!
          .replace(/\b(the|a|an|some)\b/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    // Open a page.
    const go =
      /^ (?:open|go to|goto|show(?: me)?|take me to|switch to|bring up|i want to go to|navigate to) (.+?) $/.exec(
        t,
      );
    if (go) {
      const page = findPage(go[1]!);
      if (page) return { skill: 'goto', page };
    }
    const bare = findPage(t.trim());
    if (bare && ASK_PAGES[bare]!.words.includes(t.trim())) return { skill: 'goto', page: bare };
  }

  const topic = findHelpTopic(t);
  if (topic && (howTo || /\b(how|where|what|why|help)\b/.test(t))) return { skill: 'help', topic };
  return null;
}

import { AI_PROVIDERS, type AiProviderId } from './ai-providers';
import { bpToPercentText } from './money';
import { APPROVAL_ACTIONS, type ApprovalAction } from './permissions';
import { diffLayouts, summarizeChanges, type LayoutChange } from './receipt-tools';
import type { ReceiptElement } from './receipt-layout';
import type { AllSettings, SettingsSection } from './schemas/settings';

/**
 * Helpers to compare settings (saved vs. new, now vs. an older version, this shop vs. a file)
 * and to check them for common problems, in words a shop owner understands.
 */

export const SECTION_LABELS: Record<SettingsSection, string> = {
  shop: 'Shop details',
  receipt: 'Receipt',
  receiptLibrary: 'Saved receipt designs',
  tax: 'VAT',
  pos: 'Billing',
  approvals: 'Admin approval',
  printer: 'Printer',
  backup: 'Backups',
  branding: 'Branding',
  ai: 'Assistant',
};

const yesNo = (v: unknown) => (v ? 'On' : 'Off');
const percent = (v: unknown) => `${bpToPercentText(Number(v))}%`;
const ROUNDING: Record<number, string> = {
  1: 'No rounding',
  100: 'Nearest 1',
  500: 'Nearest 5',
  1000: 'Nearest 10',
};

/** Labels (and how to show the value) for settings, by "section.field". */
export const SETTING_INFO: Record<string, { label: string; format?: (v: unknown) => string }> = {
  'shop.name': { label: 'Shop name' },
  'shop.address': { label: 'Address' },
  'shop.phone': { label: 'Phone' },
  'shop.email': { label: 'Email' },
  'receipt.layout': { label: 'Receipt design' },
  'receipt.copies': { label: 'Copies of every receipt' },
  'receipt.shopCopyForCredit': { label: 'Shop copy for credit sales', format: yesNo },
  'receipt.language': { label: 'Receipt language' },
  'receiptLibrary.designs': {
    label: 'Saved designs',
    format: (v) => (Array.isArray(v) ? v.map((d: { name: string }) => d.name).join(', ') : ''),
  },
  'tax.vatRegistered': { label: 'VAT registered', format: yesNo },
  'tax.vatNumber': { label: 'VAT number' },
  'tax.pricesIncludeTax': { label: 'Shelf prices include VAT', format: yesNo },
  'tax.showTaxOnReceipt': { label: 'Show VAT on the receipt', format: yesNo },
  'pos.currencySymbol': { label: 'Currency symbol' },
  'pos.roundingStep': {
    label: 'Round bill totals to',
    format: (v) => ROUNDING[Number(v)] ?? String(v),
  },
  'pos.showCents': { label: 'Show cents', format: yesNo },
  'pos.allowZeroStockSale': { label: 'Sell items with no stock', format: yesNo },
  'pos.defaultPriceMode': {
    label: 'New bills start in',
    format: (v) => (v === 'WHOLESALE' ? 'Wholesale' : 'Retail'),
  },
  'pos.autoPrintReceipt': { label: 'Print receipt after payment', format: yesNo },
  'pos.autoLockMinutes': {
    label: 'Lock the screen after',
    format: (v) => (Number(v) ? `${v} minutes` : 'Never'),
  },
  'pos.confirmRemoveItem': { label: 'Ask before removing an item', format: yesNo },
  'approvals.cashierMaxDiscountBp': { label: 'Cashier discount limit', format: percent },
  'approvals.requireApprovalFor': {
    label: 'Admin PIN needed to',
    format: (v) =>
      Array.isArray(v) && v.length
        ? v.map((a) => APPROVAL_ACTIONS[a as ApprovalAction] ?? a).join('; ')
        : 'Nothing',
  },
  'printer.mode': {
    label: 'Printer',
    format: (v) =>
      ({
        browser: 'Chrome printing',
        windows: 'Receipt printer (USB)',
        network: 'Network printer',
        file: 'Save to file',
      })[String(v)] ?? String(v),
  },
  'printer.windowsPrinterName': { label: 'Windows printer' },
  'printer.networkHost': { label: 'Printer address' },
  'printer.networkPort': { label: 'Printer port' },
  'printer.charsPerLine': {
    label: 'Paper width',
    format: (v) => `${v} letters per line${Number(v) === 32 ? ' (58 mm)' : ' (80 mm)'}`,
  },
  'printer.autoCut': { label: 'Cut the paper', format: yesNo },
  'printer.openDrawerOnCash': { label: 'Open the drawer for cash', format: yesNo },
  'printer.feedLines': { label: 'Blank lines before the cut' },
  'printer.logo': { label: 'Printer logo', format: (v) => (v ? 'Prepared' : 'None') },
  'backup.dailyAt': { label: 'Daily backup at', format: (v) => (v ? String(v) : 'Off') },
  'backup.onDayClose': { label: 'Back up when the day is closed', format: yesNo },
  'backup.keep': { label: 'Backups to keep' },
  'backup.usbPath': { label: 'USB backup folder' },
  'backup.driveUpload': { label: 'Upload to Google Drive', format: yesNo },
  'branding.appName': { label: 'App name' },
  'branding.logo': { label: 'Logo', format: (v) => (v ? 'Custom logo' : 'Built-in logo') },
  'branding.primaryColor': { label: 'Colour' },
  'branding.sidebar': { label: 'Sidebar' },
  'branding.startupAnimation': { label: 'Startup animation', format: yesNo },
  'ai.mode': {
    label: 'AI',
    format: (v) =>
      ({ off: 'Built-in only', online: 'Free online AI', local: 'AI on this computer' })[
        String(v)
      ] ?? String(v),
  },
  'ai.provider': {
    label: 'Online AI service',
    format: (v) => AI_PROVIDERS[v as AiProviderId]?.name ?? String(v),
  },
  'ai.model': { label: 'Online AI model', format: (v) => (v ? String(v) : 'Recommended') },
  'ai.customUrl': { label: 'Other service address' },
  'ai.localUrl': { label: 'Local AI address' },
  'ai.localModel': { label: 'Local AI model' },
  'ai.shareResults': {
    label: 'AI may read the answers it explains',
    format: (v) => (v ? 'Yes (customer names hidden)' : 'No, only the question'),
  },
};

/** A setting shown the way people read it. */
export function formatSetting(path: string, value: unknown): string {
  const info = SETTING_INFO[path];
  if (info?.format) return info.format(value);
  if (value === '' || value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return yesNo(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface SettingDiffRow {
  path: string;
  section: SettingsSection;
  label: string;
  before: string;
  after: string;
  /** For the receipt design: what changed piece by piece. */
  layoutChanges?: LayoutChange[];
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every setting that differs between two copies of the settings (only the sections in both).
 * Logos stored in the audit log as "[image]" are not compared.
 */
export function diffSettings(
  before: Partial<Record<SettingsSection, unknown>>,
  after: Partial<Record<SettingsSection, unknown>>,
): SettingDiffRow[] {
  const rows: SettingDiffRow[] = [];
  for (const section of Object.keys(SECTION_LABELS) as SettingsSection[]) {
    const a = before[section] as Record<string, unknown> | undefined;
    const b = after[section] as Record<string, unknown> | undefined;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') continue;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const va = a[key];
      const vb = b[key];
      if (va === '[image]' || vb === '[image]' || equal(va, vb)) continue;
      const path = `${section}.${key}`;
      const label = SETTING_INFO[path]?.label ?? key;
      if (path === 'receipt.layout' && Array.isArray(va) && Array.isArray(vb)) {
        const changes = diffLayouts(va as ReceiptElement[], vb as ReceiptElement[]);
        if (!changes.length) continue;
        rows.push({
          path,
          section,
          label,
          before: `${va.length} pieces`,
          after: `${vb.length} pieces (${summarizeChanges(changes)})`,
          layoutChanges: changes,
        });
        continue;
      }
      rows.push({
        path,
        section,
        label,
        before: formatSetting(path, va),
        after: formatSetting(path, vb),
      });
    }
  }
  return rows;
}

export interface SettingsIssue {
  id: string;
  level: 'error' | 'warning' | 'tip';
  title: string;
  detail: string;
  /** Where to fix it. */
  section: SettingsSection;
}

/** Common setup problems, worst first (shown at the top of Settings). */
export function checkSettings(s: AllSettings): SettingsIssue[] {
  const out: SettingsIssue[] = [];
  if (!s.shop.phone.trim())
    out.push({
      id: 'shop-phone',
      level: 'tip',
      title: 'No shop phone number',
      detail: 'Customers look for it on the receipt.',
      section: 'shop',
    });
  if (!s.shop.address.trim())
    out.push({
      id: 'shop-address',
      level: 'tip',
      title: 'No shop address',
      detail: 'It is printed under the shop name.',
      section: 'shop',
    });
  if (s.approvals.cashierMaxDiscountBp > 5000)
    out.push({
      id: 'discount-limit',
      level: 'warning',
      title: `Cashiers can give ${bpToPercentText(s.approvals.cashierMaxDiscountBp)}% off alone`,
      detail: 'Most shops keep this at 10% or less.',
      section: 'approvals',
    });
  if (!s.approvals.requireApprovalFor.includes('VOID_SALE'))
    out.push({
      id: 'void-approval',
      level: 'warning',
      title: 'Cashiers can void bills without an admin',
      detail: 'Voids are a common way to lose money; ask for an admin PIN.',
      section: 'approvals',
    });
  if (!s.backup.dailyAt)
    out.push({
      id: 'daily-backup',
      level: 'warning',
      title: 'No daily backup',
      detail: 'Set a time for the automatic backup, e.g. 21:30.',
      section: 'backup',
    });
  if (!s.backup.usbPath.trim() && !s.backup.driveUpload)
    out.push({
      id: 'offsite-backup',
      level: 'tip',
      title: 'Backups stay on this computer only',
      detail: 'Add a USB folder or Google Drive so a broken laptop does not lose the shop data.',
      section: 'backup',
    });
  if (s.printer.mode === 'browser')
    out.push({
      id: 'browser-printing',
      level: 'tip',
      title: 'Printing through Chrome',
      detail: 'A USB receipt printer prints faster and opens the cash drawer.',
      section: 'printer',
    });
  if (!s.pos.autoLockMinutes)
    out.push({
      id: 'auto-lock',
      level: 'tip',
      title: 'The screen never locks by itself',
      detail: 'Locking after a few idle minutes stops others using your login.',
      section: 'pos',
    });
  const order = { error: 0, warning: 1, tip: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

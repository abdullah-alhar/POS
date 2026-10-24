import {
  FileDown,
  History,
  LayoutGrid,
  Palette,
  Printer,
  ReceiptText,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsIssue } from '@shoppos/shared';

/** The pages of Settings, how they are grouped, and what the search box finds on them. */

export type PageId =
  | 'overview'
  | 'shop'
  | 'receipt'
  | 'printer'
  | 'billing'
  | 'approvals'
  | 'look'
  | 'assistant'
  | 'history'
  | 'copy';

export const PAGES: {
  id: PageId;
  label: string;
  icon: LucideIcon;
  hint: string;
  group: string;
  /** Icon tile colour on the overview. */
  tone: string;
}[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    hint: 'Setup check and assistant',
    group: '',
    tone: '',
  },
  {
    id: 'shop',
    label: 'Shop details',
    icon: Store,
    hint: 'Name, address, phone',
    group: 'Your shop',
    tone: 'bg-sky-500/12 text-sky-600',
  },
  {
    id: 'receipt',
    label: 'Receipt',
    icon: ReceiptText,
    hint: 'Design the printed bill',
    group: 'Your shop',
    tone: 'bg-violet-500/12 text-violet-600',
  },
  {
    id: 'printer',
    label: 'Printer',
    icon: Printer,
    hint: 'Receipt printer and drawer',
    group: 'Your shop',
    tone: 'bg-slate-500/12 text-slate-600',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: ScanBarcode,
    hint: 'Rounding, stock, screen lock',
    group: 'Selling',
    tone: 'bg-emerald-500/12 text-emerald-600',
  },
  {
    id: 'approvals',
    label: 'Admin approval',
    icon: ShieldCheck,
    hint: 'What needs an admin PIN',
    group: 'Selling',
    tone: 'bg-rose-500/12 text-rose-600',
  },
  {
    id: 'look',
    label: 'Look',
    icon: Palette,
    hint: 'Light or dark',
    group: 'App',
    tone: 'bg-pink-500/12 text-pink-600',
  },
  {
    id: 'assistant',
    label: 'AI assistant',
    icon: Sparkles,
    hint: 'Free AI: Groq, Gemini …',
    group: 'App',
    tone: 'bg-indigo-500/12 text-indigo-600',
  },
  {
    id: 'history',
    label: 'History',
    icon: History,
    hint: 'Compare and undo changes',
    group: 'Tools',
    tone: 'bg-teal-500/12 text-teal-600',
  },
  {
    id: 'copy',
    label: 'Copy settings',
    icon: FileDown,
    hint: 'Save to or open a file',
    group: 'Tools',
    tone: 'bg-orange-500/12 text-orange-600',
  },
];
export const GROUPS = [...new Set(PAGES.map((p) => p.group))];

/** Words people may search for, and the page that has them. */
export const SEARCH: { page: PageId; label: string; words: string }[] = [
  { page: 'shop', label: 'Shop name', words: 'shop name title business' },
  {
    page: 'shop',
    label: 'Address, phone and email',
    words: 'address phone telephone email contact',
  },
  {
    page: 'receipt',
    label: 'Receipt design',
    words:
      'receipt bill design layout template logo footer header qr whatsapp barcode thank you studio',
  },
  {
    page: 'receipt',
    label: 'Copies of every receipt',
    words: 'copies copy shop copy credit signature',
  },
  {
    page: 'printer',
    label: 'Receipt printer',
    words: 'printer usb network thermal chrome print test',
  },
  {
    page: 'printer',
    label: 'Paper width (58 / 80 mm)',
    words: 'paper width 58 80 mm characters line',
  },
  { page: 'printer', label: 'Cash drawer and paper cut', words: 'drawer cash open kick cut feed' },
  { page: 'billing', label: 'Rounding', words: 'round rounding nearest cents decimals' },
  { page: 'billing', label: 'Currency', words: 'currency symbol rs lkr money' },
  { page: 'billing', label: 'Selling with no stock', words: 'stock zero negative out of stock' },
  { page: 'billing', label: 'Print after payment', words: 'auto print automatic receipt payment' },
  { page: 'billing', label: 'Screen lock', words: 'lock idle screen minutes pin' },
  {
    page: 'billing',
    label: 'Wholesale / retail start',
    words: 'wholesale retail price mode default',
  },
  { page: 'approvals', label: 'Cashier discount limit', words: 'discount cashier limit percent' },
  {
    page: 'approvals',
    label: 'Admin PIN for actions',
    words: 'admin approval pin void refund price drawer credit',
  },
  { page: 'look', label: 'Dark mode', words: 'dark light theme appearance' },
  { page: 'look', label: 'Logo and colours', words: 'logo colour color brand branding app name' },
  {
    page: 'assistant',
    label: 'Free AI (Groq, Gemini …)',
    words: 'ai assistant groq gemini openrouter mistral key free online ollama model local offline',
  },
  {
    page: 'history',
    label: 'History and compare',
    words: 'history compare undo restore version changes audit who',
  },
  {
    page: 'copy',
    label: 'Save / open settings file',
    words: 'export import file backup copy transfer second shop',
  },
  { page: 'overview', label: 'Setup check', words: 'check health problems overview' },
];

export const ISSUE_PAGE: Record<SettingsIssue['section'], PageId> = {
  shop: 'shop',
  receipt: 'receipt',
  receiptLibrary: 'receipt',
  tax: 'billing',
  pos: 'billing',
  approvals: 'approvals',
  printer: 'printer',
  backup: 'copy',
  branding: 'look',
  ai: 'assistant',
};

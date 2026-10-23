import { z } from 'zod';
import { defaultReceiptLayout, receiptElementSchema } from '../receipt-layout';
import { PRICE_MODES } from '../enums';
import { ALL_APPROVAL_ACTIONS } from '../permissions';
import { bpSchema, imageDataUrlSchema } from './common';

export const shopSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the shop name').max(80),
  address: z.string().trim().max(300),
  phone: z.string().trim().max(60),
  email: z.string().trim().max(120),
});

export const hexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Use a colour like #4f46e5');

/** Look of the app. Only the Super Admin can change it (white-labelling for each shop). */
export const brandingSettingsSchema = z.object({
  /** Shown in the browser tab and wherever there is no logo. */
  appName: z.string().trim().min(1, 'Enter the app name').max(40),
  /** null = the built-in ShopPOS logo. */
  logo: imageDataUrlSchema('Logo', 300_000, true).nullable(),
  primaryColor: hexColorSchema,
  sidebar: z.enum(['dark', 'light']),
  /** Play the logo animation when the POS opens. */
  startupAnimation: z.boolean(),
});

/** The receipt is designed piece by piece in Settings → Receipt (see receipt-layout.ts). */
export const receiptSettingsSchema = z.object({
  layout: z.array(receiptElementSchema).max(80),
  /** Copies of every receipt (1–3). */
  copies: z.int().min(1).max(3),
  /** Print an extra "SHOP COPY" with a signature line for credit (on account) sales. */
  shopCopyForCredit: z.boolean(),
  /** Language code. Only "en" for now; other scripts will be printed as images later. */
  language: z.enum(['en']),
});

export const taxSettingsSchema = z.object({
  vatRegistered: z.boolean(),
  vatNumber: z.string().trim().max(40),
  /** true: shelf prices already include tax. */
  pricesIncludeTax: z.boolean(),
  showTaxOnReceipt: z.boolean(),
});

export const posSettingsSchema = z.object({
  currencySymbol: z.string().trim().min(1).max(5),
  /** Round discounts and bill totals to this many cents. 100 = whole rupees. */
  roundingStep: z.union([z.literal(1), z.literal(100), z.literal(500), z.literal(1000)]),
  /** Show cents in the UI and on receipts. */
  showCents: z.boolean(),
  allowZeroStockSale: z.boolean(),
  defaultPriceMode: z.enum(PRICE_MODES),
  autoPrintReceipt: z.boolean(),
  /** Lock the screen (PIN to come back) after this many minutes without use. 0 = never. */
  autoLockMinutes: z.int().min(0).max(240),
  /** Ask before removing an item from the bill. */
  confirmRemoveItem: z.boolean(),
});

export const approvalSettingsSchema = z.object({
  /** Cashiers can give up to this discount (basis points) without admin approval. */
  cashierMaxDiscountBp: bpSchema,
  /** Actions that need an admin PIN when a cashier does them. */
  requireApprovalFor: z.array(z.enum(ALL_APPROVAL_ACTIONS)),
});

/** A logo turned into black-and-white dots for the thermal printer (made in the browser). */
export const printerLogoSchema = z.object({
  width: z.int().min(8).max(576),
  height: z.int().min(1).max(400),
  /** Base64 of the rows of bits, (width / 8) bytes per row, 1 = black. */
  data: z.string().max(40_000),
});
export type PrinterLogo = z.infer<typeof printerLogoSchema>;

export const PRINTER_MODES = ['browser', 'windows', 'network', 'file'] as const;
export type PrinterMode = (typeof PRINTER_MODES)[number];

export const printerSettingsSchema = z.object({
  /**
   * browser: Chrome prints the receipt (no cash drawer).
   * windows: raw ESC/POS to a Windows printer (USB thermal printer). Recommended in the shop.
   * network: raw ESC/POS to a network printer (port 9100).
   * file: save the bytes to a file (testing without a printer).
   */
  mode: z.enum(PRINTER_MODES),
  windowsPrinterName: z.string().trim().max(200),
  networkHost: z.string().trim().max(200),
  networkPort: z.int().min(1).max(65_535),
  /** 48 for most 80 mm printers (Font A), 42 for some; 32 for 58 mm. */
  charsPerLine: z.union([z.literal(32), z.literal(42), z.literal(48)]),
  autoCut: z.boolean(),
  /** Kick the cash drawer (through the printer) after a cash payment. */
  openDrawerOnCash: z.boolean(),
  /** Blank lines before the cut. */
  feedLines: z.int().min(0).max(10),
  logo: printerLogoSchema.nullable(),
});

/**
 * Is this the address of an AI server on this computer or the shop network? Only such addresses
 * are allowed, so bills, settings and customer details never leave the shop.
 */
export function isLocalAiUrl(url: string): boolean {
  const m = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(url.trim());
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  if (m[2] && Number(m[2]) > 65_535) return false;
  // Names other than localhost could point anywhere, so the shop network needs the IP address.
  if (host === 'localhost' || host === '[::1]') return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  if ([a, b, Number(ip[3]), Number(ip[4])].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** The free model suggested for the shop laptop (runs on the CPU, about 3.4 GB). */
export const AI_DEFAULT_MODEL = 'qwen3.5:4b';
export const AI_DEFAULT_URL = 'http://127.0.0.1:11434';

/**
 * The assistant in Settings and the receipt editor. It always understands common requests by
 * itself; with this on, other requests go to a free AI model running locally through Ollama.
 */
export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  url: z
    .string()
    .trim()
    .refine(
      isLocalAiUrl,
      'Use an address on this computer or the shop network, e.g. ' + AI_DEFAULT_URL,
    ),
  model: z
    .string()
    .trim()
    .min(1, 'Enter the model name')
    .max(100)
    .regex(/^[\w.:/-]+$/, 'Use the model name as Ollama shows it, e.g. ' + AI_DEFAULT_MODEL),
});

/** Receipt designs the shop saved by name in the receipt editor, to switch between later. */
export const receiptLibrarySchema = z.object({
  designs: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().trim().min(1, 'Give the design a name').max(40),
        savedAt: z.string().max(40),
        layout: z.array(receiptElementSchema).max(80),
      }),
    )
    .max(20, 'Up to 20 saved designs'),
});

export const backupSettingsSchema = z.object({
  /** Daily automatic backup time, 24-hour HH:MM. Empty = no daily backup. */
  dailyAt: z.union([
    z.literal(''),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 21:30'),
  ]),
  /** Also back up when the day is closed. */
  onDayClose: z.boolean(),
  /** How many backups to keep in the backup folder (older ones are removed). */
  keep: z.int().min(3).max(365),
  /** Folder on a USB drive (e.g. E:\\ShopPOSBackups). Copied there when the drive is plugged in. */
  usbPath: z.string().trim().max(260),
  /** Upload to Google Drive when online (needs connecting on the Backups page). */
  driveUpload: z.boolean(),
});

export const SETTINGS_SCHEMAS = {
  branding: brandingSettingsSchema,
  shop: shopSettingsSchema,
  receipt: receiptSettingsSchema,
  tax: taxSettingsSchema,
  pos: posSettingsSchema,
  approvals: approvalSettingsSchema,
  printer: printerSettingsSchema,
  backup: backupSettingsSchema,
  ai: aiSettingsSchema,
  receiptLibrary: receiptLibrarySchema,
} as const;

export type SettingsSection = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_SECTIONS = Object.keys(SETTINGS_SCHEMAS) as SettingsSection[];

export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;
export type ShopSettings = z.infer<typeof shopSettingsSchema>;
export type ReceiptSettings = z.infer<typeof receiptSettingsSchema>;
export type TaxSettings = z.infer<typeof taxSettingsSchema>;
export type PosSettings = z.infer<typeof posSettingsSchema>;
export type ApprovalSettings = z.infer<typeof approvalSettingsSchema>;
export type PrinterSettings = z.infer<typeof printerSettingsSchema>;
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type ReceiptLibrary = z.infer<typeof receiptLibrarySchema>;

export interface AllSettings {
  branding: BrandingSettings;
  shop: ShopSettings;
  receipt: ReceiptSettings;
  tax: TaxSettings;
  pos: PosSettings;
  approvals: ApprovalSettings;
  printer: PrinterSettings;
  backup: BackupSettings;
  ai: AiSettings;
  receiptLibrary: ReceiptLibrary;
}

export const DEFAULT_SETTINGS: AllSettings = {
  branding: {
    appName: 'My Shop',
    logo: null,
    primaryColor: '#4f46e5',
    sidebar: 'dark',
    startupAnimation: true,
  },
  shop: { name: 'My Shop', address: '', phone: '', email: '' },
  receipt: {
    layout: defaultReceiptLayout(),
    copies: 1,
    shopCopyForCredit: true,
    language: 'en',
  },
  tax: { vatRegistered: false, vatNumber: '', pricesIncludeTax: true, showTaxOnReceipt: false },
  pos: {
    currencySymbol: 'Rs',
    roundingStep: 100,
    showCents: false,
    allowZeroStockSale: true,
    defaultPriceMode: 'RETAIL',
    autoPrintReceipt: true,
    autoLockMinutes: 0,
    confirmRemoveItem: true,
  },
  approvals: {
    cashierMaxDiscountBp: 1000,
    requireApprovalFor: [...ALL_APPROVAL_ACTIONS],
  },
  printer: {
    mode: 'browser',
    windowsPrinterName: '',
    networkHost: '',
    networkPort: 9100,
    charsPerLine: 48,
    autoCut: true,
    openDrawerOnCash: true,
    feedLines: 3,
    logo: null,
  },
  backup: { dailyAt: '21:30', onDayClose: true, keep: 30, usbPath: '', driveUpload: false },
  ai: { enabled: false, url: AI_DEFAULT_URL, model: AI_DEFAULT_MODEL },
  receiptLibrary: { designs: [] },
};

/** Settings anyone can read without logging in (login screen, receipt header). */
export interface PublicSettings {
  branding: BrandingSettings;
  shop: Pick<ShopSettings, 'name'>;
  printer: Pick<PrinterSettings, 'mode' | 'openDrawerOnCash'>;
  approvals: Pick<ApprovalSettings, 'cashierMaxDiscountBp' | 'requireApprovalFor'>;
  pos: PosSettings;
  tax: Pick<TaxSettings, 'pricesIncludeTax' | 'vatRegistered'>;
}

/** Ready-made colour themes for the Branding page. */
export const BRAND_PRESETS: { name: string; color: string }[] = [
  { name: 'Signal Red', color: '#ed1c24' },
  { name: 'Crimson', color: '#be123c' },
  { name: 'Sunset Orange', color: '#ea580c' },
  { name: 'Amber Gold', color: '#d97706' },
  { name: 'Emerald', color: '#059669' },
  { name: 'Ocean Teal', color: '#0e7490' },
  { name: 'Royal Blue', color: '#2563eb' },
  { name: 'Indigo', color: '#4f46e5' },
  { name: 'Violet', color: '#7c3aed' },
  { name: 'Graphite', color: '#3f3f46' },
];

/** Settings sections that need a permission other than settings.manage. */
export const SECTION_PERMISSION: Partial<
  Record<SettingsSection, 'branding.manage' | 'backups.manage'>
> = {
  branding: 'branding.manage',
  backup: 'backups.manage',
};

import {
  Barcode,
  Calculator,
  Columns2,
  Hash,
  Image,
  ListOrdered,
  Minus,
  MoveVertical,
  PenLine,
  PiggyBank,
  QrCode,
  Type,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReceiptElementType } from '@shoppos/shared';

export const PIECE_ICONS: Record<ReceiptElementType, LucideIcon> = {
  text: Type,
  pair: Columns2,
  logo: Image,
  divider: Minus,
  space: MoveVertical,
  items: ListOrdered,
  totals: Calculator,
  payments: Wallet,
  itemCount: Hash,
  savings: PiggyBank,
  barcode: Barcode,
  qr: QrCode,
  signature: PenLine,
};

/** The order of the "Add" tools. */
export const ADD_ORDER: ReceiptElementType[] = [
  'text',
  'pair',
  'logo',
  'divider',
  'space',
  'items',
  'totals',
  'payments',
  'itemCount',
  'savings',
  'barcode',
  'qr',
  'signature',
];

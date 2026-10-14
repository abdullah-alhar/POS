/**
 * A receipt described as simple blocks. The server turns it into ESC/POS bytes for the thermal
 * printer; the browser turns the same blocks into HTML when it has to print instead.
 * Other languages (Sinhala/Tamil) can later be added as image blocks without changing printers.
 */
export type ReceiptAlign = 'left' | 'center' | 'right';

export type ReceiptBlock =
  | { type: 'logo' }
  | { type: 'text'; text: string; align?: ReceiptAlign; bold?: boolean; large?: boolean }
  | { type: 'row'; left: string; right: string; bold?: boolean; large?: boolean }
  | { type: 'divider'; char?: '-' | '=' }
  | { type: 'barcode'; value: string }
  | { type: 'qr'; value: string }
  | { type: 'feed'; lines: number }
  /** Cut the paper here (between copies). */
  | { type: 'cut' };

export interface ReceiptDoc {
  blocks: ReceiptBlock[];
}

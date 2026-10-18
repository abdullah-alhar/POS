import type { PrinterLogo, ReceiptAlign, ReceiptDoc } from '@shoppos/shared';

/**
 * Turns receipt blocks into ESC/POS bytes for 58/80 mm thermal printers.
 * Only widely supported commands are used, so generic printers work.
 */

const ESC = 0x1b;
const GS = 0x1d;

export interface EscPosOptions {
  charsPerLine: number;
  logo: PrinterLogo | null;
  autoCut: boolean;
  feedLines: number;
  openDrawer: boolean;
}

/** A receipt laid out into printable lines (shared by the byte encoder and the text preview). */
type Op =
  | { kind: 'line'; text: string; align: ReceiptAlign; bold: boolean; large: boolean }
  | { kind: 'logo' }
  | { kind: 'barcode'; value: string }
  | { kind: 'qr'; value: string }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' };

const REPLACEMENTS: Record<string, string> = {
  '–': '-',
  '—': '-',
  '−': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '•': '*',
  '×': 'x',
  '…': '...',
  ' ': ' ',
};

/** Printers use an old 8-bit character set: keep plain ASCII, swap common symbols, '?' for the rest. */
export function toPrintable(text: string): string {
  return [...text.normalize('NFKD')]
    .map((ch) => REPLACEMENTS[ch] ?? ch)
    .join('')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Split text into lines no longer than `width`, breaking on spaces where possible. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export function layout(doc: ReceiptDoc, charsPerLine: number): Op[] {
  const ops: Op[] = [];
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'logo':
        ops.push({ kind: 'logo' });
        break;
      case 'feed':
        ops.push({ kind: 'feed', lines: block.lines });
        break;
      case 'barcode':
        ops.push({ kind: 'barcode', value: toPrintable(block.value) });
        break;
      case 'qr':
        // QR codes carry UTF-8, so links and text with symbols stay intact.
        if (block.value) ops.push({ kind: 'qr', value: block.value });
        break;
      case 'cut':
        ops.push({ kind: 'cut' });
        break;
      case 'divider':
        ops.push({
          kind: 'line',
          text: (block.char ?? '-').repeat(charsPerLine),
          align: 'left',
          bold: false,
          large: false,
        });
        break;
      case 'text': {
        const large = !!block.large;
        const width = large ? Math.floor(charsPerLine / 2) : charsPerLine;
        for (const text of wrap(toPrintable(block.text), width)) {
          ops.push({ kind: 'line', text, align: block.align ?? 'left', bold: !!block.bold, large });
        }
        break;
      }
      case 'row': {
        const large = !!block.large;
        const width = large ? Math.floor(charsPerLine / 2) : charsPerLine;
        const left = toPrintable(block.left);
        const right = toPrintable(block.right);
        if (left.length + right.length + 1 <= width) {
          ops.push({
            kind: 'line',
            text: left + ' '.repeat(width - left.length - right.length) + right,
            align: 'left',
            bold: !!block.bold,
            large,
          });
        } else {
          for (const text of wrap(left, width))
            ops.push({ kind: 'line', text, align: 'left', bold: !!block.bold, large });
          if (right) {
            ops.push({
              kind: 'line',
              text: right.padStart(width),
              align: 'left',
              bold: !!block.bold,
              large,
            });
          }
        }
        break;
      }
    }
  }
  return ops;
}

/** What the receipt would look like, as plain text (for "file" printing and tests). */
export function renderText(doc: ReceiptDoc, charsPerLine: number): string {
  return layout(doc, charsPerLine)
    .map((op) => {
      switch (op.kind) {
        case 'logo':
          return '[logo]';
        case 'barcode':
          return `[barcode ${op.value}]`;
        case 'qr':
          return `[qr ${op.value}]`;
        case 'cut':
          return '- - - - - - - - cut - - - - - - - -';
        case 'feed':
          return '\n'.repeat(Math.max(0, op.lines - 1));
        case 'line': {
          const width = op.large ? Math.floor(charsPerLine / 2) : charsPerLine;
          const text =
            op.align === 'center'
              ? op.text.padStart(Math.floor((width + op.text.length) / 2))
              : op.align === 'right'
                ? op.text.padStart(width)
                : op.text;
          return op.large ? text.toUpperCase() : text;
        }
      }
    })
    .join('\n');
}

class Bytes {
  private parts: number[] = [];
  push(...bytes: number[]) {
    this.parts.push(...bytes);
    return this;
  }
  text(s: string) {
    for (let i = 0; i < s.length; i++) this.parts.push(s.charCodeAt(i) & 0xff);
    return this;
  }
  buffer() {
    return Buffer.from(this.parts);
  }
}

const ALIGN: Record<ReceiptAlign, number> = { left: 0, center: 1, right: 2 };

/** ESC p: pulse the cash drawer connected to the printer (both common pins). */
export function drawerKick(): Buffer {
  return Buffer.from([ESC, 0x70, 0, 25, 250, ESC, 0x70, 1, 25, 250]);
}

function rasterLogo(out: Bytes, logo: PrinterLogo) {
  const data = Buffer.from(logo.data, 'base64');
  const bytesPerRow = Math.ceil(logo.width / 8);
  out.push(ESC, 0x61, 1);
  // Send in bands of 128 rows; some printers have small buffers.
  for (let y = 0; y < logo.height; y += 128) {
    const rows = Math.min(128, logo.height - y);
    out.push(GS, 0x76, 0x30, 0, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    out.push(...data.subarray(y * bytesPerRow, (y + rows) * bytesPerRow));
  }
  out.push(0x0a);
}

export function encodeReceipt(doc: ReceiptDoc, opts: EscPosOptions): Buffer {
  const out = new Bytes();
  out.push(ESC, 0x40); // initialise
  out.push(ESC, 0x74, 0); // code page PC437
  if (opts.openDrawer) out.push(...drawerKick());

  for (const op of layout(doc, opts.charsPerLine)) {
    switch (op.kind) {
      case 'logo':
        if (opts.logo) rasterLogo(out, opts.logo);
        break;
      case 'feed':
        out.push(ESC, 0x64, Math.min(op.lines, 10));
        break;
      case 'barcode': {
        const data = `{B${op.value}`;
        out.push(ESC, 0x61, 1);
        out.push(GS, 0x68, 60); // height
        out.push(GS, 0x77, 2); // module width
        out.push(GS, 0x48, 2); // human-readable text below
        out.push(GS, 0x66, 0); // HRI font A
        out.push(GS, 0x6b, 73, data.length).text(data);
        out.push(0x0a);
        break;
      }
      case 'qr': {
        // GS ( k: QR model 2, module size 6, error correction M, store, print.
        const data = Buffer.from(op.value, 'utf8').subarray(0, 700);
        const len = data.length + 3;
        out.push(ESC, 0x61, 1);
        out.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);
        out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6);
        out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);
        out.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data);
        out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
        out.push(0x0a);
        break;
      }
      case 'cut':
        out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
        out.push(ESC, 0x64, Math.min(opts.feedLines, 10));
        if (opts.autoCut) out.push(GS, 0x56, 66, 0);
        else out.push(ESC, 0x64, 2);
        break;
      case 'line':
        out.push(ESC, 0x61, ALIGN[op.align]);
        out.push(ESC, 0x45, op.bold ? 1 : 0);
        out.push(GS, 0x21, op.large ? 0x11 : 0x00);
        out.text(op.text).push(0x0a);
        break;
    }
  }

  out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
  out.push(ESC, 0x64, Math.min(opts.feedLines, 10));
  if (opts.autoCut) out.push(GS, 0x56, 66, 0); // feed and partial cut
  return out.buffer();
}

import qrcode from 'qrcode-generator';
import { code128Svg, type ReceiptBlock, type ReceiptDoc } from '@shoppos/shared';
import { LOGO_MARK, LOGO_VIEWBOX, LOGO_WORDMARK } from '@/components/brand/logo-paths';

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** The built-in logo as SVG markup in one colour (black for receipts). */
export function builtInLogoSvg(color = '#000', width?: number, height?: number) {
  const size = width && height ? ` width="${width}" height="${height}"` : '';
  const paths = [...LOGO_MARK, ...LOGO_WORDMARK].map((d) => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}"${size} fill="${color}" fill-rule="evenodd">${paths}</svg>`;
}

/** A QR code as SVG markup (UTF-8, error correction M). */
export function qrSvg(value: string, cell = 3) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']!;
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

/** One receipt block as HTML (shared by printing and the receipt editor). */
export function blockHtml(b: ReceiptBlock, logo: string | null): string {
  switch (b.type) {
    case 'logo':
      return `<div class="logo">${logo ? `<img src="${logo}" alt="">` : builtInLogoSvg()}</div>`;
    case 'divider':
      return `<div class="hr${b.char === '=' ? ' double' : ''}"></div>`;
    case 'feed':
      return `<div style="height:${b.lines * 1.2}em"></div>`;
    case 'barcode':
      return `<div class="bc">${code128Svg(b.value, 44, 1.4)}<div>${escape(b.value)}</div></div>`;
    case 'qr':
      return `<div class="qr">${qrSvg(b.value)}</div>`;
    case 'cut':
      return '<div class="cut"></div>';
    case 'text':
      return `<div class="${[b.align === 'center' ? 'c' : b.align === 'right' ? 'r' : '', b.bold ? 'b' : '', b.large ? 'l' : ''].join(' ')}">${escape(b.text) || '&nbsp;'}</div>`;
    case 'row':
      return `<div class="row ${b.bold ? 'b' : ''} ${b.large ? 'l' : ''}"><span>${escape(b.left)}</span><span>${escape(b.right)}</span></div>`;
  }
}

/** Receipt styles; `scope` limits them to one element when shown inside the app. */
export function receiptCss(scope = '') {
  const s = scope ? `${scope} ` : '';
  return `
${s}.c { text-align: center; } ${s}.r { text-align: right; } ${s}.b { font-weight: 700; } ${s}.l { font-size: 16px; font-weight: 700; }
${s}.row { display: flex; justify-content: space-between; gap: 8px; } ${s}.row span:last-child { white-space: nowrap; }
${s}.hr { border-top: 1px dashed #000; margin: 4px 0; } ${s}.hr.double { border-top-style: double; border-top-width: 3px; }
${s}.logo { text-align: center; margin-bottom: 4px; } ${s}.logo img, ${s}.logo svg { max-width: 60%; max-height: 22mm; }
${s}.bc { text-align: center; margin: 6px 0 2px; font-size: 11px; } ${s}.bc svg { width: 90%; height: 44px; }
${s}.qr { text-align: center; margin: 6px 0 2px; } ${s}.qr svg { width: 28mm; height: 28mm; }
${s}.cut { border-top: 1px dashed #999; margin: 8mm 0 4mm; break-after: page; }`;
}

/** A full HTML page for an 80 mm receipt, printed by Chrome when the thermal printer is not used. */
export function receiptHtml(doc: ReceiptDoc, logo: string | null): string {
  const body = doc.blocks.map((b) => blockHtml(b, logo)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm 4mm 6mm; width: 80mm; color: #000; background: #fff;
  font: 12px/1.35 'Consolas', 'Courier New', monospace; }
${receiptCss()}
@media print { .cut { border: 0; margin: 0; } }
</style></head><body>${body}</body></html>`;
}

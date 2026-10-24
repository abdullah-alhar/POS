import { toast } from 'sonner';
import type { PrinterMode, PrintResult, ReceiptDoc } from '@shoppos/shared';
import { api, ApiError } from '@/lib/api';
import { receiptHtml } from './receipt-html';

/** Only one print at a time: a second print while Chrome's print window is open can hang it. */
let printing: Promise<void> = Promise.resolve();

/**
 * Print an HTML page through a frame outside the screen. With Chrome's --kiosk-printing (the
 * Windows shop setup) it prints silently; otherwise Chrome shows its print window.
 *
 * The frame has a real receipt size: a frame of 0 × 0 or a hidden one can leave Chrome's print
 * preview stuck (a grey screen with a thin white line), which looks like the till froze.
 */
export function printHtml(html: string): Promise<void> {
  const job = printing.then(() => printOnce(html));
  printing = job.catch(() => undefined);
  return job;
}

function printOnce(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:80mm;height:200mm;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    frame.onload = () => {
      const win = frame.contentWindow!;
      const images = [...win.document.images];
      Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => null)))).then(
        () => {
          win.addEventListener('afterprint', done, { once: true });
          // Let the page lay out first; printing in the same moment can give an empty preview.
          setTimeout(() => {
            try {
              win.focus();
              win.print();
            } catch {
              done();
            }
          }, 50);
          setTimeout(done, 60_000);
        },
      );
    };
    frame.srcdoc = html;
  });
}

export type PrintKind = 'sales' | 'returns' | 'cash-sessions';

export async function printReceiptInBrowser(
  saleId: string,
  copy: boolean,
  logo: string | null,
  kind: PrintKind = 'sales',
) {
  const doc = await api.get<ReceiptDoc>(`/${kind}/${saleId}/receipt${copy ? '?copy=1' : ''}`);
  await printHtml(receiptHtml(doc, logo));
}

/**
 * Print a bill's receipt: on the thermal printer through the server (which can also open the
 * cash drawer), or with the browser. If the thermal printer fails, the browser prints instead.
 */
export async function printReceipt(
  saleId: string,
  opts: {
    mode: PrinterMode;
    copy?: boolean;
    openDrawer?: boolean;
    logo: string | null;
    /** sales (default), returns (refund slip) or cash-sessions (end-of-day report). */
    kind?: PrintKind;
  },
): Promise<'printer' | 'browser'> {
  const copy = opts.copy ?? false;
  const kind = opts.kind ?? 'sales';
  if (opts.mode !== 'browser') {
    try {
      await api.post<PrintResult>(`/${kind}/${saleId}/print`, {
        copy,
        openDrawer: opts.openDrawer ?? false,
      });
      return 'printer';
    } catch (err) {
      const why = err instanceof ApiError ? err.message : 'The receipt printer did not answer.';
      toast.warning(`${why} Printing with the browser instead.`, { duration: 8000 });
    }
  }
  await printReceiptInBrowser(saleId, copy, opts.logo, kind);
  return 'browser';
}

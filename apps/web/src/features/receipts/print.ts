import { toast } from 'sonner';
import type { PrinterMode, PrintResult, ReceiptDoc } from '@shoppos/shared';
import { api, ApiError } from '@/lib/api';
import { receiptHtml } from './receipt-html';

/** Print an HTML page through a hidden frame. With Chrome's --kiosk-printing it prints silently. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const done = () => {
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    frame.onload = () => {
      const win = frame.contentWindow!;
      const images = [...win.document.images];
      Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => null)))).then(
        () => {
          win.addEventListener('afterprint', done, { once: true });
          win.focus();
          win.print();
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

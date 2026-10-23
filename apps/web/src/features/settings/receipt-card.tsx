import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, ScrollText } from 'lucide-react';
import { Link } from 'react-router';
import { checkReceipt, type AllSettings } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBranding } from '@/lib/branding';
import { blockHtml, receiptCss } from '../receipts/receipt-html';
import { useReceiptPreview } from '../receipt-studio/use-preview';

/** The saved receipt as a small picture, its check result, and the way into the Receipt Studio. */
export function ReceiptCard({ settings }: { settings: AllSettings }) {
  const branding = useBranding();
  const design = useMemo(
    () => ({
      layout: settings.receipt.layout,
      copies: settings.receipt.copies,
      shopCopyForCredit: settings.receipt.shopCopyForCredit,
    }),
    [settings.receipt],
  );
  const view = useMemo(
    () => ({
      scenario: 'latest' as const,
      billNumber: '',
      charsPerLine: settings.printer.charsPerLine,
    }),
    [settings.printer.charsPerLine],
  );
  const { data } = useReceiptPreview(design, view);
  const issues = checkReceipt(settings.receipt.layout, {
    charsPerLine: settings.printer.charsPerLine,
    vatRegistered: settings.tax.vatRegistered,
    printerMode: settings.printer.mode,
    hasPrinterLogo: !!settings.printer.logo,
    estimateMm: data?.estimate.mm,
  });
  const serious = issues.filter((i) => i.level !== 'tip');
  const html = data?.pieces
    .filter((p) => !p.skipped)
    .flatMap((p) => p.blocks)
    .map((b) => blockHtml(b, branding.logo))
    .join('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="text-brand size-5" /> Receipt
        </CardTitle>
        <CardDescription>
          Design the printed bill like in a photo editor: layers, drag and drop, styles, print
          conditions, a design check, history and an assistant.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid items-start gap-5 sm:grid-cols-[200px_1fr]">
        <div className="bg-muted/60 flex justify-center overflow-hidden rounded-lg border p-3">
          <style>{receiptCss('.rp-thumb')}</style>
          <div
            className="rp-thumb max-h-80 overflow-hidden bg-white px-[15px] py-3 font-mono text-[12px] leading-[1.35] text-black shadow"
            style={{ width: 302, zoom: 0.55 }}
            dangerouslySetInnerHTML={{ __html: html ?? '' }}
          />
        </div>
        <div className="grid gap-3 text-sm">
          <p>
            <span className="font-medium">{settings.receipt.layout.length} pieces</span> ·{' '}
            {settings.receipt.copies} cop{settings.receipt.copies > 1 ? 'ies' : 'y'} per bill
            {data && ` · about ${Math.round(data.estimate.mm / 10)} cm of paper`}
            {settings.receiptLibrary.designs.length > 0 &&
              ` · ${settings.receiptLibrary.designs.length} saved design${settings.receiptLibrary.designs.length > 1 ? 's' : ''}`}
          </p>
          {serious.length ? (
            <ul className="grid gap-1">
              {serious.map((i) => (
                <li key={i.id} className="flex gap-1.5">
                  <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" /> {i.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-success flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> The design check found no problems.
            </p>
          )}
          <Button asChild className="justify-self-start">
            <Link to="/settings/receipt">
              Open the Receipt Studio <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

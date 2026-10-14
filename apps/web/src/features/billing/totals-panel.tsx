import {
  CheckCircle2,
  FilePlus2,
  Inbox,
  PauseCircle,
  Percent,
  Printer,
  Sunrise,
} from 'lucide-react';
import {
  bpToPercentText,
  type CartTotals,
  type CashSessionDto,
  type CheckoutResult,
} from '@marina/shared';
import { Button } from '@/components/ui/button';
import { useMoney } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useCart } from '@/stores/cart';

function Row({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between text-sm', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-muted-foreground ml-auto rounded px-1.5 text-[10px] font-medium">
      {children}
    </kbd>
  );
}

export function TotalsPanel({
  totals,
  session,
  heldCount,
  lastResult,
  vatRegistered,
  onPay,
  onDiscount,
  onHold,
  onRecall,
  onNew,
  onReprint,
  onOpenDay,
}: {
  totals: CartTotals;
  session: CashSessionDto | null | undefined;
  heldCount: number;
  lastResult: CheckoutResult | null;
  vatRegistered: boolean;
  onPay: () => void;
  onDiscount: () => void;
  onHold: () => void;
  onRecall: () => void;
  onNew: () => void;
  onReprint: () => void;
  onOpenDay: () => void;
}) {
  const money = useMoney();
  const billDiscount = useCart((s) => s.billDiscount);
  const hasLines = useCart((s) => s.lines.length > 0);
  const lastSaleId = useCart((s) => s.lastSaleId);

  return (
    <aside className="bg-card flex w-[340px] shrink-0 flex-col border-l xl:w-[380px]">
      {lastResult && !hasLines ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <CheckCircle2 className="text-success size-14" />
          <p className="text-muted-foreground text-sm">{lastResult.sale.number} saved</p>
          {lastResult.sale.changeGiven > 0 ? (
            <>
              <p className="mt-3 text-sm font-medium tracking-wide uppercase">Change</p>
              <p className="text-5xl font-bold tabular-nums">
                {money(lastResult.sale.changeGiven)}
              </p>
            </>
          ) : (
            <p className="mt-3 text-3xl font-bold tabular-nums">{money(lastResult.sale.total)}</p>
          )}
          <p className="text-muted-foreground mt-4 text-sm">
            Scan the next item to start a new bill
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-5">
          <p className="text-sm font-semibold">
            Current bill
            <span className="text-muted-foreground font-normal"> · {totals.itemCount} item(s)</span>
          </p>
          <div className="space-y-1.5 pt-1">
            <Row label="Subtotal" value={money(totals.subtotal)} />
            {totals.itemDiscountTotal > 0 && (
              <Row label="Item discounts" value={`−${money(totals.itemDiscountTotal)}`} />
            )}
            {totals.billDiscountAmount > 0 && (
              <Row
                label={
                  billDiscount?.type === 'PERCENT'
                    ? `Bill discount (${bpToPercentText(billDiscount.value)}%)`
                    : 'Bill discount'
                }
                value={`−${money(totals.billDiscountAmount)}`}
              />
            )}
            {vatRegistered && totals.taxTotal > 0 && (
              <Row label="VAT included" value={money(totals.taxTotal)} />
            )}
            {totals.roundingAdjustment !== 0 && (
              <Row
                label="Rounding"
                value={`${totals.roundingAdjustment > 0 ? '+' : '−'}${money(Math.abs(totals.roundingAdjustment), { showCents: true })}`}
              />
            )}
          </div>
          <div className="mt-auto border-t pt-4">
            <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
              Total
            </p>
            <p className="text-5xl leading-tight font-bold tabular-nums">{money(totals.total)}</p>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t p-4">
        {session === null ? (
          <Button size="lg" className="h-16 w-full text-lg" onClick={onOpenDay}>
            <Sunrise /> Open the day
          </Button>
        ) : (
          <Button size="lg" className="h-16 w-full text-xl" disabled={!hasLines} onClick={onPay}>
            Pay {hasLines && money(totals.total)}
            <kbd className="ml-2 rounded bg-white/20 px-1.5 text-xs">F4</kbd>
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!hasLines} onClick={onDiscount}>
            <Percent /> Discount <Key>F8</Key>
          </Button>
          <Button variant="outline" disabled={!hasLines} onClick={onHold}>
            <PauseCircle /> Hold <Key>F6</Key>
          </Button>
          <Button variant="outline" onClick={onRecall}>
            <Inbox /> Held
            {heldCount > 0 && (
              <span className="bg-brand text-brand-foreground rounded-full px-1.5 text-[10px]">
                {heldCount}
              </span>
            )}
            <Key>F7</Key>
          </Button>
          <Button variant="outline" onClick={onNew}>
            <FilePlus2 /> New <Key>F1</Key>
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={!lastSaleId}
          onClick={onReprint}
        >
          <Printer /> Print last receipt again <Key>F10</Key>
        </Button>
      </div>
    </aside>
  );
}

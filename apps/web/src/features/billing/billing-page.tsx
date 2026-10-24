import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CashSessionDto,
  CheckoutInput,
  CheckoutResult,
  PaymentEntry,
  PosIndex,
  PosIndexItem,
  PriceMode,
  ReceiptDoc,
} from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AskAiButton } from '@/features/assistant/ask-ai-button';
import { useCan } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { keys, usePublicSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { listPriceOf, setStockGuard, unitPriceOf, useCart } from '@/stores/cart';
import { printHtml, printReceipt } from '../receipts/print';
import { receiptHtml } from '../receipts/receipt-html';
import { BillDiscountDialog } from './bill-discount-dialog';
import { CartList } from './cart-list';
import { QtyDialog } from './qty-dialog';
import { CustomerChip, CustomerDialog } from './customer-dialog';
import { beep } from './feedback';
import { HoldDialog, RecallDialog, useHeldBills } from './held-bills-dialog';
import { LineDialog } from './line-dialog';
import { cashSessionKey, OpenDayDialog } from './open-day-dialog';
import { PAYMENT_PANEL, PaymentPanel } from './payment-panel';
import { ScanBox, type ScanBoxHandle } from './scan-box';
import { TotalsPanel } from './totals-panel';
import { useCartTotals } from './use-cart-totals';
import { usePosIndex } from './use-pos-index';

type DialogName =
  'pay' | 'discount' | 'hold' | 'recall' | 'openDay' | 'newBill' | 'customer' | null;

/** Clicking these does not send the focus back to the scan box (e.g. the price on a line). */
const KEEPS_FOCUS = 'input, textarea, select, [data-keep-focus]';

/** A dialog that is open (closing dialogs keep their element for a short animation). */
const OPEN_DIALOG = `[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], ${PAYMENT_PANEL}`;

export function BillingPage() {
  const qc = useQueryClient();
  const { catalog, refetch: refetchCatalog } = usePosIndex();
  const { data: settings } = usePublicSettings();
  const branding = useBranding();
  const { totals } = useCartTotals();
  const priceMode = useCart((s) => s.priceMode);
  const lineCount = useCart((s) => s.lines.length);
  const customer = useCart((s) => s.customer);
  const can = useCan();
  const { data: sessionData } = useQuery({
    queryKey: cashSessionKey,
    queryFn: () => api.get<{ session: CashSessionDto | null }>('/cash-sessions/current'),
  });
  const session = sessionData?.session;
  const { data: held = [] } = useHeldBills();

  const [dialog, setDialog] = useState<DialogName>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [qtyKey, setQtyKey] = useState<string | null>(null);
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const removeLine = useCart((s) => s.lines.find((l) => l.key === removeKey));
  const confirmRemove = settings?.pos.confirmRemoveItem ?? true;
  const [lastResult, setLastResult] = useState<CheckoutResult | null>(null);
  const scanRef = useRef<ScanBoxHandle>(null);
  const defaultMode: PriceMode = settings?.pos.defaultPriceMode ?? 'RETAIL';

  // Put the cursor back in the scan box, unless a dialog is open (it must keep the keyboard).
  const focusScan = useCallback(
    () =>
      setTimeout(() => {
        if (!document.querySelector(OPEN_DIALOG)) scanRef.current?.focus();
      }, 0),
    [],
  );
  // The scan box is disabled until the items are loaded, so its autoFocus does nothing on the
  // first visit: give it the focus as soon as it can take it, so the first scan is not lost.
  const catalogReady = !!catalog;
  useEffect(() => {
    if (catalogReady) focusScan();
  }, [catalogReady, focusScan]);
  const close = useCallback(() => {
    setDialog(null);
    focusScan();
  }, [focusScan]);

  // ── Stock ──

  // More than the stock: blocked when the shop does not sell with no stock (for everyone, also
  // admins), otherwise a warning. Covers +, typed quantities and the line editor.
  const allowNoStock = settings?.pos.allowZeroStockSale ?? false;
  useEffect(() => {
    setStockGuard((line, qty, lines) => {
      if (!line.trackStock || qty <= line.qty) return qty;
      const item = catalog?.items.find((i) => i.variantId === line.variantId);
      if (!item) return qty;
      const elsewhere = lines
        .filter((l) => l.variantId === line.variantId && l.key !== line.key)
        .reduce((n, l) => n + l.qty, 0);
      const free = Math.max(0, item.stockQty - elsewhere);
      if (qty <= free) return qty;
      if (!allowNoStock) {
        beep.error();
        toast.error(
          free > 0 ? `Only ${free} of ${item.name} in stock` : `No stock left for ${item.name}`,
          { id: `stock-${item.variantId}` },
        );
        return Math.max(line.qty, free);
      }
      toast.warning(`${item.name}: only ${free} in stock`, { id: `stock-${item.variantId}` });
      return qty;
    });
    return () => setStockGuard(null);
  }, [catalog, allowNoStock]);

  // ── Adding items ──

  const addItem = useCallback(
    (item: PosIndexItem, qty: number) => {
      const cart = useCart.getState();
      const inCart = cart.lines.find((l) => l.variantId === item.variantId)?.qty ?? 0;
      if (item.trackStock && item.stockQty - inCart - qty < 0) {
        if (!allowNoStock) {
          const free = Math.max(0, item.stockQty - inCart);
          beep.error();
          toast.error(
            free > 0 ? `Only ${free} of ${item.name} in stock` : `No stock left for ${item.name}`,
            { id: `stock-${item.variantId}` },
          );
          return;
        }
        toast.warning(`${item.name}: only ${Math.max(0, item.stockQty - inCart)} in stock`, {
          id: `stock-${item.variantId}`,
        });
      }
      cart.add(item, qty);
      setLastResult(null);
      beep.ok();
    },
    [allowNoStock],
  );

  const notFound = useCallback((code: string) => {
    beep.error();
    toast.error(`Nothing found for "${code}"`, { id: 'not-found' });
  }, []);

  // ── Actions ──

  const actions = {
    pay() {
      if (!useCart.getState().lines.length) return;
      setDialog(session === null ? 'openDay' : 'pay');
    },
    discount() {
      if (useCart.getState().lines.length) setDialog('discount');
    },
    hold() {
      if (!useCart.getState().lines.length) toast.info('There is nothing to hold');
      else setDialog('hold');
    },
    recall() {
      if (useCart.getState().lines.length) toast.error('Finish or hold the current bill first');
      else setDialog('recall');
    },
    newBill() {
      if (useCart.getState().lines.length) setDialog('newBill');
      else {
        useCart.getState().reset(defaultMode);
        setLastResult(null);
        focusScan();
      }
    },
    togglePriceMode() {
      const next = useCart.getState().priceMode === 'RETAIL' ? 'WHOLESALE' : 'RETAIL';
      useCart.getState().setPriceMode(next);
      toast.info(next === 'WHOLESALE' ? 'Wholesale prices' : 'Retail prices', { id: 'price-mode' });
    },
    reprint() {
      const id = useCart.getState().lastSaleId;
      if (!id) return;
      printReceipt(id, {
        mode: settings?.printer.mode ?? 'browser',
        copy: true,
        logo: branding.logo,
      }).catch((err) => toast.error(err instanceof ApiError ? err.message : 'Could not print'));
    },
    editSelected() {
      const key = useCart.getState().selectedKey;
      if (key) setEditKey(key);
    },
    /** Ctrl+Q: print the bill as a quotation (price offer). Nothing is sold. */
    quote() {
      const cart = useCart.getState();
      if (!cart.lines.length) {
        toast.info('Add items first, then print the quotation');
        return;
      }
      const mode = settings?.printer.mode ?? 'browser';
      const body = {
        priceMode: cart.priceMode,
        customerId: cart.customer?.id ?? null,
        lines: cart.lines.map((l) => ({
          variantId: l.variantId,
          qty: l.qty,
          listPrice: listPriceOf(l, cart.priceMode),
          unitPrice: unitPriceOf(l, cart.priceMode),
          discount: l.discount,
        })),
        billDiscount: cart.billDiscount,
        print: mode !== 'browser',
      };
      api
        .post<{ doc: ReceiptDoc; printed: boolean }>('/sales/quote', body)
        .then(async (r) => {
          if (!r.printed) await printHtml(receiptHtml(r.doc, branding.logo));
          toast.success('Quotation printed. The bill is still on the screen.');
        })
        .catch((err) =>
          toast.error(err instanceof ApiError ? err.message : 'Could not print the quotation'),
        );
    },
  };
  // The keyboard handler is set up once; it always calls the latest actions.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  // ── Checkout ──

  async function checkout(payments: PaymentEntry[]): Promise<boolean> {
    const cart = useCart.getState();
    const body: CheckoutInput = {
      clientId: cart.clientId,
      priceMode: cart.priceMode,
      customerId: cart.customer?.id ?? null,
      lines: cart.lines.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        listPrice: listPriceOf(l, cart.priceMode),
        unitPrice: unitPriceOf(l, cart.priceMode),
        discount: l.discount,
      })),
      billDiscount: cart.billDiscount,
      // The payment dialog only offers cash, card and bank transfer (credit comes with customers).
      payments: payments.map((p) => ({
        method: p.method as CheckoutInput['payments'][number]['method'],
        amount: p.amount,
        reference: p.reference,
      })),
      expectedTotal: totals.total,
      note: cart.note || undefined,
    };
    try {
      const result = await api.post<CheckoutResult>('/sales', body);
      cart.finish(result.sale.id, defaultMode);
      setLastResult(result);
      setDialog(null);
      beep.done();
      if (result.duplicate) toast.info(`${result.sale.number} was already saved.`);
      for (const w of result.warnings) toast.warning(w, { duration: 8000 });
      void qc.invalidateQueries({ queryKey: keys.posIndex });

      if (settings?.pos.autoPrintReceipt ?? true) {
        const hasCash = payments.some((p) => p.method === 'CASH');
        printReceipt(result.sale.id, {
          mode: settings?.printer.mode ?? 'browser',
          openDrawer: hasCash && (settings?.printer.openDrawerOnCash ?? true),
          logo: branding.logo,
        }).catch((err) =>
          toast.error(err instanceof ApiError ? err.message : 'Could not print the receipt'),
        );
      }
      focusScan();
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        toast.error('Something went wrong. The bill is still here; press Pay again.');
        return false;
      }
      if (err.cancelled) return false;
      if (err.code === 'DAY_NOT_OPEN') {
        setDialog('openDay');
        toast.error(err.message);
      } else if (err.code === 'PRICE_CHANGED') {
        const fresh = (await refetchCatalog()).data as PosIndex | undefined;
        if (fresh)
          useCart.getState().syncPrices((id) => fresh.items.find((i) => i.variantId === id));
        setDialog(null);
        toast.warning(err.message, { duration: 10_000 });
      } else if (err.status === 0) {
        toast.error(
          'Could not reach the POS server. The bill is still here; press Pay again (it will not be charged twice).',
          {
            duration: 10_000,
          },
        );
      } else {
        toast.error(err.message);
      }
      return false;
    }
  }

  // ── Keyboard ──

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F5') {
        e.preventDefault(); // a refresh is harmless (the bill is saved) but surprising
        return;
      }
      if (document.querySelector(OPEN_DIALOG)) return;
      const a = actionsRef.current;
      const map: Record<string, () => void> = {
        F1: a.newBill,
        F2: () => scanRef.current?.focus(),
        F3: () => setDialog('customer'),
        F4: a.pay,
        F6: a.hold,
        F7: a.recall,
        F8: a.discount,
        F9: a.togglePriceMode,
        F10: a.reprint,
      };
      const run = map[e.key];
      if (run) {
        e.preventDefault();
        run();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        a.editSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        a.quote();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keys typed into the empty scan box act on the selected line.
  const onEmptyKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const cart = useCart.getState();
      const key = cart.selectedKey;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cart.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      } else if (key && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        cart.changeQty(key, 1);
      } else if (key && e.key === '-') {
        e.preventDefault();
        cart.changeQty(key, -1);
      } else if (key && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (confirmRemove) setRemoveKey(key);
        else cart.remove(key);
      } else if (key && (e.key === '*' || e.key === 'Insert')) {
        e.preventDefault();
        setQtyKey(key);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        cart.moveSelection(e.key === 'Home' ? -9999 : 9999);
      }
    },
    [confirmRemove],
  );

  // The scanner types into whatever has focus, so the scan box must get it back: after clicks on
  // the till, after a dialog closes (it returns focus to the button that opened it), and when the
  // window is focused again.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (document.querySelector(OPEN_DIALOG) || target.closest(KEEPS_FOCUS)) return;
      if (rootRef.current?.contains(target)) focusScan();
    };
    const onWindowFocus = () => focusScan();
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [focusScan]);

  return (
    <div
      ref={rootRef}
      className="flex h-full"
      onMouseUp={(e) => {
        if (!(e.target as HTMLElement).closest(`${KEEPS_FOCUS}, [role="dialog"]`)) focusScan();
      }}
    >
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card flex items-center gap-3 border-b px-4 py-3">
          <ScanBox
            ref={scanRef}
            catalog={catalog}
            priceMode={priceMode}
            onAdd={addItem}
            onNotFound={notFound}
            onSetQty={(qty) => {
              const key = useCart.getState().selectedKey;
              if (key) useCart.getState().setQty(key, qty);
              else toast.info('Scan an item first, then type the quantity and *');
            }}
            onEmptyKey={onEmptyKey}
          />
          <CustomerChip onPick={() => setDialog('customer')} />
          <div
            className="bg-muted inline-flex shrink-0 rounded-lg p-1"
            role="radiogroup"
            aria-label="Price mode"
          >
            {(['RETAIL', 'WHOLESALE'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={priceMode === mode}
                onClick={() => useCart.getState().setPriceMode(mode)}
                className={cn(
                  'h-10 rounded-md px-3.5 text-sm font-medium transition-colors',
                  priceMode === mode
                    ? 'bg-brand text-brand-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode === 'RETAIL' ? 'Retail' : 'Wholesale'}
              </button>
            ))}
          </div>
          <kbd className="bg-muted text-muted-foreground hidden rounded px-1.5 py-0.5 text-[11px] xl:inline">
            F9
          </kbd>
          <AskAiButton />
        </header>

        <CartList
          totals={totals}
          stockOf={(id) => catalog?.items.find((i) => i.variantId === id)}
          onEdit={setEditKey}
          onRemove={(key) => (confirmRemove ? setRemoveKey(key) : useCart.getState().remove(key))}
          onQtyDone={focusScan}
        />

        <footer className="text-muted-foreground bg-card flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs">
          {[
            ['F3', 'Customer'],
            ['F4', 'Pay'],
            ['F6', 'Hold'],
            ['F8', 'Discount'],
            ['Del', 'Remove'],
            ['F12', 'All keys'],
          ].map(([k, label]) => (
            <span key={k} className="whitespace-nowrap">
              <kbd className="bg-muted text-foreground mr-1 rounded px-1.5 py-0.5 font-medium">
                {k}
              </kbd>
              {label}
            </span>
          ))}
          <span className="ml-auto whitespace-nowrap">
            {session === null ? (
              <span className="text-destructive font-medium">Day not open</span>
            ) : session ? (
              `Day open since ${new Date(session.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            ) : null}
          </span>
        </footer>
      </section>

      <TotalsPanel
        totals={totals}
        session={session}
        heldCount={held.length}
        lastResult={lineCount ? null : lastResult}
        vatRegistered={settings?.tax.vatRegistered ?? false}
        onPay={actions.pay}
        onDiscount={actions.discount}
        onHold={actions.hold}
        onRecall={actions.recall}
        onNew={actions.newBill}
        onReprint={actions.reprint}
        onOpenDay={() => setDialog('openDay')}
        payment={
          dialog === 'pay' && lineCount > 0 ? (
            <PaymentPanel
              key={totals.total}
              total={totals.total}
              credit={
                customer && can('customers.credit')
                  ? {
                      name: customer.name,
                      balance: customer.balance,
                      creditLimit: customer.creditLimit,
                    }
                  : null
              }
              onComplete={checkout}
              onCancel={close}
            />
          ) : undefined
        }
      />
      <CustomerDialog open={dialog === 'customer'} onClose={close} />
      <LineDialog
        lineKey={editKey}
        onClose={() => {
          setEditKey(null);
          focusScan();
        }}
      />
      <BillDiscountDialog open={dialog === 'discount'} onClose={close} />
      <HoldDialog open={dialog === 'hold'} onClose={close} />
      <RecallDialog open={dialog === 'recall'} onClose={close} catalog={catalog} />
      <OpenDayDialog open={dialog === 'openDay'} onClose={close} />
      <QtyDialog
        lineKey={qtyKey}
        onClose={() => {
          setQtyKey(null);
          focusScan();
        }}
      />
      <ConfirmDialog
        open={!!removeKey && !!removeLine}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveKey(null);
            focusScan();
          }
        }}
        title="Remove this item?"
        description={removeLine && `${removeLine.qty} × ${removeLine.name}`}
        confirmText="Remove"
        destructive
        onConfirm={() => {
          if (removeKey) useCart.getState().remove(removeKey);
          setRemoveKey(null);
          focusScan();
        }}
      />
      <ConfirmDialog
        open={dialog === 'newBill'}
        onOpenChange={(open) => !open && close()}
        title="Start a new bill?"
        description="The items on the current bill will be removed. Use Hold (F6) to keep them for later."
        confirmText="Start new bill"
        destructive
        onConfirm={() => {
          useCart.getState().reset(defaultMode);
          setLastResult(null);
          close();
        }}
      />
    </div>
  );
}

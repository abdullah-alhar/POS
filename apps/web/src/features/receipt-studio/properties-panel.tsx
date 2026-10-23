import { useRef, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Eye,
  EyeOff,
  Lock,
  MessageCircle,
  Trash2,
  Underline,
  Unlock,
} from 'lucide-react';
import {
  DIVIDER_STYLES,
  RECEIPT_CONDITIONS,
  RECEIPT_ELEMENT_INFO,
  RECEIPT_FIELDS,
  TEXT_SIZES,
  type ReceiptCondition,
  type ReceiptElement,
  type ReceiptField,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { duplicatePieces, removePieces, toggleHidden, toggleLocked, updatePieces } from './actions';
import { PIECE_ICONS } from './icons';
import { useStudio, type Design } from './store';

type Of<T extends ReceiptElement['type']> = Extract<ReceiptElement, { type: T }>;

export function PropertiesPanel({
  design,
  estimateMm,
}: {
  design: Design;
  estimateMm: number | undefined;
}) {
  const selected = useStudio((s) => s.selected);
  const els = design.layout.filter((e) => selected.includes(e.id));
  if (els.length === 1) return <OnePiece key={els[0]!.id} el={els[0]!} />;
  if (els.length > 1) return <ManyPieces els={els} />;
  return <ReceiptOptions design={design} estimateMm={estimateMm} />;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b pb-3 last:border-b-0">
      {title && (
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

/** Buttons where one is chosen. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  cols,
}: {
  value: T | undefined;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (v: T) => void;
  disabled?: boolean;
  cols?: number;
}) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${cols ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map(([v, label]) => (
        <Button
          key={String(v)}
          type="button"
          size="sm"
          disabled={disabled}
          variant={value === v ? 'default' : 'outline'}
          onClick={() => onChange(v)}
          className="h-8 px-1 text-xs"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>
        {label}
        {hint && <span className="text-muted-foreground block text-[11px]">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

function Toggle({
  on,
  onClick,
  label,
  children,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={on ? 'default' : 'outline'}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/** Buttons that insert {fields} into the box that last had the cursor. */
function FieldChips({ onInsert }: { onInsert: (tag: string) => void }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-[11px]">Insert from the bill:</p>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(RECEIPT_FIELDS) as ReceiptField[]).map((f) => (
          <button
            key={f}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(`{${f}}`)}
            className="bg-muted hover:bg-accent rounded-full px-2 py-0.5 text-[11px]"
          >
            {RECEIPT_FIELDS[f]}
          </button>
        ))}
      </div>
    </div>
  );
}

const ALIGNS = [
  ['left', AlignLeft],
  ['center', AlignCenter],
  ['right', AlignRight],
] as const;

function WhenSelect({
  value,
  onChange,
  disabled,
}: {
  value: ReceiptCondition | undefined;
  onChange: (v: ReceiptCondition | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? 'always'}
      onValueChange={(v) => onChange(v === 'always' ? undefined : (v as ReceiptCondition))}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(RECEIPT_CONDITIONS) as ReceiptCondition[]).map((c) => (
          <SelectItem key={c} value={c}>
            {RECEIPT_CONDITIONS[c]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OnePiece({ el }: { el: ReceiptElement }) {
  const Icon = PIECE_ICONS[el.type];
  const info = RECEIPT_ELEMENT_INFO[el.type];
  const locked = !!el.locked;
  const set = (patch: Partial<ReceiptElement>, label: string, mergeKey?: string) =>
    updatePieces([el.id], patch, label, mergeKey);

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2">
        <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="leading-tight font-semibold">{info.label}</p>
          <p className="text-muted-foreground text-xs leading-snug">{info.hint}</p>
        </div>
      </div>
      {locked && (
        <div className="bg-muted flex items-center gap-2 rounded-lg p-2 text-xs">
          <Lock className="size-3.5" /> Locked: it cannot be changed, moved or removed.
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => toggleLocked([el.id])}
          >
            Unlock
          </Button>
        </div>
      )}

      <fieldset disabled={locked} className="grid gap-3">
        {el.type === 'text' && <TextOptions el={el} set={set} />}
        {el.type === 'pair' && <PairOptions el={el} set={set} />}
        {el.type === 'divider' && (
          <Section title="Line style">
            <Segmented
              cols={2}
              value={el.style}
              options={(Object.keys(DIVIDER_STYLES) as (keyof typeof DIVIDER_STYLES)[]).map(
                (k) => [k, <span className="font-mono">{DIVIDER_STYLES[k]}</span>] as const,
              )}
              onChange={(style) => set({ style }, 'Changed the line style')}
            />
          </Section>
        )}
        {el.type === 'space' && (
          <Section title="Empty lines">
            <Segmented
              value={el.lines}
              options={[1, 2, 3, 4, 5].map((n) => [n, String(n)] as const)}
              onChange={(lines) => set({ lines }, 'Changed the space')}
            />
          </Section>
        )}
        {el.type === 'items' && <ItemsOptions el={el} set={set} />}
        {el.type === 'totals' && (
          <Section title="Total">
            <SwitchRow
              label="Big TOTAL"
              checked={el.bigTotal ?? true}
              onChange={(v) => set({ bigTotal: v ? undefined : false }, 'Changed the total size')}
            />
            <SwitchRow
              label="Only the TOTAL line"
              hint="Leaves out subtotal, discounts and rounding"
              checked={!!el.simple}
              onChange={(v) => set({ simple: v || undefined }, 'Changed the total')}
            />
          </Section>
        )}
        {el.type === 'qr' && <QrOptions el={el} set={set} />}
        {el.type === 'signature' && (
          <Section title="Words under the line">
            <Input
              value={el.label}
              maxLength={60}
              onChange={(e) =>
                set({ label: e.target.value }, 'Changed the signature', `sig:${el.id}`)
              }
            />
          </Section>
        )}
        {['logo', 'payments', 'itemCount', 'savings', 'barcode'].includes(el.type) && (
          <p className="text-muted-foreground text-xs">
            {el.type === 'logo'
              ? 'The logo comes from Settings → Look. For the receipt printer it is made black and white.'
              : el.type === 'barcode'
                ? 'The bill number as a barcode: scan it on the Returns page to find the bill at once.'
                : 'Filled in from each bill.'}
          </p>
        )}

        <Section title="Print">
          <Label className="text-xs font-normal">Print this piece when</Label>
          <WhenSelect
            value={el.when}
            onChange={(when) => set({ when }, 'Changed when it prints')}
          />
          <SwitchRow
            label="Hidden"
            hint="Kept in the design, not printed"
            checked={!!el.hidden}
            onChange={() => toggleHidden([el.id])}
          />
        </Section>

        <Section title="Layer name">
          <Input
            value={el.name ?? ''}
            placeholder="Optional, e.g. Footer"
            maxLength={40}
            onChange={(e) =>
              set({ name: e.target.value || undefined }, 'Renamed a layer', `name:${el.id}`)
            }
          />
        </Section>
      </fieldset>

      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => duplicatePieces([el.id])}>
          <Copy /> Duplicate
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => toggleLocked([el.id])}>
          {locked ? <Unlock /> : <Lock />} {locked ? 'Unlock' : 'Lock'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive ml-auto"
          onClick={() => removePieces([el.id])}
          disabled={locked}
        >
          <Trash2 /> Remove
        </Button>
      </div>
    </div>
  );
}

type Setter = (patch: Partial<ReceiptElement>, label: string, mergeKey?: string) => void;

function TextOptions({ el, set }: { el: Of<'text'>; set: Setter }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Section title="Text">
        <textarea
          ref={ref}
          value={el.text}
          rows={3}
          maxLength={500}
          onChange={(e) => set({ text: e.target.value }, 'Typed text', `text:${el.id}`)}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/40 bg-background rounded-md border px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px]"
        />
        <FieldChips
          onInsert={(tag) => {
            const pos = ref.current?.selectionStart ?? el.text.length;
            set(
              { text: `${el.text.slice(0, pos)}${tag}${el.text.slice(pos)}` },
              'Inserted a field',
            );
          }}
        />
        <p className="text-muted-foreground text-[11px]">
          A line is left out when all its fields are empty (e.g. no customer).
        </p>
      </Section>
      <Section title="Style">
        <div className="flex flex-wrap gap-1">
          {ALIGNS.map(([a, I]) => (
            <Toggle
              key={a}
              on={el.align === a}
              onClick={() => set({ align: a }, `Aligned ${a}`)}
              label={`Align ${a}`}
            >
              <I />
            </Toggle>
          ))}
          <span className="w-2" />
          <Toggle
            on={el.bold}
            onClick={() => set({ bold: !el.bold }, el.bold ? 'Bold off' : 'Bold on')}
            label="Bold"
          >
            <Bold />
          </Toggle>
          <Toggle
            on={!!el.underline}
            onClick={() => set({ underline: !el.underline || undefined }, 'Changed underline')}
            label="Underline"
          >
            <Underline />
          </Toggle>
          <Toggle
            on={!!el.invert}
            onClick={() => set({ invert: !el.invert || undefined }, 'Changed white on black')}
            label="White on black"
          >
            <span className="rounded-sm bg-current px-0.5 text-[10px] font-bold">
              <span className="text-background">A</span>
            </span>
          </Toggle>
        </div>
        <Segmented
          value={el.size}
          options={(Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]).map(
            (k) => [k, TEXT_SIZES[k]] as const,
          )}
          onChange={(size) => set({ size }, `Text size ${TEXT_SIZES[size].toLowerCase()}`)}
        />
        <p className="text-muted-foreground text-[11px]">
          Wide and Big letters fit half as many on a line.
        </p>
      </Section>
    </>
  );
}

function PairOptions({ el, set }: { el: Of<'pair'>; set: Setter }) {
  const last = useRef<'left' | 'right'>('left');
  const refs = { left: useRef<HTMLInputElement>(null), right: useRef<HTMLInputElement>(null) };
  return (
    <>
      <Section title="Left and right">
        {(['left', 'right'] as const).map((side) => (
          <Input
            key={side}
            ref={refs[side]}
            value={el[side]}
            maxLength={200}
            placeholder={side === 'left' ? 'Left side' : 'Right side'}
            onFocus={() => (last.current = side)}
            onChange={(e) => set({ [side]: e.target.value }, 'Typed text', `${side}:${el.id}`)}
            className={cn('font-mono text-sm', side === 'right' && 'text-right')}
          />
        ))}
        <FieldChips
          onInsert={(tag) => {
            const side = last.current;
            const pos = refs[side].current?.selectionStart ?? el[side].length;
            set(
              { [side]: `${el[side].slice(0, pos)}${tag}${el[side].slice(pos)}` },
              'Inserted a field',
            );
          }}
        />
      </Section>
      <Section title="Style">
        <SwitchRow
          label="Bold"
          checked={el.bold}
          onChange={(bold) => set({ bold }, 'Changed bold')}
        />
        <Segmented
          value={el.size}
          options={[
            ['normal', 'Normal'],
            ['large', 'Big'],
          ]}
          onChange={(size) => set({ size }, 'Changed the size')}
        />
      </Section>
    </>
  );
}

function ItemsOptions({ el, set }: { el: Of<'items'>; set: Setter }) {
  return (
    <Section title="Items">
      <Segmented
        value={el.layout}
        options={[
          ['two-line', 'Two lines'],
          ['one-line', 'One line'],
        ]}
        onChange={(layout) => set({ layout }, 'Changed the item layout')}
      />
      {(
        [
          ['showWarranty', 'Warranty and end date'],
          ['showSerial', 'Serial number / IMEI'],
          ['showDiscounts', 'Discounts'],
          ['showSku', 'Item code'],
        ] as const
      ).map(([k, label]) => (
        <SwitchRow
          key={k}
          label={label}
          checked={el[k]}
          onChange={(v) => set({ [k]: v }, `${label} ${v ? 'on' : 'off'}`)}
        />
      ))}
      <SwitchRow
        label="Number the items"
        checked={!!el.numbered}
        onChange={(v) => set({ numbered: v || undefined }, `Numbers ${v ? 'on' : 'off'}`)}
      />
    </Section>
  );
}

function QrOptions({ el, set }: { el: Of<'qr'>; set: Setter }) {
  return (
    <Section title="QR code">
      <Label className="text-xs font-normal">Link or text in the QR code</Label>
      <Input
        value={el.value}
        maxLength={300}
        onChange={(e) => set({ value: e.target.value }, 'Changed the QR code', `qr:${el.id}`)}
      />
      <label className="flex items-center gap-2">
        <MessageCircle className="text-muted-foreground size-4" />
        <Input
          placeholder="Or type a WhatsApp number"
          inputMode="tel"
          className="h-8"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const digits = e.currentTarget.value.replace(/\D/g, '');
            if (digits.length < 7) return;
            const number = /^0\d{9}$/.test(digits) ? `94${digits.slice(1)}` : digits;
            set({ value: `https://wa.me/${number}` }, 'Set a WhatsApp QR code');
            e.currentTarget.value = '';
          }}
        />
      </label>
      <Segmented
        value={el.size ?? 'medium'}
        options={[
          ['small', 'Small'],
          ['medium', 'Medium'],
          ['large', 'Large'],
        ]}
        onChange={(size) =>
          set({ size: size === 'medium' ? undefined : size }, 'Changed the QR size')
        }
      />
      <p className="text-muted-foreground text-[11px]">
        Add a Text piece under it to say what it is, e.g. "Chat with us on WhatsApp".
      </p>
    </Section>
  );
}

function ManyPieces({ els }: { els: ReceiptElement[] }) {
  const ids = els.map((e) => e.id);
  const texts = els.filter((e) => e.type === 'text');
  const boldable = els.filter((e) => e.type === 'text' || e.type === 'pair');
  const allHidden = els.every((e) => e.hidden);
  const allLocked = els.every((e) => e.locked);
  const when = els.every((e) => e.when === els[0]!.when) ? els[0]!.when : undefined;
  return (
    <div className="grid gap-3">
      <div>
        <p className="font-semibold">{els.length} pieces selected</p>
        <p className="text-muted-foreground text-xs">Changes here apply to all of them.</p>
      </div>
      {texts.length > 0 && (
        <Section title={`Text (${texts.length})`}>
          <div className="flex gap-1">
            {ALIGNS.map(([a, I]) => (
              <Toggle
                key={a}
                on={texts.every((t) => t.type === 'text' && t.align === a)}
                onClick={() =>
                  updatePieces(
                    texts.map((t) => t.id),
                    { align: a },
                    `Aligned ${a}`,
                  )
                }
                label={`Align ${a}`}
              >
                <I />
              </Toggle>
            ))}
          </div>
        </Section>
      )}
      {boldable.length > 0 && (
        <Section>
          <SwitchRow
            label="Bold"
            checked={boldable.every((t) => (t.type === 'text' || t.type === 'pair') && t.bold)}
            onChange={(bold) =>
              updatePieces(
                boldable.map((t) => t.id),
                { bold },
                `Bold ${bold ? 'on' : 'off'}`,
              )
            }
          />
        </Section>
      )}
      <Section title="Print">
        <Label className="text-xs font-normal">Print these pieces when</Label>
        <WhenSelect
          value={when}
          onChange={(w) => updatePieces(ids, { when: w }, 'Changed when they print')}
        />
      </Section>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => toggleHidden(ids)}>
          {allHidden ? <Eye /> : <EyeOff />} {allHidden ? 'Show' : 'Hide'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => toggleLocked(ids)}>
          {allLocked ? <Unlock /> : <Lock />} {allLocked ? 'Unlock' : 'Lock'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => duplicatePieces(ids)}>
          <Copy /> Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => removePieces(ids)}
        >
          <Trash2 /> Remove
        </Button>
      </div>
    </div>
  );
}

function ReceiptOptions({
  design,
  estimateMm,
}: {
  design: Design;
  estimateMm: number | undefined;
}) {
  const commit = useStudio((s) => s.commit);
  const hidden = design.layout.filter((e) => e.hidden).length;
  const conditional = design.layout.filter((e) => e.when).length;
  return (
    <div className="grid gap-3">
      <div>
        <p className="font-semibold">Receipt</p>
        <p className="text-muted-foreground text-xs">
          Click a piece on the paper or in Layers to change it.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Pieces" value={design.layout.length} />
        <Stat label="Hidden" value={hidden} />
        <Stat label="Paper" value={estimateMm ? `${Math.round(estimateMm / 10)} cm` : '…'} />
      </div>
      {conditional > 0 && (
        <p className="text-muted-foreground text-xs">
          {conditional} piece{conditional > 1 ? 's print' : ' prints'} only on some bills. Pick a
          bill type at the top to see them.
        </p>
      )}
      <Section title="Copies of every receipt">
        <Segmented
          value={design.copies}
          options={[1, 2, 3].map((n) => [n, String(n)] as const)}
          onChange={(copies) =>
            commit(`${copies} cop${copies > 1 ? 'ies' : 'y'} of every receipt`, { copies })
          }
        />
      </Section>
      <SwitchRow
        label="Shop copy for credit sales"
        hint="An extra copy with a signature line"
        checked={design.shopCopyForCredit}
        onChange={(v) => commit(`Shop copy ${v ? 'on' : 'off'}`, { shopCopyForCredit: v })}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-muted rounded-lg px-2 py-1.5">
      <p className="text-base font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-[11px]">{label}</p>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Tags, Trash2 } from 'lucide-react';
import type { PosIndexItem } from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { ItemSearch } from '@/components/item-search';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePublicSettings } from '@/lib/queries';
import { safeStorage } from '@/lib/storage';
import { printHtml } from '../receipts/print';
import { labelSheetHtml, SHEETS } from './label-sheets';

interface Row {
  item: PosIndexItem;
  copies: string;
}

/** Print price and barcode labels on A4 sticker sheets (through Chrome). */
export function LabelsPage() {
  const { data: settings } = usePublicSettings();
  const [rows, setRows] = useState<Row[]>([]);
  const [sheetId, setSheetId] = useState(() => safeStorage.get('pos-label-sheet') ?? '65');
  const [skip, setSkip] = useState('0');
  const [showPrice, setShowPrice] = useState(true);
  const [showShop, setShowShop] = useState(true);
  const [wholesale, setWholesale] = useState(false);
  const sheet = SHEETS.find((s) => s.id === sheetId) ?? SHEETS[0]!;

  const labels = useMemo(
    () =>
      rows.flatMap((r) =>
        Array.from({ length: Math.min(Number(r.copies) || 0, 500) }, () => ({
          name: r.item.name,
          code: r.item.barcodes[0] ?? r.item.sku,
          price: wholesale ? r.item.wholesalePrice : r.item.retailPrice,
        })),
      ),
    [rows, wholesale],
  );
  const html = useMemo(
    () =>
      labelSheetHtml(labels, {
        sheet,
        skip: Math.min(Number(skip) || 0, sheet.cols * sheet.rows - 1),
        showPrice,
        shopName: showShop ? (settings?.shop.name ?? null) : null,
        currency: settings?.pos.currencySymbol ?? 'Rs',
      }),
    [labels, sheet, skip, showPrice, showShop, settings],
  );
  const pages = Math.ceil(((Number(skip) || 0) + labels.length) / (sheet.cols * sheet.rows));

  return (
    <>
      <PageHeader
        title="Barcode labels"
        description="Print price and barcode stickers on A4 label sheets."
        actions={
          <Button disabled={!labels.length} onClick={() => printHtml(html)}>
            <Printer /> Print {labels.length} label(s)
          </Button>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          <Card className="gap-3">
            <CardContent className="grid gap-3">
              <ItemSearch
                onPick={(item) =>
                  setRows((rs) =>
                    rs.some((r) => r.item.variantId === item.variantId)
                      ? rs
                      : [...rs, { item, copies: String(Math.max(item.stockQty, 1)) }],
                  )
                }
              />
              {rows.length === 0 ? (
                <EmptyState
                  icon={Tags}
                  title="Add items to print labels for"
                  description="The number of labels starts at the stock you have."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Labels</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={r.item.variantId}>
                        <TableCell className="max-w-72">
                          <p className="truncate font-medium">{r.item.name}</p>
                          <p className="text-muted-foreground font-mono text-xs">
                            {r.item.barcodes[0] ?? r.item.sku}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            inputMode="numeric"
                            value={r.copies}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) =>
                              setRows((rs) =>
                                rs.map((x, j) =>
                                  j === i ? { ...x, copies: e.target.value.replace(/\D/g, '') } : x,
                                ),
                              )
                            }
                            className="ml-auto h-9 w-20 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                            aria-label="Remove"
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sheet</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Label sheet">
                <Select
                  value={sheetId}
                  onValueChange={(v) => {
                    setSheetId(v);
                    safeStorage.set('pos-label-sheet', v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHEETS.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Start at label #" hint="For a sheet that is partly used">
                <Input
                  inputMode="numeric"
                  value={String((Number(skip) || 0) + 1)}
                  onChange={(e) =>
                    setSkip(
                      String(Math.max(0, (Number(e.target.value.replace(/\D/g, '')) || 1) - 1)),
                    )
                  }
                />
              </FormField>
              <div className="flex items-center gap-3">
                <Switch id="price" checked={showPrice} onCheckedChange={setShowPrice} />
                <Label htmlFor="price">Show price</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="shop" checked={showShop} onCheckedChange={setShowShop} />
                <Label htmlFor="shop">Show shop name</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="wholesale" checked={wholesale} onCheckedChange={setWholesale} />
                <Label htmlFor="wholesale">Wholesale price</Label>
              </div>
              <p className="text-muted-foreground text-xs sm:col-span-2">
                In the print window choose your normal printer, paper A4, margins "None" and scale
                100%.
              </p>
            </CardContent>
          </Card>
        </div>
        <div>
          <p className="text-muted-foreground mb-2 text-sm">
            Preview {pages > 1 && `(page 1 of ${pages})`}
          </p>
          <SheetPreview html={html} />
        </div>
      </div>
    </>
  );
}

/** The first A4 page, scaled to fit the column. */
function SheetPreview({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale((entry?.contentRect.width ?? 397) / 794),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className="overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{ aspectRatio: '210 / 297' }}
    >
      <iframe
        title="Label preview"
        srcDoc={html}
        className="pointer-events-none origin-top-left border-0"
        style={{ width: 794, height: 1123, transform: `scale(${scale})` }}
      />
    </div>
  );
}

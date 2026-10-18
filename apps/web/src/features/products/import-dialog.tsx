import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { IMPORT_COLUMNS, type ImportResult, type ImportRow } from '@shoppos/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { downloadText, parseCsv, toCsv } from '@/lib/csv';
import { keys } from '@/lib/queries';

const FIELD_LABELS: Record<keyof ImportRow, string> = {
  name: 'Name',
  variant: 'Variant',
  sku: 'SKU',
  barcode: 'Barcode',
  category: 'Category',
  brand: 'Brand',
  costPrice: 'Cost',
  retailPrice: 'Retail price',
  wholesalePrice: 'Wholesale price',
  stock: 'Stock',
  reorderLevel: 'Reorder level',
};

/** Spreadsheet → rows of text keyed by our field names. */
async function readFile(
  file: File,
): Promise<{ rows: ImportRow[]; found: string[]; ignored: string[] }> {
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error('The Excel file has no sheets');
    table = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) cells.push(row.getCell(c).text ?? '');
      table.push(cells);
    });
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    table = parseCsv(await file.text());
  } else {
    throw new Error(
      'Choose a .csv or .xlsx file (in Excel: File > Save As > CSV or Excel Workbook)',
    );
  }
  const [header, ...body] = table;
  if (!header) throw new Error('The file is empty');

  const map = new Map<number, keyof ImportRow>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const name = h.trim().toLowerCase();
    const field = (Object.keys(IMPORT_COLUMNS) as (keyof ImportRow)[]).find((f) =>
      IMPORT_COLUMNS[f].includes(name),
    );
    if (field && ![...map.values()].includes(field)) map.set(i, field);
    else if (h.trim()) ignored.push(h.trim());
  });
  if (![...map.values()].some((f) => f === 'name' || f === 'sku' || f === 'barcode')) {
    throw new Error('No "Name", "SKU" or "Barcode" column found in the first row');
  }
  const rows = body.map((cells) => {
    const row: ImportRow = {};
    for (const [i, field] of map) {
      const v = (cells[i] ?? '').trim();
      if (v) row[field] = v;
    }
    return row;
  });
  return { rows, found: [...map.values()].map((f) => FIELD_LABELS[f]), ignored };
}

const ACTIONS: Record<
  string,
  { label: string; variant: 'success' | 'secondary' | 'warning' | 'destructive' }
> = {
  create: { label: 'New', variant: 'success' },
  'add-variant': { label: 'New variant', variant: 'success' },
  update: { label: 'Update', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
};

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{
    name: string;
    rows: ImportRow[];
    found: string[];
    ignored: string[];
  } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reading, setReading] = useState(false);

  const check = useMutation({
    mutationFn: (rows: ImportRow[]) =>
      api.post<ImportResult>('/products/import', { rows, commit: false }),
    onSuccess: setResult,
  });
  const commit = useMutation({
    mutationFn: () =>
      api.post<ImportResult>('/products/import', { rows: file!.rows, commit: true }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.products });
      qc.invalidateQueries({ queryKey: keys.posIndex });
      qc.invalidateQueries({ queryKey: keys.categories });
      qc.invalidateQueries({ queryKey: keys.brands });
      toast.success(
        `Imported: ${r.summary.create + r.summary.addVariant} new, ${r.summary.update} updated`,
      );
      close();
    },
  });

  function close() {
    setFile(null);
    setResult(null);
    onClose();
  }

  async function pick(f: File) {
    setReading(true);
    setResult(null);
    try {
      const parsed = await readFile(f);
      setFile({ name: f.name, ...parsed });
      check.mutate(parsed.rows);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  function template() {
    downloadText(
      'shoppos-products.csv',
      toCsv([
        [
          'Name',
          'Variant',
          'SKU',
          'Barcode',
          'Category',
          'Brand',
          'Cost',
          'Retail price',
          'Wholesale price',
          'Stock',
          'Reorder level',
        ],
        [
          'Silicone Case',
          'iPhone 15 / Black',
          '',
          '',
          'Cases & Covers',
          'Generic',
          '600',
          '1500',
          '1300',
          '10',
          '3',
        ],
        [
          'Silicone Case',
          'iPhone 16 / Black',
          '',
          '',
          'Cases & Covers',
          'Generic',
          '600',
          '1500',
          '1300',
          '8',
          '3',
        ],
        [
          'Anker 20W Charger',
          '',
          '',
          '0194644098728',
          'Chargers',
          'Anker',
          '2800',
          '4500',
          '3800',
          '5',
          '2',
        ],
      ]),
    );
  }

  const s = result?.summary;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import products</DialogTitle>
          <DialogDescription>
            From Excel (.xlsx) or CSV. Rows with a known SKU or barcode update that item's prices;
            other rows add products. Rows with the same name become variants of one product.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={reading || check.isPending}>
            {reading || check.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Choose
            file
          </Button>
          <Button variant="outline" onClick={template}>
            <Download /> Download template
          </Button>
          {file && (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <FileSpreadsheet className="size-4" /> {file.name} · {file.rows.length} row(s)
            </span>
          )}
        </div>
        {file && (
          <p className="text-muted-foreground text-xs">
            Columns used: {file.found.join(', ')}
            {file.ignored.length > 0 && ` · ignored: ${file.ignored.join(', ')}`}
          </p>
        )}

        {result && s && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="success">{s.create} new product rows</Badge>
              <Badge variant="success">{s.addVariant} new variants</Badge>
              <Badge variant="warning">{s.update} updates</Badge>
              {s.error > 0 && (
                <Badge variant="destructive">
                  {s.error} errors: fix them in the file and choose it again
                </Badge>
              )}
            </div>
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead className="w-28">Action</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...result.rows]
                    .sort(
                      (a, b) =>
                        Number(b.action === 'error') - Number(a.action === 'error') ||
                        a.row - b.row,
                    )
                    .map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="tabular-nums">{r.row}</TableCell>
                        <TableCell>
                          <Badge variant={ACTIONS[r.action]!.variant}>
                            {ACTIONS[r.action]!.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-64 truncate">{r.name}</TableCell>
                        <TableCell className="text-muted-foreground max-w-96 text-xs whitespace-normal">
                          {r.message}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!result || result.summary.error > 0 || commit.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending && <Loader2 className="animate-spin" />} Import{' '}
            {result ? result.rows.length - result.summary.error : ''} row(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { formatMoney } from '@shoppos/shared';
import { downloadBlob } from '@/lib/csv';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null;
  /** money: cents → rupees with 2 decimals; int: whole number; text: as is. */
  kind?: 'money' | 'int' | 'text';
}

export interface ExportTable<T> {
  title: string;
  /** e.g. "1 Oct 2026 – 14 Oct 2026". */
  subtitle: string;
  fileName: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** A last row in bold, e.g. totals. */
  totals?: T;
}

/** Excel workbook with real numbers (so the owner can add up columns in Excel). */
export async function exportExcel<T>(t: ExportTable<T>, shopName: string) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'ShopPOS';
  const sheet = book.addWorksheet(t.title.slice(0, 31));
  sheet.addRow([`${shopName} – ${t.title}`]).font = { bold: true, size: 14 };
  sheet.addRow([t.subtitle]).font = { color: { argb: 'FF666666' } };
  sheet.addRow([]);
  const header = sheet.addRow(t.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F1F1' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  const cell = (c: ExportColumn<T>, row: T) => {
    const v = c.value(row);
    if (v === null || v === undefined) return null;
    return c.kind === 'money' ? Number(v) / 100 : v;
  };
  for (const row of t.rows) sheet.addRow(t.columns.map((c) => cell(c, row)));
  if (t.totals) sheet.addRow(t.columns.map((c) => cell(c, t.totals!))).font = { bold: true };
  t.columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    if (c.kind === 'money') col.numFmt = '#,##0.00';
    col.width = Math.min(
      48,
      Math.max(
        12,
        c.header.length + 4,
        ...t.rows.slice(0, 200).map((r) => String(c.value(r) ?? '').length + 3),
      ),
    );
  });
  const buffer = await book.xlsx.writeBuffer();
  downloadBlob(
    `${t.fileName}.xlsx`,
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

/** A4 PDF with a table, ready to print or send. */
export async function exportPdf<T>(t: ExportTable<T>, shopName: string, symbol: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const wide = t.columns.length > 6;
  const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(15);
  doc.text(`${shopName} – ${t.title}`, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${t.subtitle} · printed ${new Date().toLocaleString()}`, 14, 22);
  const fmt = (c: ExportColumn<T>, row: T) => {
    const v = c.value(row);
    if (v === null || v === undefined) return '';
    if (c.kind === 'money') return formatMoney(Number(v), { symbol, showCents: false });
    if (c.kind === 'int') return Number(v).toLocaleString();
    return String(v);
  };
  autoTable(doc, {
    startY: 27,
    head: [t.columns.map((c) => c.header)],
    body: t.rows.map((r) => t.columns.map((c) => fmt(c, r))),
    foot: t.totals ? [t.columns.map((c) => fmt(c, t.totals!))] : undefined,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [40, 40, 40] },
    footStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(
      t.columns.map((c, i) => [i, { halign: c.kind && c.kind !== 'text' ? 'right' : 'left' }]),
    ),
    didDrawPage: (data) => {
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Page ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() - 24,
        doc.internal.pageSize.getHeight() - 8,
      );
    },
  });
  doc.save(`${t.fileName}.pdf`);
}

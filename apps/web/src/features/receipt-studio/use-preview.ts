import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReceiptBlock, ReceiptDoc, ReceiptSettings } from '@shoppos/shared';
import { api } from '@/lib/api';
import type { Design } from './store';

/** Kinds of bill to try the design on (same list as the server). */
export const SCENARIOS = {
  latest: 'Latest bill',
  sample: 'Sample bill',
  cash: 'Paid with cash',
  card: 'Paid by card',
  credit: 'Sold on credit',
  noCustomer: 'No customer',
  wholesale: 'Wholesale bill',
  quote: 'Quotation',
  reprint: 'Reprint',
} as const;
export type Scenario = keyof typeof SCENARIOS;

export interface PreviewView {
  scenario: Scenario;
  billNumber: string;
  /** 48 = 80 mm paper, 32 = 58 mm. */
  charsPerLine: 32 | 42 | 48;
}

export interface PreviewPiece {
  id: string;
  blocks: ReceiptBlock[];
  skipped?: 'hidden' | 'condition';
}

export interface ReceiptPreview {
  doc: ReceiptDoc;
  pieces: PreviewPiece[];
  text: string;
  estimate: { lines: number; mm: number };
  bill: { number: string; source: 'latest' | 'sample' | 'bill' };
}

export function toReceiptSettings(design: Design, language: 'en' = 'en'): ReceiptSettings {
  return {
    layout: design.layout,
    copies: design.copies,
    shopCopyForCredit: design.shopCopyForCredit,
    language,
  };
}

/** The design filled in with a bill, redrawn shortly after each change. */
export function useReceiptPreview(design: Design | undefined, view: PreviewView) {
  const body = useMemo(
    () =>
      design && {
        receipt: toReceiptSettings(design),
        scenario: view.scenario,
        billNumber: view.billNumber.trim() || undefined,
        charsPerLine: view.charsPerLine,
      },
    [design, view.scenario, view.billNumber, view.charsPerLine],
  );
  const [draft, setDraft] = useState(body);
  useEffect(() => {
    const t = setTimeout(() => setDraft(body), 180);
    return () => clearTimeout(t);
  }, [body]);
  const query = useQuery({
    queryKey: ['receipt-preview', draft],
    queryFn: () => api.post<ReceiptPreview>('/printing/receipt-preview', draft),
    enabled: !!draft,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const piecesById = useMemo(
    () => new Map(query.data?.pieces.map((p) => [p.id, p]) ?? []),
    [query.data],
  );
  return { ...query, piecesById, stale: draft !== body };
}

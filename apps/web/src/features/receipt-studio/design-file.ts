import { z } from 'zod';
import { receiptElementSchema } from '@shoppos/shared';
import type { Design } from './store';

/** A receipt design saved as a file, to keep a copy or use it in another shop. */
const designFileSchema = z.object({
  kind: z.literal('shoppos-receipt-design'),
  version: z.literal(1),
  name: z.string().max(80).optional(),
  copies: z.int().min(1).max(3),
  shopCopyForCredit: z.boolean(),
  layout: z.array(receiptElementSchema).max(80),
});

export function downloadDesign(design: Design, shopName: string) {
  const file = {
    kind: 'shoppos-receipt-design',
    version: 1,
    name: `${shopName} receipt`,
    copies: design.copies,
    shopCopyForCredit: design.shopCopyForCredit,
    layout: design.layout,
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `receipt-design-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a design file; throws a readable message when it is not one. */
export async function readDesignFile(file: File): Promise<Design> {
  if (file.size > 500_000) throw new Error('This file is too big to be a receipt design.');
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a receipt design file.');
  }
  const parsed = designFileSchema.safeParse(data);
  if (!parsed.success) throw new Error('This file is not a receipt design from ShopPOS.');
  return {
    layout: parsed.data.layout,
    copies: parsed.data.copies,
    shopCopyForCredit: parsed.data.shopCopyForCredit,
  };
}

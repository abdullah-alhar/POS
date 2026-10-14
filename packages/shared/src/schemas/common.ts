import { z } from 'zod';
import { MAX_CENTS } from '../money';

export const idSchema = z.uuid();

/** Money in cents: a whole number, never negative. */
export const centsSchema = z.int().min(0).max(MAX_CENTS);

/** Basis points: 0 … 10000 (0% … 100%). */
export const bpSchema = z.int().min(0).max(10_000);

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

/** "true"/"false" in a query string. */
export const queryBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Optional text that turns "" into undefined (forms send empty strings). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

/**
 * A small image stored inline as a base64 data URL. The browser shrinks pictures before upload.
 * SVG is safe here because it is only ever shown with <img>, which never runs scripts.
 */
export const imageDataUrlSchema = (label: string, maxBytes: number, allowSvg = false) =>
  z
    .string()
    .regex(
      allowSvg
        ? /^data:image\/(png|jpeg|webp|svg\+xml);base64,/
        : /^data:image\/(png|jpeg|webp);base64,/,
      `${label} must be a ${allowSvg ? 'PNG, JPEG, WebP or SVG' : 'PNG, JPEG or WebP'} image`,
    )
    .max(
      Math.ceil((maxBytes * 4) / 3) + 40,
      `${label} is too large (max ${Math.round(maxBytes / 1000)} KB)`,
    );

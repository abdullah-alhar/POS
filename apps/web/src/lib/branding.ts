import { useEffect } from 'react';
import { DEFAULT_SETTINGS, type BrandingSettings } from '@shoppos/shared';
import { usePublicSettings } from './queries';
import { safeStorage } from './storage';

const CACHE_KEY = 'pos-brand';

/** Brand colours are cached so the next start paints the right colour before the server answers. */
type CachedBrand = Pick<
  BrandingSettings,
  'primaryColor' | 'sidebar' | 'appName' | 'startupAnimation'
>;

export function cachedBrand(): CachedBrand {
  try {
    const raw = safeStorage.get(CACHE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS.branding, ...(JSON.parse(raw) as Partial<CachedBrand>) };
  } catch {
    /* ignore broken cache */
  }
  return DEFAULT_SETTINGS.branding;
}

/** White or near-black text, whichever reads better on the colour. */
export function readableTextOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return lum > 0.42 ? '#111113' : '#ffffff';
}

export function applyBranding(b: CachedBrand) {
  const root = document.documentElement;
  root.style.setProperty('--brand', b.primaryColor);
  root.style.setProperty('--brand-foreground', readableTextOn(b.primaryColor));
  root.dataset.sidebar = b.sidebar;
  document.title = b.appName;
  safeStorage.set(
    CACHE_KEY,
    JSON.stringify({
      primaryColor: b.primaryColor,
      sidebar: b.sidebar,
      appName: b.appName,
      startupAnimation: b.startupAnimation,
    }),
  );
}

/** Current branding: from the server once loaded, otherwise the cached/default look. */
export function useBranding(): BrandingSettings {
  const { data } = usePublicSettings();
  return data?.branding ?? { ...cachedBrand(), logo: null };
}

/** Mounted once; keeps the page colours in step with the branding settings. */
export function BrandingApplier() {
  const { data } = usePublicSettings();
  const branding = data?.branding;
  useEffect(() => {
    if (branding) applyBranding(branding);
  }, [branding]);
  return null;
}

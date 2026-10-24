import { useQuery } from '@tanstack/react-query';
import {
  formatMoney,
  type AllSettings,
  type BrandDto,
  type CategoryDto,
  type PublicSettings,
} from '@shoppos/shared';
import { useCallback } from 'react';
import { api } from './api';

/** Query keys in one place, so mutations invalidate the right lists. */
export const keys = {
  me: ['me'] as const,
  tiles: ['auth', 'tiles'] as const,
  publicSettings: ['settings', 'public'] as const,
  settings: ['settings', 'all'] as const,
  categories: ['categories'] as const,
  brands: ['brands'] as const,
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  posIndex: ['pos-index'] as const,
  users: ['users'] as const,
};

export const usePublicSettings = () =>
  useQuery({
    queryKey: keys.publicSettings,
    queryFn: () => api.get<PublicSettings>('/settings/public'),
    staleTime: 5 * 60_000,
  });

export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => api.get<AllSettings>('/settings') });

export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api.get<CategoryDto[]>('/categories') });

export const useBrands = () =>
  useQuery({ queryKey: keys.brands, queryFn: () => api.get<BrandDto[]>('/brands') });

/** Money formatter that follows the shop settings (Rs, no cents by default). */
export function useMoney() {
  const { data } = usePublicSettings();
  const symbol = data?.pos.currencySymbol ?? 'Rs';
  const showCents = data?.pos.showCents ?? false;
  return useCallback(
    (cents: number, opts?: { showCents?: boolean }) =>
      formatMoney(cents, { symbol, showCents: opts?.showCents ?? showCents }),
    [symbol, showCents],
  );
}

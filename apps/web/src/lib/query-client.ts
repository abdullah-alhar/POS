import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';

/**
 * Shows an error with its code (and the reference of an unexpected server error), so it can be
 * looked up on Settings → Problems or told to support.
 */
export function showError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.cancelled || error.code === 'UNAUTHORIZED') return;
    const technical = error.status >= 500 || error.status === 0 || error.code.startsWith('DB_');
    toast.error(error.message.replace(/ \(code [A-Z_]+, ref [A-Z0-9]+\)$/, ''), {
      id: error.ref ?? `${error.code}:${error.message}`,
      description: technical
        ? `Code ${error.code}${error.ref ? ` · Ref ${error.ref}` : ''}`
        : undefined,
    });
    return;
  }
  console.error(error);
  toast.error('Something went wrong on this screen. Please try again.', {
    description: `Code CLIENT_ERROR${error instanceof Error ? ` · ${error.message.slice(0, 80)}` : ''}`,
  });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.silent) return;
      showError(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      showError(error);
    },
  }),
  defaultOptions: {
    queries: {
      // Everything is local, so data is cheap to refetch, but avoid flicker while typing.
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status > 0) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { silent?: boolean };
    mutationMeta: { silent?: boolean };
  }
}

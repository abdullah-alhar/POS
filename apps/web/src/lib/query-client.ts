import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';

function showError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.cancelled || error.code === 'UNAUTHORIZED') return;
    toast.error(error.message);
    return;
  }
  toast.error('Something went wrong. Please try again.');
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

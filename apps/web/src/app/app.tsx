import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { ApprovalDialog } from '@/components/approval-dialog';
import { BrandSplash } from '@/components/brand/brand-splash';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BrandingApplier } from '@/lib/branding';
import { queryClient } from '@/lib/query-client';
import { ErrorBoundary } from './error-boundary';
import { router } from './router';

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrandingApplier />
          <RouterProvider router={router} />
          <BrandSplash />
          <ApprovalDialog />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

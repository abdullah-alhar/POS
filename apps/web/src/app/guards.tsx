import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, SearchX } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import type { Permission } from '@shoppos/shared';
import { BrandLogo } from '@/components/brand/brand-logo';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { setUnauthorizedHandler } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { keys } from '@/lib/queries';

export function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <BrandLogo variant="mark" className="text-brand h-9 w-auto animate-pulse" />
    </div>
  );
}

/** Sends the user to the login screen when there is no session (or it ends). */
export function RequireAuth() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(keys.me, null);
      navigate('/login', { replace: true, state: { from: location.pathname } });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, navigate, location.pathname]);

  if (isPending) return <FullScreenLoader />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const can = useCan();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={Lock}
        title="You do not have access to this page"
        description="Ask the shop owner to give you permission."
        action={
          <Button asChild variant="outline">
            <Link to="/billing">Go to billing</Link>
          </Button>
        }
      />
    );
  }
  return <Outlet />;
}

export function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Page not found"
      action={
        <Button asChild variant="outline">
          <Link to="/billing">Go to billing</Link>
        </Button>
      }
    />
  );
}

/** "/" opens the dashboard for those who can see reports, otherwise the till. */
export function HomeRedirect() {
  const can = useCan();
  return <Navigate to={can('reports.view') ? '/dashboard' : '/billing'} replace />;
}

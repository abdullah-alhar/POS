import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { NotificationDto, NotificationsDto } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const KEY = ['notifications'] as const;

const LEVEL = {
  danger: { icon: CircleAlert, className: 'text-destructive bg-destructive/10' },
  warning: { icon: TriangleAlert, className: 'text-amber-600 bg-amber-500/10' },
  info: { icon: Info, className: 'text-sky-600 bg-sky-500/10' },
} as const;

/** "5 min ago", "yesterday", "12/10". */
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return 'yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
}

/**
 * The bell in the sidebar, on every page: stock running out, a day left open, no recent backup,
 * and (for owners) voids, returns and other things others did. New ones also pop up briefly.
 */
export function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<NotificationsDto>('/notifications'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    meta: { silent: true },
  });
  const seen = useMutation({
    mutationFn: () => api.post('/notifications/seen', {}),
    onSuccess: () =>
      qc.setQueryData<NotificationsDto>(KEY, (old) =>
        old ? { unread: 0, items: old.items.map((n) => ({ ...n, unread: false })) } : old,
      ),
  });

  // Pop up what is new since the last look (not everything at start-up).
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    if (known.current) {
      for (const n of data.items)
        if (n.unread && !known.current.has(n.id)) {
          const show =
            n.level === 'danger' ? toast.error : n.level === 'warning' ? toast.warning : toast.info;
          show(n.title, { description: n.detail, id: `notification-${n.id}` });
        }
    }
    known.current = new Set(data.items.map((n) => n.id));
  }, [data]);

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  function openPanel() {
    setOpen(true);
  }
  function close() {
    setOpen(false);
    if (unread) seen.mutate();
  }
  function go(n: NotificationDto) {
    close();
    if (n.link) navigate(n.link);
  }

  const Icon = unread ? BellRing : Bell;
  const button = (
    <button
      type="button"
      onClick={openPanel}
      aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
      className="text-sidebar-foreground hover:bg-sidebar-accent relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium"
    >
      <span className="relative">
        <Icon className={cn('size-4.5', unread > 0 && 'text-sidebar-primary')} />
        {unread > 0 && collapsed && (
          <span className="bg-destructive absolute -top-1.5 -right-1.5 size-2.5 rounded-full" />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Notifications</span>
          {unread > 0 && (
            <span className="bg-destructive rounded-full px-1.5 text-[11px] font-semibold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </>
      )}
    </button>
  );

  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">Notifications</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="top-0 right-0 left-auto flex h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[440px]">
          <header className="flex items-center gap-3 border-b px-5 py-4 pr-14">
            <span className="bg-accent text-brand grid size-9 place-items-center rounded-full">
              <Bell className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Notifications</DialogTitle>
              <DialogDescription className="text-xs">
                {unread ? `${unread} new` : 'You are up to date'}
              </DialogDescription>
            </div>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={() => seen.mutate()}>
                <CheckCheck /> Mark all read
              </Button>
            )}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-16 text-center text-sm">
                <CheckCheck className="text-success size-8" />
                Nothing needs your attention.
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((n) => {
                  const L = LEVEL[n.level];
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => go(n)}
                        className={cn(
                          'hover:bg-muted/60 flex w-full gap-3 px-5 py-3.5 text-left transition-colors',
                          n.unread && 'bg-accent/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
                            L.className,
                          )}
                        >
                          <L.icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-2">
                            <span className="flex-1 text-sm font-medium">{n.title}</span>
                            <span className="text-muted-foreground shrink-0 text-[11px]">
                              {ago(n.at)}
                            </span>
                          </span>
                          {n.detail && (
                            <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">
                              {n.detail}
                            </span>
                          )}
                        </span>
                        {n.unread && (
                          <span className="bg-brand mt-2 size-2 shrink-0 rounded-full" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

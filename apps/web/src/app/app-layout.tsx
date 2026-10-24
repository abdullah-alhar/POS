import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  Keyboard,
  Lock,
  LogOut,
  Minimize2,
  Moon,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router';
import { KeyboardLayer, openPanel } from './keyboard-layer';
import { NAV, pageMatches, type NavItem, type NavPage } from './nav';
import { ROLE_LABELS } from '@shoppos/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandLogo } from '@/components/brand/brand-logo';
import { UserAvatar } from '@/components/user-avatar';
import {
  ChangeCredentialsDialog,
  type AccountDialogMode,
} from '@/features/account/change-credentials-dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { safeStorage } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'pos-sidebar-collapsed';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => safeStorage.get(COLLAPSE_KEY) === '1');
  const can = useCan();
  // The billing screen uses the whole window, without page padding.
  const fullBleed = useMatches().some(
    (m) => (m.handle as { fullBleed?: boolean } | undefined)?.fullBleed,
  );

  function toggle() {
    setCollapsed((c) => {
      safeStorage.set(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  }

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          'bg-sidebar text-sidebar-foreground border-sidebar-border flex shrink-0 flex-col border-r transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div className={cn('flex h-16 items-center', collapsed ? 'justify-center px-2' : 'px-5')}>
          {collapsed ? (
            <BrandLogo variant="mark" className="text-sidebar-primary h-6 w-auto max-w-10" />
          ) : (
            <BrandLogo className="text-sidebar-primary h-8 w-auto max-w-full" />
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {NAV.map((item) => {
            const pages = item.pages.filter((p) => !p.permission || can(p.permission));
            if (!pages.length) return null;
            return <SidebarLink key={item.label} item={item} pages={pages} collapsed={collapsed} />;
          })}
        </nav>

        <div className="border-sidebar-border space-y-1 border-t p-2">
          <AskButton collapsed={collapsed} />
          <UserMenu collapsed={collapsed} />
          <button
            onClick={toggle}
            className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm"
          >
            {collapsed ? (
              <ChevronsRight className="size-4.5" />
            ) : (
              <ChevronsLeft className="size-4.5" />
            )}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      <KeyboardLayer />
      {fullBleed ? (
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      ) : (
        // relative: hidden inputs and other absolutely placed elements stay inside this scrolling
        // area; otherwise they can make the whole window scroll and push the sidebar away.
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-5 lg:p-6">
            <SectionTabs />
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}

/** Ask the assistant from any page (Ctrl+J). */
function AskButton({ collapsed }: { collapsed: boolean }) {
  const button = (
    <button
      type="button"
      onClick={() => openPanel('ask')}
      className="bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium"
    >
      <Sparkles className="text-sidebar-primary size-4.5 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Ask</span>
          <kbd className="text-sidebar-muted text-[10px]">Ctrl+J</kbd>
        </>
      )}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">Ask (Ctrl+J)</TooltipContent>
    </Tooltip>
  );
}

function SidebarLink({
  item,
  pages,
  collapsed,
}: {
  item: NavItem;
  pages: NavPage[];
  collapsed: boolean;
}) {
  const { pathname } = useLocation();
  const isActive = pages.some((p) => pageMatches(p, pathname));
  const link = (
    <Link
      to={pages[0]!.to}
      className={cn(
        'relative flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-foreground before:bg-sidebar-primary before:absolute before:inset-y-2 before:-left-2 before:w-1 before:rounded-r-full'
          : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <item.icon className={cn('size-5 shrink-0', isActive && 'text-sidebar-primary')} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/** Tabs for the pages that share one sidebar entry (e.g. Products · Stock · Labels). */
function SectionTabs() {
  const { pathname } = useLocation();
  const can = useCan();
  const item = NAV.find((i) => i.pages.some((p) => pageMatches(p, pathname)));
  const pages = item?.pages.filter((p) => !p.permission || can(p.permission)) ?? [];
  if (pages.length < 2) return null;
  return (
    <div className="bg-muted mb-5 inline-flex flex-wrap gap-1 rounded-lg p-1">
      {pages.map((p) => (
        <NavLink
          key={p.to}
          to={p.to}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              isActive || pageMatches(p, pathname)
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {p.label}
        </NavLink>
      ))}
    </div>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { data: me } = useMe();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<AccountDialogMode | null>(null);

  const [confirmExit, setConfirmExit] = useState(false);
  const exitPos = useMutation({
    mutationFn: () => api.post('/system/exit-kiosk'),
    onSuccess: () => toast.success('Closing the POS window…'),
  });

  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  if (!me) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hover:bg-sidebar-accent flex w-full items-center gap-2.5 rounded-md p-1.5 text-left">
            <UserAvatar
              name={me.fullName}
              src={me.avatar}
              className="ring-sidebar-border size-8 ring-2"
            />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{me.fullName}</span>
                <span className="text-sidebar-muted block text-xs">{ROLE_LABELS[me.role]}</span>
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuLabel>
            {me.fullName}
            <span className="text-muted-foreground block text-xs font-normal">@{me.username}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog('profile')}>
            <UserRound /> My profile photo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle}>
            {resolved === 'dark' ? <Sun /> : <Moon />}
            {resolved === 'dark' ? 'Light mode' : 'Dark mode'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('pin')}>
            <KeyRound /> Change my PIN
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('password')}>
            <KeyRound /> Change my password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPanel('help')}>
            <Keyboard /> Keyboard shortcuts <span className="ml-auto text-xs opacity-60">F12</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openPanel('lock')}>
            <Lock /> Lock screen <span className="ml-auto text-xs opacity-60">Ctrl+L</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmExit(true)}>
            <Minimize2 /> Exit full-screen POS
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => logout.mutate()}>
            <LogOut /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeCredentialsDialog mode={dialog} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={confirmExit}
        onOpenChange={setConfirmExit}
        title="Close the POS screen?"
        description="The POS keeps running in the background. Open it again with the 'ShopPOS' icon on the desktop. (Keyboard: Alt+F4 also closes it.)"
        confirmText="Close POS"
        onConfirm={() => exitPos.mutate()}
      />
    </>
  );
}

export function ThemeToggleButton() {
  const { resolved, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

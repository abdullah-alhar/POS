import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import {
  loginSchema,
  ROLE_LABELS,
  type AuthUser,
  type LoginInput,
  type LoginTile,
} from '@shoppos/shared';
import { BrandLogo } from '@/components/brand/brand-logo';
import { FormField } from '@/components/form-field';
import { PinPad } from '@/components/pin-pad';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/user-avatar';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { keys, usePublicSettings } from '@/lib/queries';

/** Log in: the shop on the left, who is working and their PIN on the right. */
export function LoginPage() {
  const { data: me } = useMe();
  const {
    data: tiles = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: keys.tiles,
    queryFn: () => api.get<LoginTile[]>('/auth/tiles'),
  });
  const [picked, setPicked] = useState<LoginTile | null>(null);
  const [lockDismissed, setLockDismissed] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; lockedUserId?: string; locked?: boolean } | null;
  const from = state?.from ?? '/';
  // After "Lock screen" the PIN pad of the person who locked it opens straight away.
  const lockedTile = !lockDismissed ? tiles.find((t) => t.id === state?.lockedUserId) : undefined;
  const selected = picked ?? lockedTile ?? null;
  const setSelected = (t: LoginTile | null) => {
    setPicked(t);
    if (!t) setLockDismissed(true);
  };

  function onLoggedIn(user: AuthUser) {
    qc.clear();
    qc.setQueryData(keys.me, user);
    navigate(from === '/login' ? '/' : from, { replace: true });
  }

  if (me) return <Navigate to="/" replace />;

  return (
    <div className="bg-background grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <ShopPanel />

      <main className="flex min-h-full flex-col px-6 py-8 sm:px-10">
        {/* On small screens the shop panel is hidden, so the logo sits on top. */}
        <BrandLogo className="text-brand mx-auto mb-8 h-12 w-auto max-w-[260px] lg:hidden" />

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <div key={usePassword ? 'password' : (selected?.id ?? 'list')} className="login-step">
            {usePassword ? (
              <PasswordLogin onBack={() => setUsePassword(false)} onLoggedIn={onLoggedIn} />
            ) : selected ? (
              <PinLogin
                tile={selected}
                locked={!!state?.locked && selected === lockedTile}
                onBack={() => setSelected(null)}
                onLoggedIn={onLoggedIn}
              />
            ) : (
              <PeopleList
                tiles={tiles}
                loading={isPending}
                failed={isError}
                onRetry={() => refetch()}
                onPick={setSelected}
                onPassword={() => setUsePassword(true)}
              />
            )}
          </div>
        </div>

        <p className="text-muted-foreground mt-8 flex items-center justify-center gap-1.5 text-xs">
          <ShieldCheck className="size-3.5" /> Forgot your PIN or password? Ask the shop owner.
        </p>
      </main>
    </div>
  );
}

/** The shop's name, logo and the time, on the brand colour. */
function ShopPanel() {
  const { data } = usePublicSettings();
  const now = useNow();
  const shopName = data?.shop.name;
  return (
    <aside className="relative hidden overflow-hidden bg-[#09090b] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_40%,#000_20%,transparent_75%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[640px] rounded-full bg-[radial-gradient(circle,var(--glow)_0%,transparent_65%)] opacity-60 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -bottom-48 size-[520px] rounded-full bg-[radial-gradient(circle,var(--glow)_0%,transparent_65%)] opacity-30 blur-3xl"
      />

      <BrandLogo className="logo-enter text-brand relative h-14 w-auto max-w-[320px] self-start drop-shadow-[0_0_24px_var(--glow)]" />

      <div className="relative">
        <p className="text-sm font-medium tracking-[0.2em] text-white/50 uppercase">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <p className="mt-2 text-7xl font-semibold tracking-tight tabular-nums">
          {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </p>
        {shopName && (
          <p className="mt-6 max-w-md text-2xl leading-snug font-medium text-white/90">
            Welcome to {shopName}
          </p>
        )}
        <p className="mt-2 max-w-md text-white/50">
          Billing, stock, customers and reports, all in one place.
        </p>
      </div>

      <p className="relative text-xs text-white/35">ShopPOS {__APP_VERSION__}</p>
    </aside>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function PeopleList({
  tiles,
  loading,
  failed,
  onRetry,
  onPick,
  onPassword,
}: {
  tiles: LoginTile[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onPick: (t: LoginTile) => void;
  onPassword: () => void;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-muted-foreground mt-1 text-sm">Tap your name to start.</p>

      <div className="mt-6 grid max-h-[min(26rem,55vh)] gap-2 overflow-y-auto p-0.5">
        {loading && (
          <div className="text-muted-foreground flex justify-center py-10">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {failed && (
          <div className="rounded-xl border border-dashed p-5 text-center text-sm">
            <p className="font-medium">Cannot reach the shop server.</p>
            <p className="text-muted-foreground mt-1">
              Check that ShopPOS is running, then try again.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            onClick={() => onPick(tile)}
            className="group hover:border-brand/50 hover:bg-accent/60 focus-visible:ring-ring/50 bg-card flex items-center gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-[3px]"
          >
            <UserAvatar name={tile.fullName} src={tile.avatar} className="size-11 text-sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{tile.fullName}</span>
              <span className="text-muted-foreground block text-xs">{ROLE_LABELS[tile.role]}</span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
        {!loading && !failed && !tiles.length && (
          <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm">
            No one has a PIN yet. Log in with a username and password.
          </p>
        )}
      </div>

      <div className="text-muted-foreground my-5 flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
      </div>
      <Button variant="outline" className="w-full" onClick={onPassword}>
        <KeyRound /> Use username and password
      </Button>
    </>
  );
}

function PinLogin({
  tile,
  locked,
  onBack,
  onLoggedIn,
}: {
  tile: LoginTile;
  locked: boolean;
  onBack: () => void;
  onLoggedIn: (user: AuthUser) => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const login = useMutation({
    mutationFn: (value: string) =>
      api.post<AuthUser>('/auth/pin-login', { userId: tile.id, pin: value }),
    meta: { silent: true },
    onSuccess: onLoggedIn,
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not log in');
      setPin('');
    },
  });

  return (
    <div className="flex flex-col items-center">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-muted-foreground -ml-2 self-start"
      >
        <ArrowLeft /> Not you?
      </Button>
      {locked && (
        <p className="bg-muted text-muted-foreground mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs">
          <Lock className="size-3.5" /> Screen locked. The bill is kept.
        </p>
      )}
      <UserAvatar
        name={tile.fullName}
        src={tile.avatar}
        className="ring-brand/30 mt-4 mb-3 size-20 text-xl ring-4"
      />
      <p className="text-lg font-semibold">{tile.fullName}</p>
      <p className="text-muted-foreground mb-5 text-sm">Enter your PIN</p>
      <PinPad
        value={pin}
        onChange={(v) => {
          setPin(v);
          setError('');
        }}
        onSubmit={(v) => login.mutate(v)}
        disabled={login.isPending}
        error={error}
      />
    </div>
  );
}

function PasswordLogin({
  onBack,
  onLoggedIn,
}: {
  onBack: () => void;
  onLoggedIn: (user: AuthUser) => void;
}) {
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (v: LoginInput) => api.post<AuthUser>('/auth/login', v),
    meta: { silent: true },
    onSuccess: onLoggedIn,
    onError: (err) => {
      form.setError('password', {
        message: err instanceof ApiError ? err.message : 'Could not log in',
      });
      form.setValue('password', '');
    },
  });
  useEffect(() => form.setFocus('username'), [form]);
  const e = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((v) => login.mutate(v))} className="grid gap-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-muted-foreground -ml-2 justify-self-start"
      >
        <ArrowLeft /> Back
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="text-muted-foreground mt-1 text-sm">With your username and password.</p>
      </div>
      <FormField label="Username" error={e.username?.message}>
        <Input
          autoComplete="username"
          autoCapitalize="none"
          className="h-11"
          {...form.register('username')}
        />
      </FormField>
      <FormField label="Password" error={e.password?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          className="h-11"
          {...form.register('password')}
        />
      </FormField>
      <Button type="submit" size="lg" disabled={login.isPending} className="mt-1 h-11">
        {login.isPending && <Loader2 className="animate-spin" />} Log in
      </Button>
    </form>
  );
}

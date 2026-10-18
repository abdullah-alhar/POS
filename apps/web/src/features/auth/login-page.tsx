import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Loader2, Lock } from 'lucide-react';
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
import { keys } from '@/lib/queries';

/** Simple login: the logo, then who is working and their PIN. */
export function LoginPage() {
  const { data: me } = useMe();
  const { data: tiles = [], isPending } = useQuery({
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
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-[#08080a] px-6 py-10">
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[720px] -translate-x-1/2 -translate-y-[62%] rounded-full bg-[radial-gradient(circle,var(--glow)_0%,transparent_62%)] opacity-40 blur-3xl" />

      <BrandLogo className="logo-enter text-brand relative mb-10 h-20 w-auto max-w-[min(80vw,420px)] drop-shadow-[0_0_24px_var(--glow)]" />

      <div className="bg-card text-card-foreground relative w-full max-w-md rounded-2xl border p-7 shadow-2xl">
        {usePassword ? (
          <PasswordLogin onBack={() => setUsePassword(false)} onLoggedIn={onLoggedIn} />
        ) : selected ? (
          <>
            {state?.locked && selected === lockedTile && (
              <p className="text-muted-foreground mb-3 flex items-center justify-center gap-1.5 text-sm">
                <Lock className="size-4" /> Screen locked. The bill is kept.
              </p>
            )}
            <PinLogin tile={selected} onBack={() => setSelected(null)} onLoggedIn={onLoggedIn} />
          </>
        ) : (
          <>
            <h1 className="text-center text-lg font-semibold">Who is working?</h1>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {isPending && (
                <div className="text-muted-foreground col-span-full flex justify-center py-6">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              )}
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  onClick={() => setSelected(tile)}
                  className="hover:border-brand/60 hover:bg-accent focus-visible:ring-ring/50 flex w-[7.25rem] flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors outline-none focus-visible:ring-[3px]"
                >
                  <UserAvatar
                    name={tile.fullName}
                    src={tile.avatar}
                    className="size-14 text-base"
                  />
                  <span className="line-clamp-2 text-sm leading-tight font-medium">
                    {tile.fullName}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {ROLE_LABELS[tile.role]}
                  </span>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="text-muted-foreground mt-5 w-full"
              onClick={() => setUsePassword(true)}
            >
              <KeyRound /> Use username and password
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PinLogin({
  tile,
  onBack,
  onLoggedIn,
}: {
  tile: LoginTile;
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
      <div className="mb-4 flex w-full items-center">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </Button>
      </div>
      <UserAvatar name={tile.fullName} src={tile.avatar} className="mb-2 size-16 text-lg" />
      <p className="font-semibold">{tile.fullName}</p>
      <p className="text-muted-foreground mb-4 text-sm">Enter your PIN</p>
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
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">Log in</h1>
      </div>
      <FormField label="Username" htmlFor="username" error={e.username?.message}>
        <Input
          id="username"
          autoComplete="username"
          autoCapitalize="none"
          {...form.register('username')}
        />
      </FormField>
      <FormField label="Password" htmlFor="password" error={e.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
      </FormField>
      <Button type="submit" size="lg" disabled={login.isPending} className="mt-1">
        {login.isPending && <Loader2 className="animate-spin" />} Log in
      </Button>
    </form>
  );
}

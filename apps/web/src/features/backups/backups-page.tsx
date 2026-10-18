import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Cloud,
  DatabaseBackup,
  Download,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Usb,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BackupDto, BackupSettings, BackupStatusDto } from '@shoppos/shared';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { keys, useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';

const statusKey = ['backups', 'status'] as const;
const listKey = ['backups', 'list'] as const;

const KIND_LABEL: Record<BackupDto['kind'], string> = {
  AUTO: 'Automatic',
  MANUAL: 'Manual',
  PRE_RESTORE: 'Before a restore',
  PRE_UPDATE: 'Before an update',
};

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function BackupsPage() {
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<{ backup: BackupDto; source: 'local' | 'usb' } | null>(
    null,
  );
  const { data: status } = useQuery({
    queryKey: statusKey,
    queryFn: () => api.get<BackupStatusDto>('/backups/status'),
  });
  const { data: list = [], isPending } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<BackupDto[]>('/backups'),
  });
  const { data: usbList = [] } = useQuery({
    queryKey: ['backups', 'usb'],
    queryFn: () => api.get<BackupDto[]>('/backups/usb'),
    enabled: !!status?.usb.available,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['backups'] });
  };
  const backupNow = useMutation({
    mutationFn: () => api.post<BackupDto>('/backups'),
    onSuccess: (b) => {
      toast.success(`Backup saved (${size(b.sizeBytes)})`);
      refresh();
      // The USB / Drive copy runs in the background; show its result shortly.
      setTimeout(refresh, 5000);
    },
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ usb: string; drive: string }>('/backups/sync'),
    onSuccess: (r) => {
      toast.info(`USB: ${r.usb}. Google Drive: ${r.drive}.`, { duration: 8000 });
      refresh();
    },
  });

  return (
    <>
      <PageHeader
        title="Backups"
        description="Copies of all shop data. Keep a copy off this laptop (USB or Google Drive) in case it is lost or broken."
        actions={
          <>
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Copy to USB /
              Drive now
            </Button>
            <Button onClick={() => backupNow.mutate()} disabled={backupNow.isPending}>
              {backupNow.isPending ? <Loader2 className="animate-spin" /> : <DatabaseBackup />} Back
              up now
            </Button>
          </>
        }
      />

      {status && !status.pgDumpFound && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-lg border px-4 py-3 text-sm">
          The backup tool (pg_dump) was not found. Run the installer again to repair it.
        </p>
      )}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          icon={History}
          title="Last backup"
          ok={!!status?.lastOk}
          text={status?.lastOk ? new Date(status.lastOk.createdAt).toLocaleString() : 'None yet'}
          sub={status?.dailyAt ? `Every day at ${status.dailyAt}` : 'No daily backup set'}
        />
        <StatusCard
          icon={HardDrive}
          title="On this laptop"
          ok
          text={`${list.filter((b) => b.status === 'OK').length} backup(s)`}
          sub={status?.folder}
        />
        <StatusCard
          icon={Usb}
          title="USB drive"
          ok={!!status?.usb.available}
          text={
            !status?.usb.configured
              ? 'Not set up'
              : status.usb.available
                ? 'Plugged in'
                : 'Not plugged in'
          }
          sub={status?.usb.path ?? 'Set a USB folder below'}
        />
        <StatusCard
          icon={Cloud}
          title="Google Drive"
          ok={!!status?.drive.connected}
          text={status?.drive.connected ? 'Connected' : 'Not connected'}
          sub={status?.drive.email ?? 'Optional, needs internet'}
        />
      </div>

      <div className="mb-5 grid items-start gap-5 xl:grid-cols-2">
        <BackupSettingsCard />
        <DriveCard status={status} />
      </div>

      <Card className="mb-5 gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>Backups on this laptop</CardTitle>
        </CardHeader>
        <BackupTable
          rows={list}
          loading={isPending}
          onRestore={(b) => setRestoring({ backup: b, source: 'local' })}
          showDownload
        />
      </Card>

      {status?.usb.available && (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>Backups on the USB drive</CardTitle>
            <CardDescription>{status.usb.path}</CardDescription>
          </CardHeader>
          <BackupTable
            rows={usbList}
            loading={false}
            onRestore={(b) => setRestoring({ backup: b, source: 'usb' })}
          />
        </Card>
      )}

      <Dialog open={!!restoring} onOpenChange={(o) => !o && setRestoring(null)}>
        <DialogContent className="sm:max-w-md">
          {restoring && (
            <RestoreForm
              backup={restoring.backup}
              source={restoring.source}
              onDone={() => setRestoring(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusCard({
  icon: Icon,
  title,
  text,
  sub,
  ok,
}: {
  icon: typeof Usb;
  title: string;
  text: string;
  sub?: string;
  ok: boolean;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-muted-foreground text-sm font-normal">{title}</CardTitle>
        <Icon className={cn('size-4', ok ? 'text-success' : 'text-muted-foreground')} />
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-lg font-semibold">{text}</p>
        {sub && (
          <p className="text-muted-foreground truncate text-xs" title={sub}>
            {sub}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BackupTable({
  rows,
  loading,
  onRestore,
  showDownload,
}: {
  rows: BackupDto[];
  loading: boolean;
  onRestore: (b: BackupDto) => void;
  showDownload?: boolean;
}) {
  if (loading) return <p className="text-muted-foreground p-5 text-sm">Loading…</p>;
  if (!rows.length) return <p className="text-muted-foreground p-5 text-sm">No backups yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Size</TableHead>
          {showDownload && <TableHead>Copies</TableHead>}
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={b.id}>
            <TableCell>
              {new Date(b.createdAt).toLocaleString()}
              <span className="text-muted-foreground block font-mono text-xs">{b.fileName}</span>
            </TableCell>
            <TableCell>
              {b.status === 'FAILED' ? (
                <Badge variant="destructive" title={b.error ?? ''}>
                  Failed: {b.error?.slice(0, 60)}
                </Badge>
              ) : (
                KIND_LABEL[b.kind]
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {b.status === 'OK' ? size(b.sizeBytes) : '—'}
            </TableCell>
            {showDownload && (
              <TableCell className="text-sm">
                {b.status === 'OK' && (
                  <span className="flex gap-3">
                    <Copy ok={b.copiedToUsb} label="USB" />
                    <Copy ok={b.uploadedToDrive} label="Drive" />
                  </span>
                )}
              </TableCell>
            )}
            <TableCell className="text-right whitespace-nowrap">
              {b.status === 'OK' && showDownload && (
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/backups/files/${encodeURIComponent(b.fileName)}`} download>
                    <Download /> Save
                  </a>
                </Button>
              )}
              {b.status === 'OK' && (
                <Button variant="ghost" size="sm" onClick={() => onRestore(b)}>
                  <RotateCcw /> Restore
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Copy({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('flex items-center gap-1', ok ? 'text-success' : 'text-muted-foreground')}>
      {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} {label}
    </span>
  );
}

function BackupSettingsCard() {
  const { data: settings } = useSettings();
  if (!settings) return <Card className="h-64" />;
  return <BackupSettingsForm initial={settings.backup} />;
}

function BackupSettingsForm({ initial }: { initial: BackupSettings }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<BackupSettings>(initial);
  const save = useMutation({
    mutationFn: (v: BackupSettings) => api.put<BackupSettings>('/settings/backup', v),
    onSuccess: (v) => {
      setForm(v);
      qc.invalidateQueries({ queryKey: keys.settings });
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast.success('Backup settings saved');
    },
  });
  const set = <K extends keyof BackupSettings>(k: K, v: BackupSettings[K]) =>
    setForm({ ...form, [k]: v });
  return (
    <Card>
      <CardHeader>
        <CardTitle>When and where</CardTitle>
        <CardDescription>
          Backups run in the background; selling is not interrupted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Daily backup time" hint="Leave empty for no daily backup">
              <Input
                type="time"
                value={form.dailyAt}
                onChange={(e) => set('dailyAt', e.target.value)}
              />
            </FormField>
            <FormField label="How many to keep">
              <Input
                type="number"
                min={3}
                max={365}
                value={form.keep}
                onChange={(e) => set('keep', Number(e.target.value) || 30)}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.onDayClose} onCheckedChange={(v) => set('onDayClose', v)} />
            Also back up when the day is closed
          </label>
          <FormField
            label="USB folder"
            hint="e.g. E:\ShopPOSBackups. The newest backup is copied there whenever the USB drive is plugged in."
          >
            <Input
              value={form.usbPath}
              onChange={(e) => set('usbPath', e.target.value)}
              placeholder="E:\ShopPOSBackups"
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.driveUpload} onCheckedChange={(v) => set('driveUpload', v)} />
            Upload to Google Drive when online
          </label>
          <div>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DriveCard({ status }: { status?: BackupStatusDto }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [waiting, setWaiting] = useState(false);
  const connected = !!status?.drive.connected;

  const pending = waiting && !connected;
  // After opening Google's page, check every few seconds until the connection shows up.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: statusKey }), 3000);
    const stop = setTimeout(() => setWaiting(false), 10 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [pending, qc]);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && connected) toast.success('Google Drive connected');
    wasPending.current = pending;
  }, [pending, connected]);

  const connect = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>('/backups/drive/connect', { clientId, clientSecret }),
    onSuccess: ({ url }) => {
      setWaiting(true);
      window.open(url, '_blank', 'noopener');
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api.post('/backups/drive/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      qc.invalidateQueries({ queryKey: keys.settings });
      toast.success('Google Drive disconnected');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="size-4" /> Google Drive (optional)
        </CardTitle>
        <CardDescription>
          An extra copy in your own Google Drive, in a folder called &ldquo;ShopPOS Backups&rdquo;.
          The shop keeps working without internet; uploads happen when it is online.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connected ? (
          <div className="grid gap-3 text-sm">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="text-success size-4" /> Connected
              {status?.drive.email && ` to ${status.drive.email}`}
            </p>
            <div>
              <Button
                variant="outline"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
              <li>
                On a computer with internet, open console.cloud.google.com, make a project and turn
                on the <b>Google Drive API</b>.
              </li>
              <li>
                Under &ldquo;OAuth consent screen&rdquo;, choose External and add your Gmail as a
                test user (or publish the app).
              </li>
              <li>
                Under &ldquo;Credentials&rdquo;, create an <b>OAuth client ID</b> of type{' '}
                <b>Desktop app</b>. Copy the Client ID and secret here.
              </li>
              <li>
                Press Connect, sign in to Google and allow access. The page then says
                &ldquo;connected&rdquo;.
              </li>
            </ol>
            <FormField label="Client ID">
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="1234-abc.apps.googleusercontent.com"
              />
            </FormField>
            <FormField label="Client secret">
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="off"
              />
            </FormField>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={!clientId.trim() || !clientSecret.trim() || connect.isPending}
              >
                {connect.isPending && <Loader2 className="animate-spin" />} Connect
              </Button>
              {pending && (
                <span className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Waiting for Google…
                </span>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function RestoreForm({
  backup,
  source,
  onDone,
}: {
  backup: BackupDto;
  source: 'local' | 'usb';
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const restore = useMutation({
    mutationFn: () =>
      api.post<{ restored: string; safetyBackup: string }>('/backups/restore', {
        fileName: backup.fileName,
        source,
        confirm,
      }),
    onSuccess: () => {
      toast.success('Backup restored. Reloading…');
      onDone();
      setTimeout(() => window.location.reload(), 1500);
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm === 'RESTORE') restore.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Restore this backup?</DialogTitle>
        <DialogDescription>
          All data will go back to how it was on{' '}
          <b>{new Date(backup.createdAt).toLocaleString()}</b>. Sales and changes made after that
          will be replaced. A backup of the data as it is now is made first, so this can be undone.
        </DialogDescription>
      </DialogHeader>
      <FormField label="Type RESTORE to confirm">
        <Input
          autoFocus
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.toUpperCase())}
          className="font-mono"
        />
      </FormField>
      {restore.isPending && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Restoring. Do not close the POS…
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={restore.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={confirm !== 'RESTORE' || restore.isPending}
        >
          <RotateCcw /> Restore
        </Button>
      </DialogFooter>
    </form>
  );
}

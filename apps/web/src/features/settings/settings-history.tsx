import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompareArrows, History, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  diffSettings,
  SECTION_LABELS,
  SECTION_PERMISSION,
  SETTINGS_SCHEMAS,
  SETTINGS_SECTIONS,
  type AllSettings,
  type SettingsSection,
  type SettingsVersionDto,
} from '@shoppos/shared';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError, qs } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { DiffTable } from './diff-table';
import { saveSections } from './save-sections';

type Mode = 'change' | 'now' | 'undo';

/**
 * Every saved change of the settings: what it changed, how it compares with now, and a way to
 * undo it (the version from before the change is saved again).
 */
export function SettingsHistory({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const can = useCan();
  const [section, setSection] = useState<SettingsSection | 'all'>('all');
  const [open, setOpen] = useState<{ v: SettingsVersionDto; mode: Mode } | null>(null);
  const { data: versions = [], isPending } = useQuery({
    queryKey: ['settings-history', section],
    queryFn: () =>
      api.get<SettingsVersionDto[]>(
        `/settings/history${qs({ section: section === 'all' ? undefined : section, limit: 60 })}`,
      ),
  });

  const sectionOf = (v: SettingsVersionDto) => v.section as SettingsSection;
  /** The version from before the change, with logos (not kept in the history) taken from now. */
  const restored = (v: SettingsVersionDto) => {
    const s = sectionOf(v);
    const value = Object.fromEntries(
      Object.entries((v.before ?? {}) as Record<string, unknown>).map(([k, x]) => [
        k,
        x === '[image]' ? (settings[s] as Record<string, unknown>)[k] : x,
      ]),
    );
    return SETTINGS_SCHEMAS[s].safeParse({ ...settings[s], ...value });
  };
  const allowed = (s: SettingsSection) => can(SECTION_PERMISSION[s] ?? 'settings.manage');

  const undo = useMutation({
    mutationFn: async (v: SettingsVersionDto) => {
      const parsed = restored(v);
      if (!parsed.success) throw new Error('This older version cannot be used any more.');
      await saveSections(qc, { [sectionOf(v)]: parsed.data }, [sectionOf(v)]);
    },
    onSuccess: () => {
      setOpen(null);
      toast.success('The earlier version is back');
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : 'Could not restore',
      ),
  });

  const rows = (() => {
    if (!open) return [];
    const s = sectionOf(open.v);
    if (open.mode === 'change') return diffSettings({ [s]: open.v.before }, { [s]: open.v.after });
    if (open.mode === 'now') return diffSettings({ [s]: open.v.after }, { [s]: settings[s] });
    const parsed = restored(open.v);
    return parsed.success ? diffSettings({ [s]: settings[s] }, { [s]: parsed.data }) : [];
  })();
  const labels: Record<Mode, [string, string, string]> = {
    change: ['What this change did', 'Before', 'After'],
    now: ['Since then', 'Then', 'Now'],
    undo: ['Undo this change?', 'Now', 'Will be'],
  };

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">History and compare</p>
          <p className="text-muted-foreground text-sm">
            Every saved change, who made it and when. Compare any version with now, or undo it.
          </p>
        </div>
        <Select value={section} onValueChange={(v) => setSection(v as SettingsSection | 'all')}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All settings</SelectItem>
            {SETTINGS_SECTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {SECTION_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isPending ? (
        <p className="text-muted-foreground p-6 text-sm">Loading…</p>
      ) : versions.length === 0 ? (
        <EmptyState
          icon={History}
          title="No changes yet"
          description="Saved changes show up here."
        />
      ) : (
        <ul className="divide-y">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{SECTION_LABELS[sectionOf(v)] ?? v.section}</Badge>
                  <span className="text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {v.userName && ` · ${v.userName}`}
                  </span>
                </p>
                <p className="mt-1 text-sm">{v.summary}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setOpen({ v, mode: 'change' })}>
                  See change
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen({ v, mode: 'now' })}>
                  <GitCompareArrows /> Compare with now
                </Button>
                {allowed(sectionOf(v)) && (
                  <Button size="sm" variant="outline" onClick={() => setOpen({ v, mode: 'undo' })}>
                    <RotateCcw /> Undo
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{labels[open.mode][0]}</DialogTitle>
                <DialogDescription>
                  {SECTION_LABELS[sectionOf(open.v)]}, saved{' '}
                  {new Date(open.v.createdAt).toLocaleString()}
                  {open.v.userName && ` by ${open.v.userName}`}.
                  {open.mode === 'undo' && ' The settings from before this change are saved again.'}
                </DialogDescription>
              </DialogHeader>
              <DiffTable
                rows={rows}
                beforeLabel={labels[open.mode][1]}
                afterLabel={labels[open.mode][2]}
              />
              {open.mode === 'undo' && (
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!rows.length || undo.isPending}
                    onClick={() => undo.mutate(open.v)}
                  >
                    {undo.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Undo the
                    change
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

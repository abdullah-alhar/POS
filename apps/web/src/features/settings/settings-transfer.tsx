import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  diffSettings,
  SECTION_LABELS,
  SECTION_PERMISSION,
  SETTINGS_SCHEMAS,
  SETTINGS_SECTIONS,
  type AllSettings,
  type SettingsSection,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useCan } from '@/lib/auth';
import { DiffTable } from './diff-table';
import { saveSections } from './save-sections';

/** Sections a settings file can carry (the printer's logo image is made again on each laptop). */
const FILE_SECTIONS = SETTINGS_SECTIONS.filter((s) => s !== 'branding' && s !== 'ai');

/**
 * Save all settings to a file (a copy to keep, or to set up a second shop the same way) and load
 * them back: the file is compared with this shop first, and you pick what to take over.
 */
export function SettingsTransfer({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const can = useCan();
  const fileRef = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<Partial<AllSettings> | null>(null);
  const [picked, setPicked] = useState<SettingsSection[]>([]);

  const exportFile = () => {
    const data = {
      kind: 'shoppos-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: Object.fromEntries(
        FILE_SECTIONS.map((s) => [
          s,
          s === 'printer' ? { ...settings.printer, logo: null } : settings[s],
        ]),
      ),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shop-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const readFile = async (file: File) => {
    try {
      if (file.size > 2_000_000) throw new Error('too big');
      const data = JSON.parse(await file.text()) as {
        kind?: unknown;
        settings?: Record<string, unknown>;
      };
      if (data.kind !== 'shoppos-settings' || !data.settings) throw new Error('not settings');
      const parsed: Partial<AllSettings> = {};
      for (const s of FILE_SECTIONS) {
        const raw = data.settings[s];
        if (!raw) continue;
        const merged = s === 'printer' ? { ...(raw as object), logo: settings.printer.logo } : raw;
        const ok = SETTINGS_SCHEMAS[s].safeParse(merged);
        if (ok.success) (parsed as Record<string, unknown>)[s] = ok.data;
      }
      const changed = (Object.keys(parsed) as SettingsSection[]).filter(
        (s) => diffSettings({ [s]: settings[s] }, { [s]: parsed[s] }).length > 0,
      );
      if (!changed.length) {
        toast.info('The file has the same settings as this shop.');
        return;
      }
      setIncoming(parsed);
      setPicked(changed.filter((s) => can(SECTION_PERMISSION[s] ?? 'settings.manage')));
    } catch {
      toast.error('This is not a settings file from ShopPOS.');
    }
  };

  const apply = useMutation({
    mutationFn: () => saveSections(qc, incoming ?? {}, picked),
    onSuccess: (done) => {
      toast.success(`Took over ${done.map((s) => SECTION_LABELS[s].toLowerCase()).join(', ')}`);
      setIncoming(null);
    },
    onError: () => toast.error('Some settings could not be saved'),
  });

  const sections = incoming
    ? (Object.keys(incoming) as SettingsSection[]).filter(
        (s) => diffSettings({ [s]: settings[s] }, { [s]: incoming[s] }).length > 0,
      )
    : [];
  const rows = incoming
    ? diffSettings(
        Object.fromEntries(picked.map((s) => [s, settings[s]])),
        Object.fromEntries(picked.map((s) => [s, incoming[s]])),
      )
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings file</CardTitle>
        <CardDescription>
          Save every setting to a file, as a copy to keep or to set up another shop the same way.
          Opening a file shows what is different before anything changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportFile}>
            <Download /> Save settings to a file
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp /> Open a settings file…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void readFile(f);
            }}
          />
        </div>

        {incoming && (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Different in the file. Tick what to take over:</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {sections.map((s) => {
                const allowed = can(SECTION_PERMISSION[s] ?? 'settings.manage');
                return (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      disabled={!allowed}
                      checked={picked.includes(s)}
                      onCheckedChange={(c) =>
                        setPicked((p) => (c ? [...p, s] : p.filter((x) => x !== s)))
                      }
                    />
                    {SECTION_LABELS[s]}
                  </label>
                );
              })}
            </div>
            <DiffTable rows={rows} beforeLabel="This shop" afterLabel="File" showSection />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIncoming(null)}>
                Cancel
              </Button>
              <Button disabled={!picked.length || apply.isPending} onClick={() => apply.mutate()}>
                {apply.isPending && <Loader2 className="animate-spin" />} Take over {picked.length}{' '}
                section
                {picked.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

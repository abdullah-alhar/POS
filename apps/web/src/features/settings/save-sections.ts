import type { QueryClient } from '@tanstack/react-query';
import type { AllSettings, SettingsSection } from '@shoppos/shared';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';

/**
 * Save several settings sections (assistant changes, restoring a version, importing a file).
 * Each section is checked by the server; the ones saved are returned.
 */
export async function saveSections(
  qc: QueryClient,
  next: Partial<AllSettings>,
  sections: SettingsSection[],
): Promise<SettingsSection[]> {
  const done: SettingsSection[] = [];
  for (const section of sections) {
    const value = await api.put<AllSettings[typeof section]>(`/settings/${section}`, next[section]);
    qc.setQueryData<AllSettings>(keys.settings, (old) =>
      old ? { ...old, [section]: value } : old,
    );
    done.push(section);
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.publicSettings }),
    qc.invalidateQueries({ queryKey: keys.posIndex }),
    qc.invalidateQueries({ queryKey: ['settings-history'] }),
  ]);
  return done;
}

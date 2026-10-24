import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  applySettingChanges,
  diffSettings,
  SETTINGS_ASSISTANT_EXAMPLES,
  type AllSettings,
  type SettingChange,
  type SettingsSection,
} from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys } from '@/lib/queries';
import { AssistantChat, type AssistantTurn } from '../assistant/assistant-chat';
import { DiffTable } from './diff-table';
import { saveSections } from './save-sections';

interface Answer {
  reply: string;
  changes: SettingChange[];
  problems: string[];
  source: 'built-in' | 'ai';
  aiProblem?: string;
}

/** Changes the assistant suggests: shown side by side, saved only when approved. */
export function Proposal({ next, sections }: { next: AllSettings; sections: SettingsSection[] }) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  // Worked out once, so the table still shows what was changed after it is saved.
  const [rows] = useState(() => {
    const now = qc.getQueryData<AllSettings>(keys.settings);
    return now
      ? diffSettings(
          Object.fromEntries(sections.map((s) => [s, now[s]])),
          Object.fromEntries(sections.map((s) => [s, next[s]])),
        )
      : [];
  });
  const apply = useMutation({
    mutationFn: () => saveSections(qc, next, sections),
    onSuccess: () => {
      setDone(true);
      toast.success('Settings saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });
  if (!rows.length)
    return <p className="text-muted-foreground mt-1 text-xs">Already set like this.</p>;
  return (
    <div className="mt-2 grid gap-2">
      <DiffTable rows={rows} beforeLabel="Now" afterLabel="New" showSection />
      {done ? (
        <p className="text-success flex items-center gap-1 text-xs font-medium">
          <Check className="size-3.5" /> Saved
        </p>
      ) : (
        <Button
          size="sm"
          className="justify-self-start"
          disabled={apply.isPending}
          onClick={() => apply.mutate()}
        >
          {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save these changes
        </Button>
      )}
    </div>
  );
}

/** Ask for setting changes in plain words, e.g. "round totals to Rs 10". */
export function SettingsAssistant() {
  const qc = useQueryClient();
  const canSetUpAi = useCan()('system.manage');
  async function send(message: string): Promise<AssistantTurn> {
    const answer = await api.post<Answer>('/assistant/settings', { message });
    const now = qc.getQueryData<AllSettings>(keys.settings);
    if (!now || !answer.changes.length) {
      return {
        reply: answer.reply || 'I could not find a setting to change.',
        problems: answer.problems,
        source: answer.source,
        notice: answer.aiProblem,
      };
    }
    const result = applySettingChanges(now, answer.changes);
    const problems = [...new Set([...answer.problems, ...result.problems])];
    return {
      reply:
        answer.reply ||
        (result.sections.length
          ? 'Here is what would change. Nothing is saved until you approve it.'
          : problems.length
            ? 'I could not make that change.'
            : 'That is already how it is set.'),
      problems,
      source: answer.source,
      notice: answer.aiProblem,
      extra: result.sections.length ? (
        <Proposal next={result.next} sections={result.sections} />
      ) : undefined,
    };
  }
  return (
    <AssistantChat
      showStatus={canSetUpAi}
      intro="Tell me what to change in plain words."
      examples={SETTINGS_ASSISTANT_EXAMPLES}
      send={send}
      placeholder="e.g. round bill totals to the nearest Rs 10"
    />
  );
}

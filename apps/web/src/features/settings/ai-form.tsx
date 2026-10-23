import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Cpu,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  AI_DEFAULT_MODEL,
  aiSettingsSchema,
  type AiSettings,
  type AllSettings,
  type AssistantStatus,
} from '@shoppos/shared';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * The assistant always understands common requests by itself. For everything else it can use a
 * free AI model that runs on this computer with Ollama: no account, no fees, no internet needed,
 * and nothing about the shop leaves the laptop.
 */
export function AiForm({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const form = useForm<AiSettings>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: settings.ai,
  });
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(settings.ai);
  }, [settings.ai, form]);
  const values = useWatch({ control: form.control }) as AiSettings;

  const test = useMutation({
    mutationFn: (v: AiSettings) => api.post<AssistantStatus>('/assistant/test', v),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not test'),
  });
  const save = useMutation({
    mutationFn: (v: AiSettings) => api.put<AiSettings>('/settings/ai', v),
    onSuccess: (v) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) => (old ? { ...old, ai: v } : old));
      qc.invalidateQueries({ queryKey: ['assistant-status'] });
      form.reset(v);
      toast.success(v.enabled ? 'The local AI model is on' : 'Assistant settings saved');
    },
  });
  const status = test.data;

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="text-brand size-5" /> Free local AI
          </CardTitle>
          <CardDescription>
            The assistant in Settings and the Receipt Studio understands common requests by itself.
            Turn this on to let it handle anything else with a free AI model that runs on this
            computer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="bg-accent/50 grid gap-1.5 rounded-lg p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="text-success size-4" /> Private and safe
            </p>
            <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
              <li>
                The model runs on this computer (or another computer in the shop). No internet, no
                fees.
              </li>
              <li>
                Only the receipt design and settings are shared with it, never bills or customers.
              </li>
              <li>
                It can only pick from the same safe actions as the editor, and every answer is
                checked.
              </li>
              <li>Setting changes are shown to you first and saved only when you approve them.</li>
            </ul>
          </div>

          <div className="grid gap-1.5 text-sm">
            <p className="font-medium">Set it up once (about 10 minutes)</p>
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
              <li>
                Download and install <span className="text-foreground font-medium">Ollama</span>{' '}
                free from ollama.com.
              </li>
              <li>
                Open a Command Prompt and run{' '}
                <code className="bg-muted text-foreground rounded px-1 py-0.5">
                  ollama pull {values.model || AI_DEFAULT_MODEL}
                </code>{' '}
                (about 3.4 GB, once).
              </li>
              <li>Press Test below, turn the switch on and Save.</li>
            </ol>
            <p className="text-muted-foreground text-xs">
              {AI_DEFAULT_MODEL} is a good, fast choice for laptops with 8 GB memory. On a slow
              laptop try a smaller model such as llama3.2:3b.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-5">
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <div className="flex items-start justify-between gap-6 rounded-lg border p-3">
                  <div>
                    <Label htmlFor="ai-enabled">Use the local AI model</Label>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Off: only the built-in assistant answers (instant, always works).
                    </p>
                  </div>
                  <Switch id="ai-enabled" checked={field.value} onCheckedChange={field.onChange} />
                </div>
              )}
            />
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <FormField
                label="AI server address"
                error={form.formState.errors.url?.message}
                hint="Ollama on this computer: http://127.0.0.1:11434"
              >
                <Input {...form.register('url')} />
              </FormField>
              <FormField label="Model" error={form.formState.errors.model?.message}>
                <Input list="ai-models" {...form.register('model')} />
                <datalist id="ai-models">
                  {(status?.models ?? [AI_DEFAULT_MODEL]).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </FormField>
            </div>

            {status && (
              <div
                className={cn(
                  'flex gap-2 rounded-lg border p-3 text-sm',
                  status.modelReady
                    ? 'border-success/40 bg-success/5'
                    : 'border-warning/50 bg-warning/10',
                )}
              >
                {status.modelReady ? (
                  <CheckCircle2 className="text-success size-5 shrink-0" />
                ) : (
                  <TriangleAlert className="size-5 shrink-0 text-amber-600" />
                )}
                <div>
                  <p className="font-medium">
                    {status.modelReady
                      ? `Ready: ${status.model} answers on this computer.`
                      : status.reachable
                        ? 'Ollama is running, but the model is not downloaded.'
                        : 'Ollama is not running.'}
                  </p>
                  {status.problem && (
                    <p className="text-muted-foreground text-xs">{status.problem}</p>
                  )}
                  {status.reachable && status.models.length > 0 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Downloaded: {status.models.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
          <div className="flex justify-end gap-2 px-5">
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={form.handleSubmit((v) => test.mutate(v))}
            >
              {test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} Test
            </Button>
            <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

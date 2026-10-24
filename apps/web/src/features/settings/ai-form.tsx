import { useEffect, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  AI_DEFAULT_MODEL,
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  aiSettingsSchema,
  type AiMode,
  type AiSettings,
  type AllSettings,
  type AssistantStatus,
} from '@shoppos/shared';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAssistantStatus } from '../assistant/assistant-chat';
import { SaveBar } from './save-bar';

const MODES: { mode: AiMode; title: string; text: string; icon: typeof Cloud }[] = [
  {
    mode: 'off',
    title: 'Built-in only',
    text: 'Works offline. Understands the usual requests and questions.',
    icon: WifiOff,
  },
  {
    mode: 'online',
    title: 'Free online AI',
    text: 'Chats in any language, understands anything, voice messages. Needs internet and a free key. Recommended.',
    icon: Cloud,
  },
  {
    mode: 'local',
    title: 'AI on this computer',
    text: 'Free and offline, but needs a strong laptop (Ollama).',
    icon: Cpu,
  },
];

/**
 * Settings → Assistant. The assistants (Ask on every page, Settings and the Receipt Studio)
 * always work without internet. An AI is optional and only helps with what they do not
 * understand: a free online service (Groq, Gemini …) or a model on this computer.
 */
export function AiForm({ settings }: { settings: AllSettings }) {
  const qc = useQueryClient();
  const { data: status } = useAssistantStatus();
  const form = useForm<AiSettings>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: settings.ai,
  });
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(settings.ai);
  }, [settings.ai, form]);
  const values = useWatch({ control: form.control }) as AiSettings;
  const provider = AI_PROVIDERS[values.provider ?? 'groq'];
  const [key, setKey] = useState('');
  const [changingKey, setChangingKey] = useState(false);
  const savedKey = status?.keys[values.provider];

  const refreshStatus = (s: AssistantStatus) => {
    qc.setQueryData(['assistant-status'], s);
    void qc.invalidateQueries({ queryKey: ['assistant-abilities'] });
  };
  const test = useMutation({
    mutationFn: (v: AiSettings) =>
      api.post<AssistantStatus>('/assistant/test', { ai: v, key: key.trim() || undefined }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not test'),
  });
  const saveKey = useMutation({
    mutationFn: () => api.put<AssistantStatus>(`/assistant/keys/${values.provider}`, { key }),
    onSuccess: (s) => {
      refreshStatus(s);
      setKey('');
      setChangingKey(false);
      toast.success(`Key for ${provider.name} saved`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save the key'),
  });
  const removeKey = useMutation({
    mutationFn: () => api.delete<AssistantStatus>(`/assistant/keys/${values.provider}`),
    onSuccess: (s) => {
      refreshStatus(s);
      toast.success('Key removed');
    },
  });
  const save = useMutation({
    mutationFn: async (v: AiSettings) => {
      // A key typed but not saved yet is saved with the settings.
      if (v.mode === 'online' && key.trim()) await saveKey.mutateAsync();
      return api.put<AiSettings>('/settings/ai', v);
    },
    onSuccess: (v) => {
      qc.setQueryData<AllSettings>(keys.settings, (old) => (old ? { ...old, ai: v } : old));
      qc.invalidateQueries({ queryKey: ['assistant-status'] });
      qc.invalidateQueries({ queryKey: ['assistant-abilities'] });
      form.reset(v);
      toast.success(
        v.mode === 'off' ? 'The assistant works on its own now' : 'The AI is on for the assistant',
      );
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });
  const result = test.data;

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="text-brand size-5" /> How the assistant answers
          </CardTitle>
          <CardDescription>
            The assistant (the AI button on every page, Settings and the Receipt Studio) always
            works, also without internet. With an AI it understands any question in any language,
            follow-up questions and voice messages, and chats naturally. If the internet or the AI
            is down, it simply answers the usual questions by itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Controller
            control={form.control}
            name="mode"
            render={({ field }) => (
              <div className="grid gap-3 sm:grid-cols-3">
                {MODES.map(({ mode, title, text, icon: Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => field.onChange(mode)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
                      field.value === mode
                        ? 'border-brand bg-accent/60 ring-brand/30 ring-2'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <Icon className="text-brand mt-0.5 size-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="text-muted-foreground block text-xs">{text}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          />
        </CardContent>
      </Card>

      {values.mode === 'online' && (
        <Card>
          <CardHeader>
            <CardTitle>Choose a free online AI</CardTitle>
            <CardDescription>
              All of these have a free plan. Groq is the easiest: free, no card, and very fast.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Controller
              control={form.control}
              name="provider"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {AI_PROVIDER_IDS.map((id) => {
                    const p = AI_PROVIDERS[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          field.onChange(id);
                          form.setValue('model', '', { shouldDirty: true });
                          setKey('');
                          setChangingKey(false);
                          test.reset();
                        }}
                        className={cn(
                          'grid gap-1 rounded-lg border p-3 text-left transition-colors',
                          field.value === id
                            ? 'border-brand bg-accent/60 ring-brand/30 ring-2'
                            : 'hover:bg-muted/60',
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {p.name}
                          {id === 'groq' && <Badge variant="success">Recommended</Badge>}
                          {status?.keys[id] && <KeyRound className="text-success size-3.5" />}
                        </span>
                        <span className="text-muted-foreground text-xs leading-snug">{p.free}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            />

            <div className="bg-muted/50 grid gap-2 rounded-lg p-4 text-sm">
              <p className="font-medium">How to get the free {provider.name} key</p>
              <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
                {provider.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {provider.keyUrl && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Address:</span>
                  <code className="bg-background rounded border px-2 py-1">{provider.keyUrl}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(provider.keyUrl)
                        .then(() => toast.success('Address copied'))
                        .catch(() => toast.info(provider.keyUrl))
                    }
                  >
                    <Copy /> Copy
                  </Button>
                  <span className="text-muted-foreground">(open it on any computer or phone)</span>
                </div>
              )}
              {provider.note && (
                <p className="text-muted-foreground text-xs">
                  <span className="text-foreground font-medium">Good to know:</span> {provider.note}
                </p>
              )}
            </div>

            <FormField
              label={`${provider.name} key`}
              hint="Saved encrypted on this computer. It is never shown again."
            >
              {savedKey && !changingKey ? (
                <div className="flex items-center gap-2">
                  <span className="bg-success/10 text-success flex h-10 flex-1 items-center gap-2 rounded-md border px-3 text-sm">
                    <CheckCircle2 className="size-4" /> Key saved ({savedKey})
                  </span>
                  <Button type="button" variant="outline" onClick={() => setChangingKey(true)}>
                    Change
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove the key"
                    onClick={() => removeKey.mutate()}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Paste the key here"
                    className="flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={key.trim().length < 10 || saveKey.isPending}
                    onClick={() => saveKey.mutate()}
                  >
                    {saveKey.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Save
                    key
                  </Button>
                </div>
              )}
            </FormField>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              {values.provider === 'custom' && (
                <FormField
                  label="Address of the service"
                  error={form.formState.errors.customUrl?.message}
                  hint="Usually ends in /v1"
                >
                  <Input placeholder="https://…/v1" {...form.register('customUrl')} />
                </FormField>
              )}
              <FormField
                label="Model"
                error={form.formState.errors.model?.message}
                hint={
                  provider.defaultModel
                    ? `Empty = recommended (${provider.defaultModel}). Test lists all.`
                    : 'The model name the service gives'
                }
              >
                <Input
                  list="ai-online-models"
                  placeholder={provider.defaultModel || 'model name'}
                  {...form.register('model')}
                />
                <datalist id="ai-online-models">
                  {(result?.models ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </FormField>
            </div>
          </CardContent>
        </Card>
      )}

      {values.mode === 'local' && (
        <Card>
          <CardHeader>
            <CardTitle>AI on this computer</CardTitle>
            <CardDescription>
              Free and fully offline, but it needs a laptop with 8 GB memory or more.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
              <li>
                Download and install <span className="text-foreground font-medium">Ollama</span>{' '}
                free from ollama.com.
              </li>
              <li>
                Open a Command Prompt and run{' '}
                <code className="bg-muted text-foreground rounded px-1 py-0.5">
                  ollama pull {values.localModel || AI_DEFAULT_MODEL}
                </code>{' '}
                (about 3.4 GB, once). On a slow laptop try a smaller model such as llama3.2:3b.
              </li>
              <li>Press Test, then Save.</li>
            </ol>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <FormField
                label="Address"
                error={form.formState.errors.localUrl?.message}
                hint="Ollama on this computer: http://127.0.0.1:11434"
              >
                <Input {...form.register('localUrl')} />
              </FormField>
              <FormField label="Model" error={form.formState.errors.localModel?.message}>
                <Input list="ai-local-models" {...form.register('localModel')} />
                <datalist id="ai-local-models">
                  {(result?.models ?? [AI_DEFAULT_MODEL]).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </FormField>
            </div>
          </CardContent>
        </Card>
      )}

      {values.mode !== 'off' && result && <TestResult status={result} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="text-success size-5" /> Privacy and safety
          </CardTitle>
          <CardDescription>
            What the AI service can see, and what stays on this computer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <Controller
            control={form.control}
            name="shareResults"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-6 rounded-lg border p-3">
                <div>
                  <Label htmlFor="ai-share">Let the AI explain the answers in its own words</Label>
                  <p className="text-muted-foreground mt-1 text-xs">
                    On: the AI reads the numbers it explains (totals, item names), so it can chat
                    naturally, give advice and answer in Sinhala, Tamil or any language. Customer
                    names are replaced by codes such as [C1] and phone numbers are never sent. Off:
                    the AI only reads the question; the answer is written on this computer.
                  </p>
                </div>
                <Switch id="ai-share" checked={field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />
          <ul className="text-muted-foreground grid gap-1.5 text-xs">
            {[
              'Without internet or without AI, everything keeps working; the built-in assistant answers.',
              'Every number is worked out on this computer from the shop data, only what the person asking may see (a cashier never sees profit or cost prices).',
              'Bills, customer phone numbers, passwords and backups are never sent to the AI.',
              'The key is stored encrypted on this computer and only sent to its own service over https.',
              'The AI can only choose from the same safe actions as the screens; setting changes are shown to you before anything is saved.',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="text-success mt-px size-3.5 shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <SaveBar dirty={form.formState.isDirty || !!key.trim()} saving={save.isPending} floating>
        {values.mode !== 'off' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={form.handleSubmit((v) => test.mutate(v))}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} Test the AI
          </Button>
        )}
      </SaveBar>
    </form>
  );
}

function TestResult({ status }: { status: AssistantStatus }): ReactNode {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg border p-3 text-sm',
        status.ready ? 'border-success/40 bg-success/5' : 'border-warning/50 bg-warning/10',
      )}
    >
      {status.ready ? (
        <CheckCircle2 className="text-success size-5 shrink-0" />
      ) : (
        <TriangleAlert className="size-5 shrink-0 text-amber-600" />
      )}
      <div>
        <p className="font-medium">
          {status.ready
            ? `It works: ${status.providerName} answered with ${status.model}.`
            : 'Not working yet.'}
        </p>
        {status.problem && <p className="text-muted-foreground text-xs">{status.problem}</p>}
        {status.models.length > 0 && (
          <p className="text-muted-foreground mt-1 text-xs">
            {status.models.length} model{status.models.length === 1 ? '' : 's'} available
            {status.models.length <= 12 ? `: ${status.models.join(', ')}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

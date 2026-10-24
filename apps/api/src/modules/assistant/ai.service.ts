import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AI_PROVIDERS,
  aiEndpoint,
  type AiSettings,
  type AssistantAbilities,
  type AssistantStatus,
} from '@shoppos/shared';
import { AppException } from '../../common/app-exception';
import { SettingsService } from '../settings/settings.service';
import { AiError } from './ai-error';
import { AiKeysService } from './ai-keys.service';
import { chatJson, listModels } from './ollama';
import { chatJsonCompat, listCompatModels, transcribeCompat } from './openai-compat';

/** Online answers come in seconds; a model on a laptop CPU can take much longer. */
const ONLINE_TIMEOUT_MS = 45_000;
const LOCAL_TIMEOUT_MS = 120_000;
/** Protects the free quota (and the laptop): at most this many AI calls a minute. */
const PER_MINUTE = 30;

/**
 * The optional AI behind the assistants: a free online service or a model in the shop, as chosen
 * in Settings → Assistant. Nothing depends on it: when it is off, offline or fails, the
 * assistants answer with what they understand themselves.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AI');
  private localBusy = false;
  private recent: number[] = [];

  constructor(
    private readonly settings: SettingsService,
    private readonly keys: AiKeysService,
  ) {}

  /** Can an AI be asked now (as far as we know without going online)? */
  async available(): Promise<boolean> {
    const ai = this.settings.get('ai');
    if (ai.mode === 'off') return false;
    if (ai.mode === 'local' || ai.provider === 'custom') return true;
    return (await this.keys.get(ai.provider)) !== null;
  }

  /** Why the AI cannot be used, for the assistants' replies. */
  async unavailableReason(): Promise<string> {
    const ai = this.settings.get('ai');
    if (ai.mode === 'off')
      return 'For other requests, turn on a free AI in Settings → Assistant (everything else works without it).';
    return `Add the free key for ${AI_PROVIDERS[ai.provider].name} in Settings → Assistant to use the online AI.`;
  }

  /** The service and key that turn voice messages into text (Groq's free Whisper). */
  private async voiceService() {
    const ai = this.settings.get('ai');
    if (ai.mode !== 'online') return null;
    const id = AI_PROVIDERS[ai.provider].voiceModel ? ai.provider : 'groq';
    const model = AI_PROVIDERS[id].voiceModel;
    const key = model ? await this.keys.get(id) : null;
    return model && key ? { baseUrl: AI_PROVIDERS[id].baseUrl, model, key } : null;
  }

  /** What anyone signed in may know: is an AI on, and can it read voice messages? */
  async abilities(): Promise<AssistantAbilities> {
    return { ai: await this.available(), voice: (await this.voiceService()) !== null };
  }

  /** A voice message in any language, as text. */
  async transcribe(audio: Buffer, type: string): Promise<string> {
    const voice = await this.voiceService();
    if (!voice)
      throw new AiError('Voice messages need the free Groq key in Settings → Assistant.', 'no-key');
    this.rateLimit();
    try {
      return await transcribeCompat({
        baseUrl: voice.baseUrl,
        apiKey: voice.key,
        model: voice.model,
        audio,
        type,
        timeoutMs: ONLINE_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof AiError) this.logger.warn(`Voice failed (${err.reason}): ${err.message}`);
      throw err;
    }
  }

  /**
   * What the assistant can use now. Online services are not contacted here (so the page opens
   * at once without internet); the local model is, since it is on the shop network.
   */
  async status(): Promise<AssistantStatus> {
    const ai = this.settings.get('ai');
    const keys = await this.keys.hints();
    const base = { ...this.describe(ai, keys), voice: (await this.voiceService()) !== null };
    if (ai.mode === 'local') return this.probeLocal(ai, base);
    const ready =
      ai.mode === 'online' &&
      (ai.provider === 'custom' || (await this.keys.get(ai.provider)) !== null);
    return {
      ...base,
      ready,
      problem:
        ai.mode === 'off'
          ? 'The AI is off; the built-in assistant answers.'
          : ready
            ? null
            : `No key saved for ${AI_PROVIDERS[ai.provider].name} yet.`,
    };
  }

  /** Try the connection with settings that may not be saved yet (and optionally a new key). */
  async test(ai: AiSettings, newKey?: string): Promise<AssistantStatus> {
    const keys = await this.keys.hints();
    const base = {
      ...this.describe(ai, keys),
      voice: ai.mode === 'online' && Boolean(AI_PROVIDERS[ai.provider].voiceModel),
    };
    if (ai.mode === 'local') return this.probeLocal(ai, base);
    if (ai.mode === 'off') return { ...base, ready: false, problem: 'Choose an AI first.' };
    const key = newKey?.trim() || (await this.keys.get(ai.provider));
    if (!key && ai.provider !== 'custom') {
      return {
        ...base,
        ready: false,
        problem: `Paste the key for ${AI_PROVIDERS[ai.provider].name} first.`,
      };
    }
    const { baseUrl, model } = aiEndpoint(ai);
    try {
      const models = await listCompatModels({ baseUrl, apiKey: key, timeoutMs: 15_000 });
      // A tiny question proves the key and the model really work.
      await chatJsonCompat({
        baseUrl,
        apiKey: key,
        model,
        timeoutMs: ONLINE_TIMEOUT_MS,
        system: 'You check that the connection works.',
        user: 'Reply with {"ok": true}',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      });
      return { ...base, ready: true, reachable: true, models, problem: null };
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'The AI service could not be reached.';
      return {
        ...base,
        ready: false,
        reachable: err instanceof AiError && err.reason !== 'offline',
        problem: message,
      };
    }
  }

  /**
   * Ask the AI for a JSON answer matching `schema`. Throws AiError (with a message for the
   * owner) when the AI is off, has no key, is offline or answers badly.
   */
  async json(system: string, user: string, schema: z.ZodType): Promise<unknown> {
    const ai = this.settings.get('ai');
    if (ai.mode === 'off') throw new AiError(await this.unavailableReason(), 'off');
    this.rateLimit();
    const format = z.toJSONSchema(schema);
    try {
      if (ai.mode === 'local') {
        if (this.localBusy) {
          throw new AppException(
            HttpStatus.TOO_MANY_REQUESTS,
            'BUSY',
            'The assistant is still answering the last question. Please wait a moment.',
          );
        }
        this.localBusy = true;
        try {
          return await chatJson(ai.localUrl, {
            model: ai.localModel,
            system,
            user,
            format,
            timeoutMs: LOCAL_TIMEOUT_MS,
          });
        } finally {
          this.localBusy = false;
        }
      }
      const key = await this.keys.get(ai.provider);
      if (!key && ai.provider !== 'custom')
        throw new AiError(await this.unavailableReason(), 'no-key');
      const { baseUrl, model } = aiEndpoint(ai);
      return await chatJsonCompat({
        baseUrl,
        apiKey: key,
        model,
        system,
        user,
        schema: format,
        timeoutMs: ONLINE_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof AiError) this.logger.warn(`AI failed (${err.reason}): ${err.message}`);
      throw err;
    }
  }

  private rateLimit() {
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 60_000);
    if (this.recent.length >= PER_MINUTE) {
      throw new AiError(
        'Many questions in a short time: the AI rests for a minute. Try again soon.',
        'rate-limit',
      );
    }
    this.recent.push(now);
  }

  private describe(ai: AiSettings, keys: Record<string, string>) {
    const online = aiEndpoint(ai);
    return {
      mode: ai.mode,
      provider: ai.mode === 'local' ? 'local' : ai.provider,
      providerName: ai.mode === 'local' ? 'Ollama (this computer)' : AI_PROVIDERS[ai.provider].name,
      model: ai.mode === 'local' ? ai.localModel : online.model,
      keys,
      reachable: false,
      models: [] as string[],
    };
  }

  private async probeLocal(
    ai: AiSettings,
    base: ReturnType<AiService['describe']> & { voice: boolean },
  ): Promise<AssistantStatus> {
    try {
      const models = await listModels(ai.localUrl);
      const ready = models.some((m) => m === ai.localModel || m === `${ai.localModel}:latest`);
      return {
        ...base,
        reachable: true,
        models,
        ready,
        problem: ready
          ? null
          : `The model "${ai.localModel}" is not downloaded. Open a Command Prompt and run: ollama pull ${ai.localModel}`,
      };
    } catch (err) {
      return {
        ...base,
        ready: false,
        problem: err instanceof AiError ? err.message : 'The AI server could not be reached.',
      };
    }
  }
}

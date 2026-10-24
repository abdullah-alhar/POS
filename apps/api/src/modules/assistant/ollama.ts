import { isLocalAiUrl } from '@shoppos/shared';
import { AiError } from './ai-error';

/**
 * A small client for Ollama (https://ollama.com), which runs free, open AI models on this
 * computer. Nothing goes to the internet: the address must be this computer or the shop network
 * (checked again here, not only when the setting is saved), and redirects are refused.
 */

/** Largest answer we read (a design change is a few KB). */
const MAX_RESPONSE_BYTES = 256_000;

async function call(
  baseUrl: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  timeoutMs: number,
): Promise<unknown> {
  if (!isLocalAiUrl(baseUrl)) {
    throw new AiError('The AI server must be on this computer or the shop network.', 'not-allowed');
  }
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new AiError(
      timedOut
        ? 'The AI model took too long to answer. Try a shorter request or a smaller model.'
        : 'The AI on this computer (Ollama) is not running. Start Ollama, or choose the free online AI (Groq) in Settings → Assistant.',
      timedOut ? 'timeout' : 'offline',
    );
  }
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new AiError('The AI model answered with too much text.', 'bad-answer');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError('The AI server sent an answer that could not be read.', 'bad-answer');
  }
  if (!res.ok) {
    const error = (data as { error?: unknown }).error;
    const message = typeof error === 'string' ? error : `error ${res.status}`;
    if (res.status === 404 || /not found|pull/i.test(message)) {
      throw new AiError(`The AI model is not downloaded (${message}).`, 'no-model');
    }
    throw new AiError(`The AI server answered: ${message}`, 'bad-answer');
  }
  return data;
}

/** Models downloaded on the Ollama server, e.g. ["qwen3.5:4b"]. */
export async function listModels(baseUrl: string, timeoutMs = 3000): Promise<string[]> {
  const data = (await call(baseUrl, '/api/tags', { method: 'GET' }, timeoutMs)) as {
    models?: { name?: unknown }[];
  };
  return (data.models ?? []).map((m) => String(m.name ?? '')).filter(Boolean);
}

/**
 * Ask a model one question. `format` is a JSON schema: Ollama makes the model answer with JSON
 * that matches it (structured outputs), which small models need to stay on track.
 */
export async function chatJson(
  baseUrl: string,
  opts: { model: string; system: string; user: string; format: object; timeoutMs: number },
): Promise<unknown> {
  const data = (await call(
    baseUrl,
    '/api/chat',
    {
      method: 'POST',
      body: {
        model: opts.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        stream: false,
        format: opts.format,
        // Answer directly: thinking out loud is slow on a laptop CPU and not needed here.
        think: false,
        keep_alive: '15m',
        options: { temperature: 0, num_ctx: 8192 },
      },
    },
    opts.timeoutMs,
  )) as { message?: { content?: unknown } };
  const content = data.message?.content;
  if (typeof content !== 'string') {
    throw new AiError('The AI model gave an empty answer.', 'bad-answer');
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new AiError('The AI model did not answer in the expected form.', 'bad-answer');
  }
}

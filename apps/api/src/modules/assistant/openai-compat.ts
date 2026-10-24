import { isSafeAiApiUrl } from '@shoppos/shared';
import { AiError } from './ai-error';

/**
 * A small client for online AI services with an "OpenAI-compatible" chat API (Groq, Google
 * Gemini, OpenRouter, Mistral, Cerebras, GitHub Models …). Only https is used (plain http only to
 * a computer in the shop), redirects are refused, answers are size-limited, and the key is sent
 * only to the service it belongs to.
 */

const MAX_RESPONSE_BYTES = 512_000;

interface CallOptions {
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
}

async function call(path: string, body: unknown, opts: CallOptions): Promise<unknown> {
  if (!isSafeAiApiUrl(opts.baseUrl)) {
    throw new AiError('The AI service address is not allowed (use https).', 'not-allowed');
  }
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(opts.apiKey && { Authorization: `Bearer ${opts.apiKey}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new AiError('The online AI took too long to answer. Please try again.', 'timeout');
    }
    throw new AiError('No internet connection, or the AI service cannot be reached.', 'offline');
  }
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new AiError('The AI service answered with too much text.', 'bad-answer');
  }
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* error pages are not JSON */
  }
  if (!res.ok) {
    const raw = (data as { error?: { message?: unknown } | string } | null)?.error;
    const detail = (typeof raw === 'string' ? raw : String(raw?.message ?? '')).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new AiError(
        'The AI service did not accept the key. Check it in Settings → Assistant.',
        'bad-key',
      );
    }
    if (res.status === 429) {
      throw new AiError(
        'The free AI limit is used up for now. Try again in a minute (or tomorrow).',
        'rate-limit',
      );
    }
    if (res.status === 404) {
      throw new AiError(
        `The AI service does not know this model or address${detail ? ` (${detail})` : ''}.`,
        'no-model',
      );
    }
    if (res.status === 400) {
      throw new AiError(
        `The AI service refused the question${detail ? `: ${detail}` : '.'}`,
        'bad-answer',
      );
    }
    throw new AiError(
      `The AI service has a problem right now (error ${res.status}). Try again later.`,
      'offline',
    );
  }
  if (data === null)
    throw new AiError('The AI service sent an answer that could not be read.', 'bad-answer');
  return data;
}

/** Find the JSON object in a model's answer (some wrap it in ```json … ``` or add words). */
export function parseJsonAnswer(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new AiError('The AI did not answer in the expected form. Please ask again.', 'bad-answer');
}

/**
 * Ask a model one question and get a JSON object back. JSON mode is asked for; services that do
 * not support it are asked again without it. The schema is also given in words, and the caller
 * checks the answer anyway.
 */
export async function chatJsonCompat(
  opts: CallOptions & { model: string; system: string; user: string; schema: object },
): Promise<unknown> {
  const messages = [
    {
      role: 'system',
      content: `${opts.system}\n\nAnswer with one JSON object only (no other text), matching this JSON schema:\n${JSON.stringify(opts.schema)}`,
    },
    { role: 'user', content: opts.user },
  ];
  const body = (json: boolean) => ({
    model: opts.model,
    messages,
    max_tokens: 4096,
    stream: false,
    ...(json && { response_format: { type: 'json_object' } }),
  });
  let data: unknown;
  try {
    data = await call('/chat/completions', body(true), opts);
  } catch (err) {
    if (
      !(err instanceof AiError) ||
      err.reason !== 'bad-answer' ||
      !/response_format|json/i.test(err.message)
    )
      throw err;
    data = await call('/chat/completions', body(false), opts);
  }
  const choice = (
    data as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] }
  ).choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiError('The AI gave an empty answer. Please ask again.', 'bad-answer');
  }
  return parseJsonAnswer(content);
}

/** Models the key can use (services without a model list answer with an empty list). */
export async function listCompatModels(opts: CallOptions): Promise<string[]> {
  try {
    const data = (await call('/models', undefined, opts)) as { data?: { id?: unknown }[] };
    return (data.data ?? [])
      .map((m) => String(m.id ?? ''))
      .filter(Boolean)
      .sort();
  } catch (err) {
    if (err instanceof AiError && err.reason === 'no-model') return [];
    throw err;
  }
}

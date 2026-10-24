/**
 * Where the assistant's AI can come from. Everything works without any of them: the built-in
 * assistant answers common requests on its own, offline. An AI only helps with requests it does
 * not understand, and only chooses from the same fixed actions.
 *
 * Online services all speak the "OpenAI-compatible" chat API, so one connector serves them all.
 * Each needs a free API key, which is kept encrypted on the shop computer and never shown again.
 */

export const AI_PROVIDER_IDS = [
  'groq',
  'gemini',
  'openrouter',
  'mistral',
  'cerebras',
  'github',
  'custom',
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProvider {
  name: string;
  /** Base address of the OpenAI-compatible API ("" for custom). */
  baseUrl: string;
  /** Model used when the shop does not choose one. */
  defaultModel: string;
  /** Where to make a free key (to type on a phone or another computer). */
  keyUrl: string;
  /** How to get the key, step by step. */
  steps: string[];
  /** What the free plan gives, in a few words. */
  free: string;
  /** Anything the owner should know (privacy, limits). */
  note?: string;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys',
    steps: [
      'Open console.groq.com and sign in with Google or an email address (no card needed).',
      'Open "API Keys" and press "Create API Key".',
      'Copy the key (it starts with gsk_) and paste it below.',
    ],
    free: 'Free, no card. Very fast. Enough for a shop (about 30 questions a minute).',
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-flash-latest',
    keyUrl: 'https://aistudio.google.com/apikey',
    steps: [
      'Open aistudio.google.com and sign in with a Google account.',
      'Press "Get API key", then "Create API key".',
      'Copy the key and paste it below.',
    ],
    free: 'Free with a Google account, no card.',
    note: 'On the free plan Google may use what is sent to improve its products.',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    keyUrl: 'https://openrouter.ai/keys',
    steps: [
      'Open openrouter.ai and sign up (no card needed for free models).',
      'Open "Keys" and press "Create key".',
      'Copy the key (it starts with sk-or-) and paste it below.',
    ],
    free: 'Free models, no card. About 50 questions a day.',
    note: 'Free models change often, and some may learn from what is sent.',
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
    steps: [
      'Open console.mistral.ai and sign up; choose the free "Experiment" plan (a phone number is checked, no card).',
      'Open "API Keys" and create a key.',
      'Copy the key and paste it below.',
    ],
    free: 'Free plan after phone verification.',
  },
  cerebras: {
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'gpt-oss-120b',
    keyUrl: 'https://cloud.cerebras.ai',
    steps: [
      'Open cloud.cerebras.ai and sign up.',
      'Open "API Keys" and create a key.',
      'Copy the key and paste it below.',
    ],
    free: 'Free tier with daily limits (it may ask for a card).',
  },
  github: {
    name: 'GitHub Models',
    baseUrl: 'https://models.github.ai/inference',
    defaultModel: 'openai/gpt-4.1-mini',
    keyUrl: 'https://github.com/settings/personal-access-tokens',
    steps: [
      'Sign in to github.com (a free account is enough).',
      'Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
      'Under permissions give it "Models: read", then copy the token and paste it below.',
    ],
    free: 'Free with a GitHub account, small daily limits.',
  },
  custom: {
    name: 'Other service',
    baseUrl: '',
    defaultModel: '',
    keyUrl: '',
    steps: [
      'Any service with an "OpenAI-compatible" API works (for example LM Studio on another computer).',
      'Type its address (it usually ends in /v1) and the model name, and paste its key if it needs one.',
    ],
    free: 'Depends on the service.',
  },
};

/** Recommended free online AI. */
export const AI_DEFAULT_PROVIDER: AiProviderId = 'groq';

/** The free local model suggested for the shop laptop (Ollama, about 3.4 GB). */
export const AI_DEFAULT_MODEL = 'qwen3.5:4b';
export const AI_DEFAULT_URL = 'http://127.0.0.1:11434';

const URL_RE = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(\/[\w\-./~]*)?$/i;

/** This computer or a private network address (10.x, 172.16-31.x, 192.168.x). */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '[::1]') return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  if ([a, b, Number(ip[3]), Number(ip[4])].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Is this the address of an AI server on this computer or the shop network (no path)? Names
 * other than localhost could point anywhere, so the shop network needs the IP address.
 */
export function isLocalAiUrl(url: string): boolean {
  const m = URL_RE.exec(url.trim());
  if (!m || (m[4] && m[4] !== '/')) return false;
  if (m[3] && Number(m[3]) > 65_535) return false;
  return isLocalHost(m[2]!);
}

/**
 * The address of an "Other" OpenAI-compatible service: https anywhere, or plain http only on this
 * computer or the shop network (keys must never travel unencrypted over the internet).
 */
export function isSafeAiApiUrl(url: string): boolean {
  const m = URL_RE.exec(url.trim());
  if (!m || url.includes('..')) return false;
  if (m[3] && Number(m[3]) > 65_535) return false;
  return m[1]!.toLowerCase() === 'https' || isLocalHost(m[2]!);
}

/** The API address and model to use for an online provider. */
export function aiEndpoint(ai: { provider: AiProviderId; model: string; customUrl: string }) {
  const p = AI_PROVIDERS[ai.provider];
  return {
    baseUrl: (ai.provider === 'custom' ? ai.customUrl : p.baseUrl).replace(/\/+$/, ''),
    model: ai.model || p.defaultModel,
  };
}

/** "gsk_…9f3a": enough to recognise a saved key without showing it. */
export function keyHint(key: string): string {
  const k = key.trim();
  const prefix = /^[a-z]{2,6}[-_]/i.exec(k)?.[0] ?? '';
  return `${prefix}…${k.slice(-4)}`;
}

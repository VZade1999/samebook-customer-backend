import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { callGemini, GeminiRateLimitError } from './gemini.adapter';

// Model names are read when used (not at import time): this file loads before
// ConfigModule reads .env.local. Overridable so a model retirement is an env change.
const groqModel = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const cerebrasModel = () => process.env.CEREBRAS_MODEL || 'gpt-oss-120b';
const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/** One call may hang this long before the next provider is tried. */
const CALL_TIMEOUT_MS = 20_000;
/** A rate-limited key rests this long when the provider doesn't say how long. */
const DEFAULT_COOLDOWN_SECONDS = 30;

/** Groq / Cerebras "over budget": 429, or 413 rate_limit_exceeded (request bigger than the per-minute budget). */
export function isRateLimitError(err: any): boolean {
  if (err instanceof GeminiRateLimitError) return true;
  if (err?.status === 429 || err?.status === 413) return true;
  if (err?.error?.code === 'rate_limit_exceeded') return true;
  const msg = String(err?.message ?? '');
  return msg.includes('429') || msg.includes('rate_limit_exceeded');
}

export const isTimeoutError = (err: any) => err?.name === 'APIConnectionTimeoutError' || err?.code === 'ETIMEDOUT' || /timed? ?out/i.test(String(err?.message ?? ''));

interface ChatKeySlot {
  client: Groq | Cerebras;
  provider: 'cerebras' | 'groq';
  model: string;
  label: string; // for logs only — never the key
  cooldownUntil: number;
}
interface GeminiKeySlot {
  apiKey: string;
  label: string;
  cooldownUntil: number;
}

type Log = { warn: (msg: string, meta?: any) => void };

/**
 * The AI providers, tried in order: Gemini keys (largest free budget), then
 * Cerebras, then Groq. Each key rests after a rate limit, so one busy key
 * never blocks the others; a caller only sees an error once every configured
 * key is resting or failing.
 */
export class LlmPool {
  private readonly geminiKeys: GeminiKeySlot[];
  private readonly chatKeys: ChatKeySlot[];
  private nextGemini = 0;
  private nextChat = 0;

  constructor() {
    const keys = (v: string | undefined) =>
      (v || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    this.geminiKeys = keys(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY).map((apiKey, i) => ({ apiKey, label: `gemini#${i + 1}`, cooldownUntil: 0 }));
    const cerebras: ChatKeySlot[] = keys(process.env.CEREBRAS_API_KEYS || process.env.CEREBRAS_API_KEY).map((apiKey, i) => ({
      client: new Cerebras({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 }),
      provider: 'cerebras',
      model: cerebrasModel(),
      label: `cerebras#${i + 1}`,
      cooldownUntil: 0,
    }));
    const groq: ChatKeySlot[] = keys(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY).map((apiKey, i) => ({
      client: new Groq({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 }),
      provider: 'groq',
      model: groqModel(),
      label: `groq#${i + 1}`,
      cooldownUntil: 0,
    }));
    this.chatKeys = [...cerebras, ...groq];
  }

  /** Is any provider configured at all? */
  get ready() {
    return this.geminiKeys.length + this.chatKeys.length > 0;
  }

  async complete(params: Omit<ChatCompletionCreateParamsNonStreaming, 'model'>, log: Log): Promise<Groq.Chat.ChatCompletion> {
    if (!this.ready) throw new Error('AI_AGENT_NOT_CONFIGURED');
    let lastErr: any;

    const gTotal = this.geminiKeys.length;
    for (let attempt = 0; attempt < gTotal; attempt++) {
      const idx = (this.nextGemini + attempt) % gTotal;
      const slot = this.geminiKeys[idx];
      if (slot.cooldownUntil > Date.now()) continue;
      try {
        const result = await callGemini(slot.apiKey, geminiModel(), params.messages, (params.tools as any) ?? [], {
          maxOutputTokens: params.max_tokens ?? 1500,
          temperature: params.temperature ?? 0.3,
        });
        this.nextGemini = (idx + 1) % gTotal;
        return result;
      } catch (err: any) {
        slot.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_SECONDS * 1000;
        lastErr = err;
        log.warn(`Gemini ${slot.label} failed, trying the next provider`, { rateLimit: isRateLimitError(err), message: err?.message });
      }
    }

    const cTotal = this.chatKeys.length;
    for (let attempt = 0; attempt < cTotal; attempt++) {
      const idx = (this.nextChat + attempt) % cTotal;
      const slot = this.chatKeys[idx];
      if (slot.cooldownUntil > Date.now()) continue;
      try {
        // Both SDKs speak the OpenAI chat format; their TypeScript overloads just differ.
        const result = await (slot.client as Groq).chat.completions.create({ ...params, model: slot.model } as ChatCompletionCreateParamsNonStreaming);
        this.nextChat = (idx + 1) % cTotal;
        return result as Groq.Chat.ChatCompletion;
      } catch (err: any) {
        lastErr = err;
        if (isRateLimitError(err)) {
          const after = Number(err?.headers?.get?.('retry-after'));
          slot.cooldownUntil = Date.now() + (after > 0 ? after : DEFAULT_COOLDOWN_SECONDS) * 1000;
          log.warn(`${slot.provider} ${slot.label} rate-limited, resting`, { seconds: after > 0 ? after : DEFAULT_COOLDOWN_SECONDS });
          continue;
        }
        log.warn(`${slot.provider} ${slot.label} failed, trying the next key`, { message: err?.message });
      }
    }
    throw lastErr ?? new Error('AI_AGENT_ALL_PROVIDERS_UNAVAILABLE');
  }
}

import { DEFAULT_AI_MODEL, SETTING_DEFAULTS } from '@cms/shared';
import { prisma } from '../../db';
import type { ChatMessage } from './prompt';

export interface StreamOpts {
  model: string;
  maxTokens: number;
  signal: AbortSignal;
}
export interface ChatProvider {
  stream(messages: ChatMessage[], opts: StreamOpts): AsyncIterable<string>;
}

export const AI_TIMEOUT_MS = 30_000;
export const AI_MAX_TOKENS = 1024;

/** Groq through groq-sdk. The key is read from the server environment only. */
export class GroqProvider implements ChatProvider {
  async *stream(messages: ChatMessage[], opts: StreamOpts): AsyncIterable<string> {
    const { default: Groq } = await import('groq-sdk');
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
    const res = await client.chat.completions.create(
      { model: opts.model, messages, max_tokens: opts.maxTokens, stream: true },
      { signal: opts.signal },
    );
    for await (const part of res) {
      const text = part.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }
}

/** Tests: records every prompt and model it receives and answers with scripted chunks. */
export class FakeProvider implements ChatProvider {
  calls: { messages: ChatMessage[]; model: string }[] = [];
  chunks: string[] = ['Hello ', 'from ', 'the fake AI.'];
  fail: Error | null = null;
  /** Fail after the first chunk instead of before it. */
  failMidStream = false;
  delayMs = 0;
  chunkDelayMs = 0;
  async *stream(messages: ChatMessage[], opts: StreamOpts): AsyncIterable<string> {
    this.calls.push({ messages, model: opts.model });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail && !this.failMidStream) throw this.fail;
    for (const [i, c] of this.chunks.entries()) {
      yield c;
      if (this.chunkDelayMs) await new Promise((r) => setTimeout(r, this.chunkDelayMs));
      if (this.fail && i === 0) throw this.fail;
    }
  }
}

// ───── provider + model from Settings (cached 60 s) ─────
export interface AiSettings {
  provider: string;
  model: string;
  dailyLimit: number;
}
let cache: { at: number; value: AiSettings } | null = null;
export const invalidateAiSettings = (): void => {
  cache = null;
};
export async function aiSettings(): Promise<AiSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const rows = await prisma.setting.findMany({ where: { key: { in: ['ai_provider', 'ai_model', 'ai_daily_limit'] } } });
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const str = (k: string, d: string) => (typeof v.get(k) === 'string' && (v.get(k) as string).trim() ? (v.get(k) as string).trim() : d);
  const lim = v.get('ai_daily_limit');
  const value: AiSettings = {
    provider: str('ai_provider', SETTING_DEFAULTS.ai_provider),
    model: str('ai_model', DEFAULT_AI_MODEL),
    dailyLimit: typeof lim === 'number' && Number.isInteger(lim) && lim >= 0 ? lim : SETTING_DEFAULTS.ai_daily_limit,
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Only free providers that do not train on inputs may be added here (PRD 5.20). Groq is the one in use. */
const providers: Record<string, () => ChatProvider> = { groq: () => new GroqProvider() };
let override: ChatProvider | null = null;
/** Tests and the e2e server: replace the real provider. */
export const setProvider = (p: ChatProvider | null): void => {
  override = p;
};
/** The e2e server (never production): a slow scripted answer with math, so streaming and KaTeX can be checked without Groq. */
const e2eFake = new FakeProvider();
e2eFake.chunks = ['Here is the ', 'energy formula: $E = mc^2$.\n\n', '- Step one\n', '- Step two\n'];
e2eFake.chunkDelayMs = 400;

export function providerFor(name: string): ChatProvider {
  if (override) return override;
  if (process.env.E2E_FAKE_AI === '1' && process.env.NODE_ENV !== 'production') return e2eFake;
  const make = providers[name];
  if (!make) throw new Error(`Unsupported AI provider "${name}"`);
  return make();
}

import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';

export type AiMessageParam = Anthropic.Beta.BetaMessageParam;
export type AiContentBlock = Anthropic.Beta.BetaContentBlock;
export type AiToolDef = Anthropic.Beta.BetaTool;

export interface AiRequest {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: AiMessageParam[];
  tools: AiToolDef[];
  maxTokens: number;
}

export interface AiTurn {
  content: AiContentBlock[];
  stopReason: string | null;
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export type AiFailure = 'timeout' | 'rate_limited' | 'unavailable' | 'rejected' | 'misconfigured';

export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiFailure,
    message: string,
  ) {
    super(message);
  }
}

/** The one interface the assistant talks to; swap providers without touching tools or authorization. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(req: AiRequest): Promise<AiTurn>;
}

/** Claude through the official SDK. Timeouts and retries come from configuration. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    timeoutMs: number,
    maxRetries: number,
  ) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });
  }

  async complete(req: AiRequest): Promise<AiTurn> {
    try {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        // If a safety classifier declines, the API retries on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      return {
        content: res.content,
        stopReason: res.stop_reason,
        model: res.model,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 },
      };
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiProviderError('timeout', 'The AI service took too long to answer.');
      if (err instanceof Anthropic.RateLimitError) throw new AiProviderError('rate_limited', 'The AI service is busy. Try again shortly.');
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new AiProviderError('misconfigured', 'The AI service is not configured correctly.');
      if (err instanceof Anthropic.BadRequestError) throw new AiProviderError('rejected', 'The AI service could not process this request.');
      if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIError) throw new AiProviderError('unavailable', 'The AI service is unavailable right now.');
      throw err;
    }
  }
}

/**
 * Holds the configured provider. Tests replace it with a scripted fake; when
 * no provider is configured the assistant reports itself as off and the rest
 * of ChamaHub is unaffected.
 */
@Injectable()
export class AiProviderHolder {
  private provider: AiProvider | null;

  constructor() {
    const e = env();
    this.provider = e.AI_PROVIDER === 'anthropic' && e.ANTHROPIC_API_KEY?.trim() ? new AnthropicProvider(e.ANTHROPIC_API_KEY.trim(), e.AI_MODEL, e.AI_EFFORT, e.AI_TIMEOUT_MS, e.AI_MAX_RETRIES) : null;
  }

  get(): AiProvider | null {
    return this.provider;
  }

  /** For tests and local experiments only. */
  use(provider: AiProvider | null) {
    this.provider = provider;
  }
}

/** USD per million tokens. Unknown models are costed at the most expensive known rate so budgets stay conservative. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};

export function costMicroUsd(model: string, u: AiTurn['usage']): number {
  const p = PRICES[model] ?? PRICES['claude-fable-5-1'];
  // Cache writes cost 1.25× input.
  const usd = (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
  return Math.ceil(usd * 1_000_000);
}

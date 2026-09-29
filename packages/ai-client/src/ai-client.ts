import OpenAI from 'openai';
import {
  AiClientConfig,
  AiCompletion,
  AiProvider,
  AiUnavailableError,
  ChatMessage,
} from './types';

/**
 * LLM transport.
 *
 * This class holds no database handle, no TypeORM repository, and no HTTP
 * client aimed at BRAICE's own API. It cannot fetch a community dataset,
 * enumerate members, or call any other endpoint. It converts a prompt into
 * text and nothing more.
 *
 * That is the whole security argument for the AI surface, and it is enforced
 * by this file having no imports capable of doing otherwise — not by a
 * comment telling future maintainers not to.
 */
export class AiClient {
  private client: OpenAI | null = null;
  private clientInitError: Error | null = null;

  constructor(private readonly config: AiClientConfig) {}

  /**
   * Whether a real model is reachable.
   *
   * Callers use this to decide whether to fall back rather than to fail, so
   * an absent API key degrades the quality of an answer instead of taking the
   * feature offline.
   */
  isEnabled(): boolean {
    return Boolean(this.config.apiKey && this.config.model);
  }

  /** Human-readable reason the model is unavailable, for logs and health. */
  disabledReason(): string {
    if (!this.config.apiKey) return 'AI_API_KEY is not set';
    if (!this.config.model) return 'AI_MODEL is not set';
    return 'AI integration is not configured';
  }

  /**
   * Generate a completion.
   *
   * Throws {@link AiUnavailableError} when no provider is configured, so the
   * caller can distinguish "the model said nothing" from "there was no
   * model" and answer accordingly.
   */
  async complete(messages: ChatMessage[]): Promise<AiCompletion> {
    if (!this.isEnabled()) {
      throw new AiUnavailableError(this.disabledReason());
    }

    const completion = await this.getClient().chat.completions.create({
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      messages,
    });

    const text = completion.choices[0]?.message?.content ?? '';

    return { text, source: 'llm', model: this.config.model };
  }

  /**
   * Convenience wrapper for a single instruction plus its grounding context.
   *
   * `context` is the authorized data, already serialized by the caller. It is
   * passed as text because text is the only channel that exists.
   */
  async generate(instruction: string, context: string): Promise<AiCompletion> {
    return this.complete([
      { role: 'system', content: instruction },
      { role: 'user', content: context },
    ]);
  }

  /**
   * Lazily construct the provider SDK, caching the failure.
   *
   * A bad key throws on first use, and we do not want to retry construction
   * on every request for the life of the process.
   */
  private getClient(): OpenAI {
    if (this.client) return this.client;
    if (this.clientInitError) throw this.clientInitError;

    try {
      this.client = this.createClient();
    } catch (error) {
      this.clientInitError = error as Error;
      throw error;
    }

    return this.client;
  }

  private createClient(): OpenAI {
    if (this.config.provider === 'openai') {
      return new OpenAI({ apiKey: this.config.apiKey });
    }

    // Anthropic is a recognised provider name but has no transport here. It
    // fails loudly rather than silently falling through to a default, so a
    // half-configured deployment is visible in the logs.
    throw new AiUnavailableError(
      `AI provider "${this.config.provider}" is recognised but not implemented`,
    );
  }
}

/** Providers this build can actually construct a client for. */
export const IMPLEMENTED_PROVIDERS: readonly AiProvider[] = ['openai'];

export function isImplementedProvider(provider: AiProvider): boolean {
  return IMPLEMENTED_PROVIDERS.includes(provider);
}

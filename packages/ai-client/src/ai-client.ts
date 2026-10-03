import OpenAI from 'openai';
import {
  AiClientConfig,
  AiCompletion,
  AiProvider,
  AiUnavailableError,
  ChatMessage,
  ImplementedAiProvider,
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
   *
   * Ollama is the one provider that does not need a key: it is a daemon on our
   * own host that authenticates nothing. Requiring one here would report every
   * local deployment as disabled, so readiness is asked of the provider rather
   * than assumed from one shared rule.
   */
  isEnabled(): boolean {
    if (!this.config.model) return false;
    if (this.requiresCredential()) return Boolean(this.config.apiKey);

    return true;
  }

  /** Whether this provider authenticates requests at all. */
  private requiresCredential(): boolean {
    return this.config.provider !== 'ollama';
  }

  /** Human-readable reason the model is unavailable, for logs and health. */
  disabledReason(): string {
    if (!this.config.model) return 'model is not set';
    if (this.requiresCredential() && !this.config.apiKey) {
      return 'API key is not set';
    }
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

    return {
      text,
      source: 'llm',
      model: this.config.model,
      // The provider that actually ran. Guarded rather than cast because
      // `complete()` already refuses an unimplemented provider, so this is the
      // single point where the narrowing has to be established. Reaching null
      // here would mean a completion was reported as written by no provider,
      // which is why the guard exists rather than an assertion.
      provider: isImplementedProvider(this.config.provider)
        ? this.config.provider
        : null,
    };
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
    switch (this.config.provider) {
      case 'openai':
        return new OpenAI({
          apiKey: this.config.apiKey,
          ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
        });

      case 'nvidia':
        // NVIDIA Build hosts open-weight models behind an OpenAI-compatible
        // Chat Completions surface, so the only real difference is the host.
        // The default here is NVIDIA's; overriding it is what lets the same
        // code drive a self-hosted NIM endpoint on our own GPUs.
        return new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl ?? NVIDIA_BUILD_BASE_URL,
        });

      case 'ollama':
        // Ollama is the same open-weight model served by a daemon on our own
        // hardware instead of on NVIDIA's. That is the whole difference, and it
        // is why this is a base URL rather than a new transport.
        //
        // The placeholder key is not a credential and does not authenticate
        // anything: a local Ollama ignores whatever it is sent. The OpenAI SDK
        // nevertheless refuses to construct without a non-empty apiKey, so the
        // value below exists purely to satisfy that check. Recording this as an
        // empty string instead would look like an unset key in a stack trace
        // and send an operator hunting for a secret that does not exist.
        return new OpenAI({
          apiKey: this.config.apiKey || OLLAMA_PLACEHOLDER_API_KEY,
          baseURL: this.config.baseUrl ?? OLLAMA_BASE_URL,
        });

      // Anthropic is a recognised provider name but has no transport here. It
      // fails loudly rather than silently falling through to a default, so a
      // half-configured deployment is visible in the logs.
      default:
        throw new AiUnavailableError(
          `AI provider "${this.config.provider}" is recognised but not implemented`,
        );
    }
  }
}

/**
 * Hosted NVIDIA Build endpoint.
 *
 * Serves the open-weight catalog (gpt-oss, Nemotron, Llama, Mistral) over the
 * OpenAI Chat Completions API under the same bearer-token scheme, so the
 * existing SDK is reused rather than a second HTTP client.
 */
export const NVIDIA_BUILD_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * Local Ollama daemon.
 *
 * Ollama serves the *same* open-weight models as the hosted catalog, but on
 * hardware we control. Loopback is the default because that is where `ollama
 * serve` listens, and because a local model is the strongest privacy posture
 * available: authorized community data does not leave the host at all.
 *
 * Overridable for a daemon on another machine in the same LAN. It is still
 * deployment configuration rather than a request parameter — see the note on
 * {@link AiClientConfig.baseUrl}.
 */
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/**
 * Non-empty stand-in handed to the OpenAI SDK when talking to Ollama.
 *
 * Ollama ignores authentication locally, but the SDK throws on an empty apiKey
 * before a request is ever sent. This value exists to get past that check and
 * carries no authority whatsoever.
 */
export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama';

/**
 * Providers this build can actually construct a client for.
 *
 * The config layer validates against this list rather than keeping its own, so
 * a provider cannot be accepted by configuration and then fail at the first
 * request.
 */
export const IMPLEMENTED_PROVIDERS: readonly ImplementedAiProvider[] = [
  'openai',
  'nvidia',
  'ollama',
];

export function isImplementedProvider(
  provider: AiProvider,
): provider is ImplementedAiProvider {
  return (IMPLEMENTED_PROVIDERS as readonly AiProvider[]).includes(provider);
}

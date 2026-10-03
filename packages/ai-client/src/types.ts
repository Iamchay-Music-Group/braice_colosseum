/**
 * Types for the AI transport layer.
 *
 * Note what is absent: there is no type in this file that can express
 * "fetch this resource". The client takes a prompt and returns text. Anything
 * that reaches a model has already been through a permission check by the
 * caller, because this package has no way to obtain data on its own.
 */

/** LLM providers this transport knows how to speak to. */
export type AiProvider = 'openai' | 'anthropic' | 'nvidia' | 'ollama';

/**
 * A provider that can actually be called.
 *
 * Narrower than {@link AiProvider}: `anthropic` is a name the config layer
 * accepts and this build refuses, so it can never appear on a completion. A
 * response field typed as `AiProvider` would promise callers a value they can
 * never observe and force a cast at every assignment.
 */
export type ImplementedAiProvider = 'openai' | 'nvidia' | 'ollama';

export interface AiClientConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  temperature: number;
  /** Hard ceiling on output tokens. Analysis answers are short by design. */
  maxTokens: number;
  /**
   * Endpoint override.
   *
   * Both open-weight hosts are the OpenAI Chat Completions API behind their own
   * hostname, so pointing at either is a base URL change and nothing more.
   * Exposed here rather than hardcoded per provider so a self-hosted NIM
   * deployment, or a local Ollama daemon on another host in the LAN, is
   * configuration and not a code change.
   *
   * This must never be settable from a request. It decides where a community's
   * authorized data is sent, so it belongs to deployment configuration alone.
   */
  baseUrl?: string;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * The outcome of a single generation.
 *
 * `source` is not cosmetic. A caller that cannot distinguish a real model
 * response from a locally-composed answer will end up presenting one as the
 * other, which is exactly the dishonesty this system exists to prevent.
 *
 * `provider` and `model` name who actually wrote the text. With more than one
 * provider in the chain they are the only way an auditor can tell which model
 * produced an answer they are looking at six months later, so they are
 * reported on success and nulled on the unavailable path rather than filled in
 * with whatever was configured.
 */
export interface AiCompletion {
  text: string;
  source: 'llm' | 'unavailable';
  model: string | null;
  provider: ImplementedAiProvider | null;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/**
 * The entire surface a tool may expose to a model.
 *
 * A tool's `execute` returns a result the caller has already authorized. The
 * interface is deliberately shaped so a tool cannot return a live database
 * handle or a lazily-resolved query: the value is already in hand.
 */
export interface AiTool<TResult = unknown> {
  name: string;
  description: string;
  execute(params: Record<string, unknown>): Promise<TResult>;
}

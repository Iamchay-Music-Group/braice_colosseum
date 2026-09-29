/**
 * Types for the AI transport layer.
 *
 * Note what is absent: there is no type in this file that can express
 * "fetch this resource". The client takes a prompt and returns text. Anything
 * that reaches a model has already been through a permission check by the
 * caller, because this package has no way to obtain data on its own.
 */

/** LLM providers this transport knows how to speak to. */
export type AiProvider = 'openai' | 'anthropic';

export interface AiClientConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  temperature: number;
  /** Hard ceiling on output tokens. Analysis answers are short by design. */
  maxTokens: number;
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
 */
export interface AiCompletion {
  text: string;
  source: 'llm' | 'unavailable';
  model: string | null;
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

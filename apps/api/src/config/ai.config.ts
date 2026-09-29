/**
 * LLM configuration.
 *
 * The model is OPTIONAL. When AI_API_KEY is absent, AiService answers from the
 * authorized dataset directly and reports `source: 'deterministic'` so the
 * caller is never misled about what produced an answer. That is a deliberate
 * degradation, not a failure: permission enforcement is the product, and it is
 * entirely independent of whether a model is reachable.
 *
 * This is the same optional-dependency posture as the Solana anchoring layer
 * (see blockchain.service.ts) — present when configured, inert when not.
 */
import type { AiProvider } from '@braice/ai-client';

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** Providers the config layer will accept. */
const KNOWN_PROVIDERS: readonly AiProvider[] = ['openai', 'anthropic'];

export function loadAiConfig(
  get: (key: string) => string | undefined,
): AiConfig {
  const provider = (get('AI_PROVIDER') ?? 'openai').trim().toLowerCase();

  return {
    provider: provider as AiProvider,
    apiKey: get('AI_API_KEY') ?? '',
    model: get('AI_MODEL') ?? 'gpt-4',
    // Low by design. These answers summarise a fixed aggregate and should be
    // reproducible across runs; a higher temperature buys nothing and makes
    // the demo non-repeatable.
    temperature: parseFloat(get('AI_TEMPERATURE') ?? '0.2'),
    maxTokens: parseInt(get('AI_MAX_TOKENS') ?? '500', 10),
  };
}

/**
 * Fail fast on a provider name we do not recognise.
 *
 * An unrecognised value must not silently become a default. `AI_PROVIDER=openia`
 * is a typo, and treating it as "openai" would hide a misconfiguration until
 * someone wondered why their key was being sent somewhere unexpected.
 *
 * Note this validates the NAME only. A recognised provider with a blank key is
 * legal and simply means no model is available.
 */
export function validateAiConfig(config: AiConfig): void {
  if (!KNOWN_PROVIDERS.includes(config.provider)) {
    throw new Error(
      `AI_PROVIDER "${config.provider}" is not a known provider. ` +
        `Expected one of: ${KNOWN_PROVIDERS.join(', ')}.`,
    );
  }

  if (!Number.isFinite(config.temperature)) {
    throw new Error('AI_TEMPERATURE must be a number.');
  }

  if (config.temperature < 0 || config.temperature > 2) {
    throw new Error('AI_TEMPERATURE must be between 0 and 2.');
  }

  if (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0) {
    throw new Error('AI_MAX_TOKENS must be a positive integer.');
  }
}

/**
 * Whether a live model is configured.
 *
 * Read by AiService to choose between the model and the deterministic
 * composer, and surfaced on /api/health.
 */
export function isAiConfigured(config: AiConfig): boolean {
  return Boolean(config.apiKey && config.model);
}

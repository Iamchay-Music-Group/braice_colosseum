/**
 * LLM configuration.
 *
 * The model is OPTIONAL. When no provider in the chain has a key, AiService
 * answers from the authorized dataset directly and reports
 * `source: 'deterministic'` so the caller is never misled about what produced
 * an answer. That is a deliberate degradation, not a failure: permission
 * enforcement is the product, and it is entirely independent of whether a model
 * is reachable.
 *
 * This is the same optional-dependency posture as the Solana anchoring layer
 * (see blockchain.service.ts) — present when configured, inert when not.
 *
 * Providers form an ORDERED CHAIN (AI_PROVIDERS=openai,nvidia,ollama) and the
 * first entry that can actually be called wins, resolved once at boot.
 *
 * That boot-time resolution is not the whole story, because a key can be revoked
 * and a hosted provider can go down while the process keeps running. The chain
 * is therefore handed to an AiProviderChain, which fails over at request time
 * behind a circuit breaker: a provider that fails is skipped for a cooldown
 * window rather than retried on every request. See ai-provider-chain.ts for why
 * that shape and not per-request retry.
 *
 * An open-weight provider is on the same footing as a commercial one. Nothing
 * about the permission model changes with the model: the tool still decides,
 * and the model still only ever receives what survived. Running the model on
 * hardware we control (ollama) changes where the data goes, not who may see it.
 */
import {
  DEFAULT_FAILOVER_COOLDOWN_SECONDS,
  IMPLEMENTED_PROVIDERS,
  NVIDIA_BUILD_BASE_URL,
  OLLAMA_BASE_URL,
  isImplementedProvider,
  type AiClientConfig,
  type AiProvider,
} from '@braice/ai-client';

/** One provider's credentials and model, as configured. */
export interface AiProviderSettings {
  provider: AiProvider;
  apiKey: string;
  /** Empty string when no model is named — see {@link ProviderEnv}. */
  model: string;
  baseUrl: string | null;
}

export interface AiConfig {
  /** Every provider named, in preference order. Empty entries are dropped. */
  chain: AiProviderSettings[];
  /** The provider that will actually be used, or null when none is usable. */
  active: AiProviderSettings | null;
  temperature: number;
  maxTokens: number;
  /** How long a failed provider is skipped before being tried again. */
  failoverCooldownSeconds: number;
}

/**
 * How a provider is identified and whether it needs a credential.
 *
 * `credential: 'optional'` exists for the local daemon. Ollama authenticates
 * nothing when it is reached over loopback, so demanding a key would report
 * every self-hosted deployment as unconfigured — but the consequence of getting
 * this backwards is worse, so it is stated per provider rather than inferred.
 */
interface ProviderEnv {
  apiKey: string;
  model: string;
  /**
   * Default model, or null when the provider must be opted into explicitly.
   *
   * Null is what keeps a local model from silently taking traffic: naming
   * `ollama` in AI_PROVIDERS with no OLLAMA_MODEL set leaves it out of the
   * chain entirely, so it cannot quietly outrank a hosted provider just because
   * someone listed it.
   */
  defaultModel: string | null;
  baseUrl: string;
  credential: 'required' | 'optional';
}

/**
 * Every provider this build could construct a transport for.
 *
 * Validated against rather than hardcoded, so a provider cannot be accepted by
 * configuration and then throw on the first request. Anthropic is deliberately
 * absent from the transport list: it is a legal value for {@link AiProvider} but
 * has no transport, and naming it should skip it loudly rather than answering
 * deterministically forever.
 */
const PROVIDER_ENV: Record<AiProvider, ProviderEnv> = {
  openai: {
    apiKey: 'AI_API_KEY',
    model: 'AI_MODEL',
    defaultModel: 'gpt-4',
    baseUrl: 'AI_BASE_URL',
    credential: 'required',
  },
  nvidia: {
    apiKey: 'NVIDIA_API_KEY',
    model: 'NVIDIA_MODEL',
    // gpt-oss-20b is Apache 2.0, small enough to be fast, and served by the
    // hosted tier at no cost. A community running this on their own hardware
    // can swap the name for whatever NIM has loaded without touching code.
    defaultModel: 'openai/gpt-oss-20b',
    baseUrl: 'NVIDIA_BASE_URL',
    credential: 'required',
  },
  ollama: {
    apiKey: 'OLLAMA_API_KEY',
    model: 'OLLAMA_MODEL',
    // No default on purpose: see {@link ProviderEnv.defaultModel}. The model
    // named in .env.example is gpt-oss:20b, the same open-weight checkpoint the
    // hosted NVIDIA tier serves, so a community can compare the two answers
    // directly instead of comparing two different models.
    defaultModel: null,
    baseUrl: 'OLLAMA_BASE_URL',
    credential: 'optional',
  },
  anthropic: {
    apiKey: 'ANTHROPIC_API_KEY',
    model: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-sonnet-4-5',
    baseUrl: 'ANTHROPIC_BASE_URL',
    credential: 'required',
  },
};

/** Which providers the config layer will accept a name for. */
const KNOWN_PROVIDERS = Object.keys(PROVIDER_ENV) as AiProvider[];

/**
 * One message for an unrecognised provider name, wherever it is caught.
 *
 * Shared rather than written twice so the two call sites cannot drift into
 * saying different things about the same typo. The bad name is always included:
 * an operator staring at six env vars needs to know which one is wrong, not
 * merely that something is.
 */
function unknownProviderError(name: string): Error {
  return new Error(
    `AI_PROVIDERS contains "${name}", which is not a known provider. ` +
      `Expected one or more of: ${KNOWN_PROVIDERS.join(', ')}.`,
  );
}

/**
 * Parse the ordered provider chain.
 *
 * A single name (`AI_PROVIDER=openai`) is accepted as a one-element chain so
 * existing deployments keep working untouched.
 *
 * An unrecognised name throws HERE rather than being carried forward for
 * validateAiConfig to catch. That ordering is the whole fix: this function is
 * the first thing that indexes the provider table by name, so an unknown name
 * used to dereference undefined here and die with "Cannot read properties of
 * undefined" — a message that describes a bug rather than a typo, and that
 * arrived before the check written to explain it could ever run.
 */
function parseChain(raw: string): AiProvider[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (!KNOWN_PROVIDERS.includes(entry as AiProvider)) {
        throw unknownProviderError(entry);
      }

      return entry as AiProvider;
    });
}

export function loadAiConfig(
  get: (key: string) => string | undefined,
): AiConfig {
  // AI_PROVIDERS is the chain. AI_PROVIDER is the single-provider spelling that
  // predates it, still honoured so an existing .env does not become invalid.
  const raw =
    get('AI_PROVIDERS') ?? get('AI_PROVIDER') ?? IMPLEMENTED_PROVIDERS[0];

  const chain = parseChain(raw).map((provider): AiProviderSettings => {
    const names = PROVIDER_ENV[provider];
    const configuredModel = (get(names.model) ?? '').trim();

    return {
      provider,
      apiKey: (get(names.apiKey) ?? '').trim(),
      // An explicitly empty AI_MODEL falls back to the default rather than
      // producing a model-less entry, because that is what an operator clearing
      // the variable means. A provider with no default (ollama) simply stays
      // empty and is dropped from the chain by selectActive.
      model: configuredModel || (names.defaultModel ?? ''),
      baseUrl: (get(names.baseUrl) ?? '').trim() || null,
    };
  });

  return {
    chain,
    active: selectActive(chain),
    // Low by design. These answers summarise a fixed aggregate and should be
    // reproducible across runs; a higher temperature buys nothing and makes
    // the demo non-repeatable.
    temperature: parseFloat(get('AI_TEMPERATURE') ?? '0.2'),
    maxTokens: parseInt(get('AI_MAX_TOKENS') ?? '500', 10),
    failoverCooldownSeconds: parseCooldown(get('AI_FAILOVER_COOLDOWN_SECONDS')),
  };
}

/**
 * Failover cooldown, in seconds.
 *
 * Floored at 1 rather than trusted verbatim: a zero or negative cooldown turns
 * the breaker off and silently reinstates the per-request retry storm it exists
 * to prevent, so a typo here should not degrade the service quietly.
 */
function parseCooldown(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '', 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_FAILOVER_COOLDOWN_SECONDS;
  }

  return parsed;
}

/**
 * First provider in the chain that can actually be called.
 *
 * A provider missing what it needs is skipped, not fatal: that is what makes
 * `AI_PROVIDERS=openai,nvidia,ollama` a working configuration on a deployment
 * that has only one of the three. The skipped entries are still reported by
 * {@link describeInactiveChain} so an operator can see why a key they set is
 * not being used.
 */
function selectActive(
  chain: AiProviderSettings[],
): AiProviderSettings | null {
  for (const entry of chain) {
    if (!isImplementedProvider(entry.provider)) continue;
    if (!entry.model) continue;

    const names = PROVIDER_ENV[entry.provider];
    if (names.credential === 'required' && !entry.apiKey) continue;

    return entry;
  }

  return null;
}

/**
 * Explain, in operator terms, why no provider was selected.
 *
 * The distinction that matters in practice is "nothing is missing" versus
 * "something specific is missing" — the first is a deployment mistake worth
 * fixing before a demo, the second names the variable to set. Both are told
 * apart here, because sending an operator to look for a credential they
 * deliberately never set is the failure mode this function exists to prevent.
 */
export function describeInactiveChain(config: AiConfig): string {
  if (config.chain.length === 0) {
    return 'AI_PROVIDERS is set but names no provider';
  }

  if (config.active) {
    return 'AI integration is not configured';
  }

  const implemented = config.chain.filter((entry) =>
    isImplementedProvider(entry.provider),
  );

  // Every named provider is a name this build cannot call at all. Nothing the
  // operator sets will change that, so the message says so instead of listing
  // variables that would make no difference.
  if (implemented.length === 0) {
    const named = config.chain.map((entry) => entry.provider).join(', ');

    return (
      `AI_PROVIDERS names ${named}, and there is no transport in this build ` +
      `for any of them. Implemented: ${IMPLEMENTED_PROVIDERS.join(', ')}.`
    );
  }

  const reasons: string[] = [];

  const missingKey = implemented.filter(
    (entry) =>
      PROVIDER_ENV[entry.provider].credential === 'required' && !entry.apiKey,
  );
  if (missingKey.length > 0) {
    reasons.push(
      `no API key (set ${missingKey
        .map((entry) => PROVIDER_ENV[entry.provider].apiKey)
        .join(' or ')})`,
    );
  }

  // Only reachable for a provider with no default model, which today means the
  // local daemon. Named but nameless-model is a legitimate "not yet configured"
  // rather than a missing secret, so it is described that way.
  const missingModel = implemented.filter((entry) => !entry.model);
  if (missingModel.length > 0) {
    reasons.push(
      `no model named (set ${missingModel
        .map((entry) => PROVIDER_ENV[entry.provider].model)
        .join(' or ')} to say which model to serve)`,
    );
  }

  return `No provider in AI_PROVIDERS is ready to serve a model: ${reasons.join('; ')}.`;
}

/**
 * Fail fast on a provider name we do not recognise.
 *
 * An unrecognised value must not silently become a default. `AI_PROVIDER=openia`
 * is a typo, and treating it as "openai" would hide a misconfiguration until
 * someone wondered why their key was being sent somewhere unexpected.
 *
 * Note this validates the NAME only. A recognised provider with a blank key is
 * legal and simply means no model is available, which is the supported
 * no-model deployment.
 */
export function validateAiConfig(config: AiConfig): void {
  if (config.chain.length === 0) {
    throw new Error(
      'AI_PROVIDERS names no provider. Expected one or more of: ' +
        `${KNOWN_PROVIDERS.join(', ')}.`,
    );
  }
  for (const entry of config.chain) {
    if (!KNOWN_PROVIDERS.includes(entry.provider)) {
      throw unknownProviderError(entry.provider);
    }
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

  if (!Number.isInteger(config.failoverCooldownSeconds) ||
      config.failoverCooldownSeconds < 1) {
    throw new Error('AI_FAILOVER_COOLDOWN_SECONDS must be at least 1.');
  }

  for (const entry of config.chain) {
    const names = PROVIDER_ENV[entry.provider];

    if (!names) continue;

    // A base URL that cannot be reached is caught here rather than as a DNS
    // failure on the first AI request, which would otherwise look like the
    // provider being down rather than a typo in the deployment's environment.
    if (entry.baseUrl && !isRoutableHttpUrl(entry.baseUrl)) {
      throw new Error(
        `${names.baseUrl} must be a valid absolute URL for the ` +
          `${entry.provider} provider.`,
      );
    }
  }
}

/**
 * Whether a base URL is one we could actually send a request to.
 *
 * Parseability alone is not enough, and the gap is easy to hit by accident:
 * `localhost:11434/v1` — a missing `//` — is a *valid* URL, parsed as the
 * scheme "localhost:" with the path "11434/v1". It would pass a bare
 * `new URL()` check and then fail on the first AI request with a transport
 * error that reads like the daemon being down.
 *
 * Since the local tier's whole default is a hand-typed loopback address, that
 * typo is a likely mistake rather than a contrived one, so it is rejected here
 * with a message that names the variable.
 */
function isRoutableHttpUrl(candidate: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  // Guards the "file:///etc/passwd" and "http://" shapes, both of which parse.
  return parsed.hostname.length > 0;
}

/**
 * The endpoint a provider will be called on.
 *
 * Each open-weight host has a default of its own: NVIDIA's hosted catalog, and
 * a local Ollama daemon on loopback. Returning `undefined` means "use the SDK's
 * own default", which is correct only for a provider the SDK already knows where
 * to reach.
 */
export function resolveBaseUrl(entry: AiProviderSettings): string | undefined {
  if (entry.baseUrl) return entry.baseUrl;

  switch (entry.provider) {
    case 'nvidia':
      return NVIDIA_BUILD_BASE_URL;
    case 'ollama':
      return OLLAMA_BASE_URL;
    default:
      return undefined;
  }
}

/**
 * Turn configured provider settings into a transport config.
 *
 * Built here rather than in AiService so the whole mapping from environment to
 * transport lives in one file, and so every provider in the chain is shaped the
 * same way instead of the active one being special-cased.
 */
export function buildClientConfig(
  entry: AiProviderSettings,
  config: AiConfig,
): AiClientConfig {
  const baseUrl = resolveBaseUrl(entry);

  return {
    provider: entry.provider,
    // Passed through blank for a local daemon. The client substitutes a
    // placeholder the SDK will accept, so a missing OLLAMA_API_KEY stays a
    // missing key rather than becoming a fabricated credential in config.
    apiKey: entry.apiKey,
    model: entry.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

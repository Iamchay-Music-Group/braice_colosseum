/**
 * Ordered provider chain with a circuit breaker.
 *
 * WHY THIS EXISTS, given the chain was previously resolved once at boot:
 *
 * Resolving a provider at boot is not enough on its own. A key that was valid
 * when the process started can be revoked an hour later; a hosted provider can
 * rate-limit or go down mid-demo. Under the old config-time-only rule those
 * cases all collapse into "answer deterministically" until someone restarts
 * the service — so the failover silently stops working at exactly the moment it
 * is needed.
 *
 * WHY IT IS NOT SIMPLE PER-REQUEST RETRY:
 *
 * Trying provider A, catching, then trying provider B on every request means a
 * failing A costs every single request two round trips, and the second one
 * happens on a request that is already degrading. That is the reason the
 * original design refused to fail over at request time, and the objection was
 * sound — it just has a better answer than "never fail over".
 *
 * The answer is a circuit breaker. A provider that fails is marked unhealthy
 * and skipped entirely for a cooldown window, so the failure is paid for once
 * per window rather than once per request. A healthy chain still costs exactly
 * one round trip, and a recovered provider is picked back up on its own.
 *
 * WHAT COUNTS AS "NOT WORKING":
 *
 * Each provider holds its OWN credential, so a 401 from one says nothing about
 * the health of the next and is a genuine reason to move on. The same holds for
 * 403, 429, 5xx, and connection faults.
 *
 * A 400 does NOT. It means the request itself is malformed, so the identical
 * payload will be rejected identically by every other provider — paying three
 * more round trips to learn nothing. Those propagate straight to the caller's
 * deterministic path instead.
 */
import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { AiClient, isImplementedProvider } from './ai-client';
import {
  AiUnavailableError,
  type AiClientConfig,
  type AiCompletion,
  type ImplementedAiProvider,
} from './types';

/** Default time a failed provider is skipped before being retried. */
export const DEFAULT_FAILOVER_COOLDOWN_SECONDS = 60;

/**
 * HTTP statuses that mean "this provider is not working", independent of any
 * other provider.
 *
 * 401/403 are here because credentials are per-provider, not shared. 429 is
 * here because a rate limit that is already exhausted will stay exhausted for
 * the rest of the request.
 */
const FAILOVER_STATUSES: readonly number[] = [401, 403, 429];

/**
 * Errno values that mean the request never reached a provider.
 *
 * Checked on both the error and its `cause`, because the OpenAI SDK wraps the
 * underlying Node socket error in `cause` and leaves the top-level `code` for
 * the JSON response body — which is empty for exactly the failures we most need
 * to recognise.
 */
const CONNECTION_ERROR_CODES: readonly string[] = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
];

/** Read an HTTP status off an SDK error without depending on its class. */
function readStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function readCodes(error: unknown): string[] {
  const codes: string[] = [];
  const top = (error as { code?: unknown } | null)?.code;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;

  if (typeof top === 'string') codes.push(top);
  if (typeof cause?.code === 'string') codes.push(cause.code);

  return codes;
}

/**
 * Whether a failure means this provider is unusable and the next should be tried.
 *
 * Exported because the decision belongs to the operator as much as to this
 * file: which failures justify spending another round trip is a deployment
 * judgement, and it should be assertable in one place rather than inferred from
 * a breaker's behaviour.
 */
export function isFailoverError(error: unknown): boolean {
  // "No provider is configured" is a decision already made, not a provider
  // being unhealthy. Failing over here would just walk the chain skipping
  // everything and then blame a provider that was never called.
  if (error instanceof AiUnavailableError) return false;

  const status = readStatus(error);

  if (status !== null) {
    // 5xx and the per-provider credential/rate-limit statuses fail over.
    // Everything else — notably 400 — is a property of the request, not of the
    // provider, so the same payload would be refused just the same elsewhere.
    return status >= 500 || FAILOVER_STATUSES.includes(status);
  }

  // No status means the request never got an HTTP response.
  if (error instanceof APIConnectionTimeoutError) return true;
  if (error instanceof APIConnectionError) return true;

  const codes = readCodes(error);
  if (codes.some((code) => CONNECTION_ERROR_CODES.includes(code))) return true;

  // Last resort for a non-SDK error that carries a connection fault in its
  // message. Deliberately narrow: these phrases are the ones a timeout or a
  // refused socket reliably produces, and matching more would start treating
  // ordinary programming errors as provider outages.
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return false;

  return (
    message.includes('Connection error') ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
}

/**
 * The transport the chain drives.
 *
 * Narrower than {@link AiClient} on purpose: the chain calls two methods, and
 * depending on the interface rather than the class keeps it testable without a
 * network and leaves room for a deployment to supply a different transport
 * without reimplementing the failover logic.
 */
export interface ChainClient {
  isEnabled(): boolean;
  generate(instruction: string, context: string): Promise<AiCompletion>;
}

/** One provider's health, held by the chain. */
interface BreakerState {
  /** When this provider was last seen to fail, or null if it has not. */
  failedAt: number | null;
}

/**
 * A configured provider, narrowed to one this build can construct.
 *
 * The narrowing is stored rather than re-derived from the client on every read,
 * because {@link AiClientConfig.provider} is deliberately wider than what is
 * callable and re-deriving would mean a cast in each accessor.
 */
interface ChainEntry {
  provider: ImplementedAiProvider;
  client: ChainClient;
  model: string;
}

export interface AiProviderChainOptions {
  /**
   * How long a failed provider is skipped, in milliseconds.
   *
   * Injectable so tests can advance the clock instead of waiting, and so an
   * operator can trade recovery latency against how often a known-bad provider
   * is probed.
   */
  cooldownMs?: number;
  /** Clock, injectable for the same reason. Defaults to wall time. */
  now?: () => number;
  /**
   * Transport factory. Defaults to a real {@link AiClient}.
   *
   * Exists so the failover and classification logic — the part that actually
   * decides where a community's authorized data is sent — can be exercised
   * without reaching a provider.
   */
  createClient?: (config: AiClientConfig) => ChainClient;
}

export class AiProviderChain {
  private readonly entries: ChainEntry[] = [];
  private readonly state = new Map<string, BreakerState>();
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly createClient: (config: AiClientConfig) => ChainClient;

  /**
   * @param configs Ordered provider configurations, most preferred first.
   *
   * Entries this build has no transport for are dropped rather than rejected,
   * so an operator can leave `anthropic` in a chain without the service refusing
   * to boot over a provider that was never going to be called anyway.
   */
  constructor(
    configs: AiClientConfig[],
    options: AiProviderChainOptions = {},
  ) {
    this.cooldownMs =
      options.cooldownMs ?? DEFAULT_FAILOVER_COOLDOWN_SECONDS * 1000;
    this.now = options.now ?? Date.now;
    this.createClient =
      options.createClient ?? ((config) => new AiClient(config));

    for (const config of configs) {
      if (!isImplementedProvider(config.provider)) continue;
      this.entries.push({
        provider: config.provider,
        client: this.createClient(config),
        model: config.model,
      });
      this.state.set(config.provider, { failedAt: null });
    }
  }

  /** Whether any provider is currently eligible to be called. */
  isEnabled(): boolean {
    return this.eligible().length > 0;
  }

  /**
   * The provider a request would be sent to right now, or null.
   *
   * This is a live answer, not the boot-time one. After a failure it reports the
   * provider the next request will actually use, which is what an operator
   * reading /api/health needs to see — reporting the original choice would keep
   * claiming a provider that is deliberately being skipped.
   */
  activeProvider(): ImplementedAiProvider | null {
    return this.eligible()[0]?.provider ?? null;
  }

  /** The model that provider will be called with, or null. */
  activeModel(): string | null {
    return this.eligible()[0]?.model ?? null;
  }

  /**
   * Providers currently skipped after a failure, for health and logging.
   *
   * Only providers that were usable and then failed. A provider that was never
   * usable — a chain entry with no key, or the local tier with no model named —
   * is absent from the chain rather than failed over, and listing it here would
   * report a perfectly healthy deployment as degraded on every request.
   *
   * Exposed because a chain that quietly fell over is exactly the thing an
   * operator must be able to see — otherwise the only symptom is that answers
   * stopped looking like they came from the model the deployment is named after.
   */
  openBreakers(): ImplementedAiProvider[] {
    return this.entries
      .filter((entry) => this.isInCooldown(entry))
      .map((entry) => entry.provider);
  }

  /**
   * Generate, failing over across the chain as needed.
   *
   * Throws {@link AiUnavailableError} when no provider could be reached, so the
   * caller can tell "no model answered" from "a model answered badly".
   */
  async generate(instruction: string, context: string): Promise<AiCompletion> {
    const eligible = this.eligible();

    if (eligible.length === 0) {
      throw new AiUnavailableError(
        this.allOpenReason() ?? 'AI integration is not configured',
      );
    }

    const failures: string[] = [];

    for (const entry of eligible) {
      try {
        const completion = await entry.client.generate(instruction, context);

        // Reached on a provider that was half-open. Closing the breaker here
        // rather than at expiry is what lets a recovered provider resume
        // traffic without waiting out the rest of the cooldown.
        this.state.get(entry.provider)!.failedAt = null;

        return completion;
      } catch (error) {
        if (!isFailoverError(error)) {
          // The request is the problem, not the provider. Do not open a breaker
          // for it: doing so would penalise a healthy provider for a bug in the
          // payload we built.
          throw error;
        }

        this.state.get(entry.provider)!.failedAt = this.now();
        failures.push(`${entry.provider}: ${(error as Error).message}`);
      }
    }

    throw new AiUnavailableError(
      `Every configured AI provider failed. ${failures.join('; ')}`,
    );
  }

  /**
   * Providers that are configured, not in cooldown, and not awaiting a retry.
   *
   * Order is preserved from the operator's chain: the preference between a
   * recovered openai and an nvidia that never worked is a deployment decision
   * that was already expressed in AI_PROVIDERS.
   */
  private eligible(): ChainEntry[] {
    return this.entries.filter((entry) => this.isEligible(entry));
  }

  private isEligible(entry: ChainEntry): boolean {
    return entry.client.isEnabled() && !this.isInCooldown(entry);
  }

  /**
   * Whether a provider is currently in cooldown, having previously failed.
   *
   * Separate from {@link isEligible} so "not usable" and "was told to stand
   * down" stay distinguishable — they need different operator messages, and a
   * provider that was never configured must not be reported as one that failed.
   */
  private isInCooldown(entry: ChainEntry): boolean {
    const failedAt = this.state.get(entry.provider)?.failedAt;
    if (failedAt === null || failedAt === undefined) return false;

    // Half-open: the cooldown has elapsed, so this provider is offered traffic
    // again as a trial. It succeeds and the breaker closes, or it fails and the
    // cooldown restarts.
    return this.now() - failedAt < this.cooldownMs;
  }

  /**
   * Why nothing is eligible when the reason is not simply "no providers".
   *
   * Separated so an operator sees "every provider is in cooldown" — a genuine
   * outage worth acting on — rather than the vaguer "not configured", which
   * would point them at environment variables that are set correctly.
   */
  private allOpenReason(): string | null {
    const configured = this.entries.filter((entry) => entry.client.isEnabled());

    if (configured.length === 0) return null;
    if (this.openBreakers().length === configured.length) {
      return (
        'Every configured AI provider is in failover cooldown after a recent ' +
        'failure; retry once the cooldown expires.'
      );
    }

    return null;
  }
}

import {
  AiProviderChain,
  AiUnavailableError,
  isFailoverError,
  type AiClientConfig,
  type AiCompletion,
  type ChainClient,
  type ImplementedAiProvider,
} from '@braice/ai-client';

/**
 * The transport is injected rather than mocked at the HTTP layer.
 *
 * `openai` is a dependency of @braice/ai-client, not of this app, so it cannot
 * be imported or mocked from here — and it should not be. What is worth proving
 * is the decision logic: which failure causes a move to the next provider, and
 * how long that provider then stays out. That lives above the SDK entirely, so
 * the tests drive it with transports that fail in specific, named ways.
 */
interface FakeProvider {
  provider: ImplementedAiProvider;
  isEnabled: jest.Mock<boolean, []>;
  generate: jest.Mock<Promise<AiCompletion>, [string, string]>;
}

/** An SDK-shaped HTTP failure, as the OpenAI SDK reports one. */
function statusError(status: number, message = 'upstream failure'): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * A refused connection, shaped the way the SDK actually shapes one: the errno
 * sits on `cause`, while `code` is reserved for a JSON response body — which is
 * empty for precisely the failures that most need recognising.
 */
function connectionError(code: string): Error {
  return Object.assign(new Error('Connection error.'), {
    cause: Object.assign(new Error(`connect ${code}`), { code }),
  });
}

function completion(text = 'an answer'): AiCompletion {
  return { text, source: 'llm', model: 'test-model', provider: 'openai' };
}

describe('AiProviderChain', () => {
  let clock: number;
  let providers: FakeProvider[];

  beforeEach(() => {
    jest.clearAllMocks();
    clock = 1_000;
    providers = [];
  });

  /** Register a provider that answers successfully unless told otherwise. */
  function fake(
    provider: ImplementedAiProvider,
    behaviour: 'ok' | 'off' = 'ok',
  ): FakeProvider {
    const entry: FakeProvider = {
      provider,
      isEnabled: jest.fn().mockReturnValue(behaviour === 'ok'),
      generate: jest
        .fn()
        .mockResolvedValue({ ...completion(), provider, model: 'test-model' }),
    };

    providers.push(entry);

    return entry;
  }

  /**
   * Build a chain with a controllable clock, so cooldown behaviour is asserted
   * by advancing time rather than by waiting on a real one.
   *
   * Any provider the test did not describe is given a working transport, so a
   * test only has to spell out the behaviour it is actually about.
   */
  function build(
    names: ImplementedAiProvider[],
    cooldownMs = 60_000,
  ): AiProviderChain {
    for (const name of names) {
      if (!providers.some((entry) => entry.provider === name)) fake(name);
    }

    const byName = new Map(providers.map((entry) => [entry.provider, entry]));

    return new AiProviderChain(
      names.map((provider): AiClientConfig => ({
        provider,
        apiKey: provider === 'ollama' ? '' : 'test-key',
        model: 'test-model',
        temperature: 0.2,
        maxTokens: 100,
      })),
      {
        cooldownMs,
        now: () => clock,
        createClient: (config) =>
          byName.get(config.provider as ImplementedAiProvider) as ChainClient,
      },
    );
  }

  describe('happy path', () => {
    it('uses the first provider and reports it', async () => {
      fake('openai');
      const nvidia = fake('nvidia');
      const chain = build(['openai', 'nvidia']);

      const result = await chain.generate('instruction', 'context');

      expect(result.provider).toBe('openai');
      expect(nvidia.generate).not.toHaveBeenCalled();
    });

    it('reports no provider when the chain is empty', async () => {
      expect(new AiProviderChain([]).isEnabled()).toBe(false);
    });

    it('skips providers it has no transport for', async () => {
      // anthropic is a legal name with no implementation. It must not be
      // constructed, and must not stop the chain reaching nvidia.
      const constructed: string[] = [];
      const chain = new AiProviderChain(
        [
          {
            provider: 'anthropic',
            apiKey: 'sk-ant',
            model: 'claude',
            temperature: 0.2,
            maxTokens: 100,
          },
          {
            provider: 'nvidia',
            apiKey: 'nvapi',
            model: 'nemotron',
            temperature: 0.2,
            maxTokens: 100,
          },
        ],
        {
          createClient: (config) => {
            constructed.push(config.provider);
            return fake(config.provider as ImplementedAiProvider);
          },
        },
      );

      expect((await chain.generate('i', 'c')).provider).toBe('nvidia');
      expect(constructed).toEqual(['nvidia']);
    });

    it('never calls a provider that reports itself unavailable', async () => {
      const ollama = fake('ollama', 'off');
      const nvidia = fake('nvidia');
      const chain = build(['ollama', 'nvidia']);

      await chain.generate('i', 'c');

      expect(ollama.generate).not.toHaveBeenCalled();
      expect(nvidia.generate).toHaveBeenCalledTimes(1);
    });

    it('does not report an unconfigured provider as failed over', async () => {
      // The common deployment: a three-provider chain where only one has what it
      // needs. Reporting the other two as failed over would show a healthy
      // service as degraded on /api/health at all times.
      fake('openai', 'off');
      fake('ollama', 'off');
      const chain = build(['openai', 'nvidia', 'ollama']);

      await chain.generate('i', 'c');

      expect(chain.openBreakers()).toEqual([]);
      expect(chain.activeProvider()).toBe('nvidia');
      expect(chain.isEnabled()).toBe(true);
    });
  });

  describe('failover', () => {
    it('moves to the next provider when one returns a 5xx', async () => {
      const openai = fake('openai');
      openai.generate.mockRejectedValue(statusError(503, 'upstream unavailable'));
      fake('nvidia');
      const chain = build(['openai', 'nvidia']);

      const result = await chain.generate('i', 'c');

      expect(result.provider).toBe('nvidia');
      expect(result.text).toBe('an answer');
    });

    it.each([401, 403, 429])('moves on for a %s', async (status) => {
      // Credentials are per-provider, so a 401 from openai says nothing about
      // nvidia. This is the case that makes request-time failover worth having
      // at all: a key revoked mid-demo should not need a restart to recover.
      const openai = fake('openai');
      openai.generate.mockRejectedValue(statusError(status));
      fake('nvidia');
      const chain = build(['openai', 'nvidia']);

      expect((await chain.generate('i', 'c')).provider).toBe('nvidia');
    });

    it('moves on when the connection is refused', async () => {
      const ollama = fake('ollama');
      ollama.generate.mockRejectedValue(connectionError('ECONNREFUSED'));
      fake('nvidia');
      const chain = build(['ollama', 'nvidia']);

      expect((await chain.generate('i', 'c')).provider).toBe('nvidia');
    });

    it('moves on when the request times out', async () => {
      const nvidia = fake('nvidia');
      nvidia.generate.mockRejectedValue(new Error('Request timed out.'));
      fake('ollama');
      const chain = build(['nvidia', 'ollama']);

      expect((await chain.generate('i', 'c')).provider).toBe('ollama');
    });

    it('walks the whole chain before giving up', async () => {
      fake('openai').generate.mockRejectedValue(statusError(500));
      fake('nvidia').generate.mockRejectedValue(statusError(500));
      fake('ollama');
      const chain = build(['openai', 'nvidia', 'ollama']);

      expect((await chain.generate('i', 'c')).provider).toBe('ollama');
    });

    it('throws when every provider fails, naming each one', async () => {
      fake('openai').generate.mockRejectedValue(statusError(500, 'openai is down'));
      fake('nvidia').generate.mockRejectedValue(statusError(503, 'nvidia is down'));
      const chain = build(['openai', 'nvidia']);

      // Every failure is named rather than collapsed into "AI unavailable",
      // which would give an operator nothing to act on. Checked in one message:
      // a second call would find both breakers open and never reach a provider.
      await expect(chain.generate('i', 'c')).rejects.toThrow(
        /openai is down.*nvidia is down/s,
      );
    });

    it('does not move on for a 400', async () => {
      // A malformed request is refused identically by every provider, so paying
      // another round trip to learn that is pure latency.
      const openai = fake('openai');
      openai.generate.mockRejectedValue(statusError(400, 'unsupported parameter'));
      const nvidia = fake('nvidia');
      const chain = build(['openai', 'nvidia']);

      await expect(chain.generate('i', 'c')).rejects.toThrow(
        /unsupported parameter/,
      );
      expect(nvidia.generate).not.toHaveBeenCalled();
    });

    it('does not open a breaker for a 400', async () => {
      // Otherwise a bug in the prompt we build would take healthy providers out
      // of service for a cooldown each.
      fake('openai').generate.mockRejectedValue(statusError(400));
      const chain = build(['openai', 'nvidia']);

      await expect(chain.generate('i', 'c')).rejects.toThrow();

      expect(chain.openBreakers()).toEqual([]);
      expect(chain.activeProvider()).toBe('openai');
    });
  });

  describe('circuit breaker', () => {
    it('stops paying for a failed provider on the next request', async () => {
      // The whole justification for a breaker rather than per-request retry:
      // openai is called once across three requests, not once per request.
      const openai = fake('openai');
      openai.generate
        .mockRejectedValueOnce(statusError(503))
        .mockResolvedValue(completion());
      const nvidia = fake('nvidia');
      const chain = build(['openai', 'nvidia']);

      await chain.generate('i', 'c');
      await chain.generate('i', 'c');
      await chain.generate('i', 'c');

      expect(openai.generate).toHaveBeenCalledTimes(1);
      expect(nvidia.generate).toHaveBeenCalledTimes(3);
    });

    it('reports the provider it actually fell over to', async () => {
      // Health must describe the decision being made now, not the one made at
      // boot — otherwise the endpoint keeps advertising a dead provider.
      fake('openai').generate.mockRejectedValue(statusError(503));
      const chain = build(['openai', 'nvidia']);

      await chain.generate('i', 'c').catch(() => undefined);

      expect(chain.activeProvider()).toBe('nvidia');
      expect(chain.openBreakers()).toEqual(['openai']);
    });

    it('keeps a failed provider skipped for the length of the cooldown', async () => {
      fake('openai').generate.mockRejectedValue(statusError(503));
      const chain = build(['openai', 'nvidia'], 60_000);

      await chain.generate('i', 'c').catch(() => undefined);
      clock += 59_999;

      expect(chain.activeProvider()).toBe('nvidia');
    });

    it('offers a recovered provider a trial once the cooldown elapses', async () => {
      const openai = fake('openai');
      openai.generate.mockRejectedValueOnce(statusError(503));
      const chain = build(['openai', 'nvidia'], 60_000);

      await chain.generate('i', 'c').catch(() => undefined);
      clock += 60_000;

      expect(chain.activeProvider()).toBe('openai');
      expect((await chain.generate('i', 'c')).provider).toBe('openai');
    });

    it('closes the breaker when the trial succeeds', async () => {
      const openai = fake('openai');
      openai.generate
        .mockRejectedValueOnce(statusError(503))
        .mockResolvedValue(completion());
      const chain = build(['openai', 'nvidia'], 60_000);

      await chain.generate('i', 'c').catch(() => undefined);
      clock += 60_000;
      await chain.generate('i', 'c');

      expect(chain.openBreakers()).toEqual([]);
    });

    it('restarts the cooldown when the trial fails again', async () => {
      // Half-open is not a grace period that quietly restores trust.
      const openai = fake('openai');
      openai.generate.mockRejectedValue(statusError(503));
      const chain = build(['openai', 'nvidia'], 60_000);

      await chain.generate('i', 'c').catch(() => undefined);
      clock += 60_000;
      await chain.generate('i', 'c').catch(() => undefined);

      clock += 30_000;
      expect(openai.generate).toHaveBeenCalledTimes(2);
      expect(chain.activeProvider()).toBe('nvidia');
    });

    it('explains an all-open chain as a cooldown, not a misconfiguration', async () => {
      // "Not configured" would send an operator to check environment variables
      // that are set perfectly well.
      fake('openai').generate.mockRejectedValue(statusError(503));
      const chain = build(['openai']);

      await chain.generate('i', 'c').catch(() => undefined);

      await expect(chain.generate('i', 'c')).rejects.toThrow(/cooldown/);
    });

    it('reports nothing enabled when every provider is in cooldown', async () => {
      fake('openai').generate.mockRejectedValue(statusError(503));
      fake('nvidia').generate.mockRejectedValue(statusError(503));
      const chain = build(['openai', 'nvidia']);

      await chain.generate('i', 'c').catch(() => undefined);

      expect(chain.isEnabled()).toBe(false);
      expect(chain.activeProvider()).toBeNull();
      expect(chain.activeModel()).toBeNull();
    });
  });

  describe('isFailoverError', () => {
    it('treats a configuration problem as not a provider outage', () => {
      // "No provider configured" is a decision already made; failing over on it
      // would blame a provider that was never called.
      expect(isFailoverError(new AiUnavailableError('not configured'))).toBe(
        false,
      );
    });

    it.each([401, 403, 429, 500, 502, 503])('fails over on %s', (status) => {
      expect(isFailoverError(statusError(status))).toBe(true);
    });

    it.each([400, 404, 409, 422])('does not fail over on %s', (status) => {
      expect(isFailoverError(statusError(status))).toBe(false);
    });

    it('fails over on a refused connection', () => {
      expect(isFailoverError(connectionError('ECONNREFUSED'))).toBe(true);
      expect(isFailoverError(connectionError('ENOTFOUND'))).toBe(true);
    });

    it('does not fail over on an ordinary programming error', () => {
      // The message-sniffing fallback has to stay narrow, or a TypeError in our
      // own code starts taking healthy providers out of service.
      expect(isFailoverError(new TypeError('x is not a function'))).toBe(false);
    });
  });
});

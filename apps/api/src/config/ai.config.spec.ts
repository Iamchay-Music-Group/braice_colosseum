import {
  describeInactiveChain,
  loadAiConfig,
  resolveBaseUrl,
  validateAiConfig,
} from './ai.config';

function env(values: Record<string, string>) {
  return (key: string) => values[key];
}

describe('AI config', () => {
  describe('loadAiConfig', () => {
    it('defaults to openai when no provider is configured', () => {
      const config = loadAiConfig(env({}));

      expect(config.chain).toHaveLength(1);
      expect(config.chain[0].provider).toBe('openai');
    });

    it('normalises provider case and surrounding whitespace', () => {
      const config = loadAiConfig(env({ AI_PROVIDER: '  OpenAI  ' }));

      expect(config.chain[0].provider).toBe('openai');
    });

    it('reads an empty key as an empty string, not undefined', () => {
      // "" and undefined behave the same downstream today, but a distinction
      // that surfaces later as a confusing truthiness bug is cheaper to pin
      // down now than to debug.
      expect(loadAiConfig(env({ AI_API_KEY: '' })).chain[0].apiKey).toBe('');
    });

    it('defaults temperature to a low reproducible value', () => {
      expect(loadAiConfig(env({})).temperature).toBeCloseTo(0.2);
    });

    it('applies the configured temperature', () => {
      const config = loadAiConfig(env({ AI_TEMPERATURE: '0.7' }));

      expect(config.temperature).toBeCloseTo(0.7);
    });

    it('parses max tokens as an integer', () => {
      expect(loadAiConfig(env({ AI_MAX_TOKENS: '1024' })).maxTokens).toBe(1024);
    });
  });

  describe('provider chain', () => {
    it('parses an ordered chain from AI_PROVIDERS', () => {
      const config = loadAiConfig(env({ AI_PROVIDERS: 'openai,nvidia' }));

      expect(config.chain.map((entry) => entry.provider)).toEqual([
        'openai',
        'nvidia',
      ]);
    });

    it('tolerates whitespace and empty entries in the chain', () => {
      const config = loadAiConfig(env({ AI_PROVIDERS: ' openai , , nvidia ' }));

      expect(config.chain.map((entry) => entry.provider)).toEqual([
        'openai',
        'nvidia',
      ]);
    });

    it('preserves the order the operator wrote', () => {
      // Order is the whole mechanism: the first entry with a key wins, so
      // reversing it must change which provider is selected.
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'nvidia,openai',
          AI_API_KEY: 'sk-test',
          NVIDIA_API_KEY: 'nvapi-test',
        }),
      );

      expect(config.active?.provider).toBe('nvidia');
    });

    it('gives each provider its own key and model variables', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'openai,nvidia',
          AI_API_KEY: 'sk-test',
          AI_MODEL: 'gpt-4o',
          NVIDIA_API_KEY: 'nvapi-test',
          NVIDIA_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
        }),
      );

      const nvidia = config.chain[1];

      expect(nvidia.apiKey).toBe('nvapi-test');
      expect(nvidia.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    });

    it('defaults the nvidia model to an open-weight model on the hosted catalog', () => {
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'nvidia', NVIDIA_API_KEY: 'nvapi-test' }),
      );

      expect(config.chain[0].model).toBe('openai/gpt-oss-20b');
    });

    it('still honours AI_PROVIDER as a single-provider chain', () => {
      const config = loadAiConfig(env({ AI_PROVIDER: 'nvidia' }));

      expect(config.chain.map((entry) => entry.provider)).toEqual(['nvidia']);
    });

    it('prefers AI_PROVIDERS over the legacy AI_PROVIDER', () => {
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'nvidia', AI_PROVIDER: 'openai' }),
      );

      expect(config.chain.map((entry) => entry.provider)).toEqual(['nvidia']);
    });
  });

  describe('local ollama tier', () => {
    // The local daemon is the one provider with no credential and no default
    // model. Both are deliberate, and both have a failure mode worth pinning:
    // inventing a key or a model would put an unintended service on the path.

    it('is not selected just because it is named in the chain', () => {
      // The opt-in guard. Without this, listing ollama in a shared .env would
      // make a machine with no daemon answer from it — and, worse, make one
      // with a daemon silently take priority traffic from a paid provider.
      const config = loadAiConfig(env({ AI_PROVIDERS: 'ollama' }));

      expect(config.active).toBeNull();
    });

    it('names the model variable when it is named but unconfigured', () => {
      const reason = describeInactiveChain(
        loadAiConfig(env({ AI_PROVIDERS: 'ollama' })),
      );

      expect(reason).toMatch(/OLLAMA_MODEL/);
    });

    it('does not ask an operator for a key it does not need', () => {
      // A local Ollama authenticates nothing, so "no API key" would send
      // someone looking for a secret that has no correct value.
      const reason = describeInactiveChain(
        loadAiConfig(env({ AI_PROVIDERS: 'ollama' })),
      );

      expect(reason).not.toMatch(/OLLAMA_API_KEY/);
    });

    it('is selected from a model name alone, with no key', () => {
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'ollama', OLLAMA_MODEL: 'gpt-oss:20b' }),
      );

      expect(config.active?.provider).toBe('ollama');
      expect(config.active?.apiKey).toBe('');
    });

    it('serves the same open-weight model the hosted tier defaults to', () => {
      // Parity is the point: a community can compare the two answers directly
      // instead of comparing two different models and calling the difference
      // "the provider".
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'ollama', OLLAMA_MODEL: 'gpt-oss:20b' }),
      );

      expect(config.active?.model).toBe('gpt-oss:20b');
      expect(
        loadAiConfig(env({ AI_PROVIDERS: 'nvidia' })).chain[0].model,
      ).toBe('openai/gpt-oss-20b');
    });

    it('keeps a hosted provider ahead of the local one', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'nvidia,ollama',
          NVIDIA_API_KEY: 'nvapi-test',
          OLLAMA_MODEL: 'gpt-oss:20b',
        }),
      );

      expect(config.active?.provider).toBe('nvidia');
    });

    it('falls through to the local tier when no hosted key is set', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'openai,nvidia,ollama',
          OLLAMA_MODEL: 'gpt-oss:20b',
        }),
      );

      expect(config.active?.provider).toBe('ollama');
    });

    it('defaults to the local daemon on loopback', () => {
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'ollama', OLLAMA_MODEL: 'gpt-oss:20b' }),
      );

      expect(resolveBaseUrl(config.active!)).toBe('http://localhost:11434/v1');
    });

    it('accepts a daemon on another host', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'ollama',
          OLLAMA_MODEL: 'gpt-oss:20b',
          OLLAMA_BASE_URL: 'http://ollama.internal.lan:11434/v1',
        }),
      );

      expect(resolveBaseUrl(config.active!)).toBe(
        'http://ollama.internal.lan:11434/v1',
      );
    });

    it('rejects a malformed local base URL at boot', () => {
      expect(() =>
        validateAiConfig(
          loadAiConfig(
            env({
              AI_PROVIDERS: 'ollama',
              OLLAMA_MODEL: 'gpt-oss:20b',
              OLLAMA_BASE_URL: 'localhost:11434/v1',
            }),
          ),
        ),
      ).toThrow(/OLLAMA_BASE_URL must be a valid absolute URL/);
    });
  });

  describe('failover cooldown', () => {
    it('defaults to a minute', () => {
      expect(loadAiConfig(env({})).failoverCooldownSeconds).toBe(60);
    });

    it('reads an operator override', () => {
      expect(
        loadAiConfig(env({ AI_FAILOVER_COOLDOWN_SECONDS: '15' }))
          .failoverCooldownSeconds,
      ).toBe(15);
    });

    it('refuses a cooldown that would disable the breaker', () => {
      // Zero or negative silently reinstates the per-request retry storm the
      // breaker exists to prevent, so it is rejected rather than obeyed.
      expect(
        loadAiConfig(env({ AI_FAILOVER_COOLDOWN_SECONDS: '0' }))
          .failoverCooldownSeconds,
      ).toBe(60);
    });

    it('rejects a non-numeric cooldown', () => {
      expect(
        loadAiConfig(env({ AI_FAILOVER_COOLDOWN_SECONDS: 'soon' }))
          .failoverCooldownSeconds,
      ).toBe(60);
    });
  });

  describe('provider selection', () => {
    it('selects the first provider with a key', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'openai,nvidia',
          AI_API_KEY: 'sk-test',
          NVIDIA_API_KEY: 'nvapi-test',
        }),
      );

      expect(config.active?.provider).toBe('openai');
    });

    it('skips a provider with no key and takes the next one', () => {
      // This is the deployment the fallback exists for: an OpenAI key that was
      // never set, and an NVIDIA key that was.
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'openai,nvidia',
          NVIDIA_API_KEY: 'nvapi-test',
        }),
      );

      expect(config.active?.provider).toBe('nvidia');
    });

    it('skips a provider whose key is whitespace', () => {
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'openai,nvidia', AI_API_KEY: '   ', NVIDIA_API_KEY: 'nvapi-test' }),
      );

      expect(config.active?.provider).toBe('nvidia');
    });

    it('selects nothing when no provider in the chain has a key', () => {
      const config = loadAiConfig(env({ AI_PROVIDERS: 'openai,nvidia' }));

      expect(config.active).toBeNull();
    });

    it('never selects a provider this build has no transport for', () => {
      // Anthropic is a legal provider name but has no implementation, so
      // selecting it would mean every request silently degrading.
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' }),
      );

      expect(config.active).toBeNull();
    });

    it('skips an unimplemented provider and takes an implemented one after it', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'anthropic,nvidia',
          ANTHROPIC_API_KEY: 'sk-ant-test',
          NVIDIA_API_KEY: 'nvapi-test',
        }),
      );

      expect(config.active?.provider).toBe('nvidia');
    });
  });

  describe('validateAiConfig', () => {
    it('accepts a recognised provider with a blank key', () => {
      // A missing key is the supported no-model deployment, not an error.
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_PROVIDER: 'openai' }))),
      ).not.toThrow();
    });

    it('accepts a multi-provider chain with only one key set', () => {
      expect(() =>
        validateAiConfig(
          loadAiConfig(
            env({ AI_PROVIDERS: 'openai,nvidia', NVIDIA_API_KEY: 'nvapi-test' }),
          ),
        ),
      ).not.toThrow();
    });

    it('rejects a misspelled provider instead of defaulting it', () => {
      // `AI_PROVIDER=openia` must not silently become openai, or the operator
      // only discovers the typo when their key goes nowhere.
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_PROVIDER: 'openia' }))),
      ).toThrow(/not a known/);
    });

    it('rejects one bad name inside an otherwise valid chain', () => {
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_PROVIDERS: 'openai,nvidja' }))),
      ).toThrow(/nvidja/);
    });

    it('rejects a chain that names nothing', () => {
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_PROVIDERS: ' , ' }))),
      ).toThrow(/names no provider/);
    });

    it('rejects a non-numeric temperature', () => {
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_TEMPERATURE: 'hot' }))),
      ).toThrow(/AI_TEMPERATURE must be a number/);
    });

    it('rejects a temperature above 2', () => {
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_TEMPERATURE: '5' }))),
      ).toThrow(/between 0 and 2/);
    });

    it('rejects a negative temperature', () => {
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_TEMPERATURE: '-1' }))),
      ).toThrow(/between 0 and 2/);
    });

    it('rejects a zero max token ceiling', () => {
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_MAX_TOKENS: '0' }))),
      ).toThrow(/positive integer/);
    });

    it('rejects a base URL that is not absolute', () => {
      // Caught at boot rather than as a DNS failure on the first AI request,
      // which would otherwise read as "the provider is down".
      expect(() =>
        validateAiConfig(
          loadAiConfig(
            env({
              AI_PROVIDERS: 'nvidia',
              NVIDIA_API_KEY: 'nvapi-test',
              NVIDIA_BASE_URL: 'integrate.api.nvidia.com/v1',
            }),
          ),
        ),
      ).toThrow(/NVIDIA_BASE_URL must be a valid absolute URL/);
    });

    it('accepts a self-hosted nvidia base URL', () => {
      expect(() =>
        validateAiConfig(
          loadAiConfig(
            env({
              AI_PROVIDERS: 'nvidia',
              NVIDIA_API_KEY: 'nvapi-test',
              NVIDIA_BASE_URL: 'http://localhost:8000/v1',
            }),
          ),
        ),
      ).not.toThrow();
    });
  });

  describe('describeInactiveChain', () => {
    it('says which key to set when no provider is usable', () => {
      const reason = describeInactiveChain(
        loadAiConfig(env({ AI_PROVIDERS: 'openai,nvidia' })),
      );

      expect(reason).toMatch(/AI_API_KEY or NVIDIA_API_KEY/);
    });

    it('distinguishes a missing transport from a missing key', () => {
      // The first is a deployment mistake worth fixing before a demo; the
      // second is a supported choice. Collapsing them would send an operator
      // looking for a key they deliberately never set.
      const reason = describeInactiveChain(
        loadAiConfig(
          env({ AI_PROVIDERS: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' }),
        ),
      );

      expect(reason).toMatch(/no transport in this build/);
      expect(reason).toMatch(/Implemented: openai, nvidia/);
    });

    it('reports an empty chain', () => {
      expect(describeInactiveChain(loadAiConfig(env({ AI_PROVIDERS: ' , ' })))).toMatch(
        /names no provider/,
      );
    });
  });

  describe('resolveBaseUrl', () => {
    it('defaults nvidia to the hosted build catalog', () => {
      const config = loadAiConfig(
        env({ AI_PROVIDERS: 'nvidia', NVIDIA_API_KEY: 'nvapi-test' }),
      );

      expect(resolveBaseUrl(config.active!)).toBe(
        'https://integrate.api.nvidia.com/v1',
      );
    });

    it('prefers an explicit self-hosted override', () => {
      const config = loadAiConfig(
        env({
          AI_PROVIDERS: 'nvidia',
          NVIDIA_API_KEY: 'nvapi-test',
          NVIDIA_BASE_URL: 'http://localhost:8000/v1',
        }),
      );

      expect(resolveBaseUrl(config.active!)).toBe('http://localhost:8000/v1');
    });

    it('leaves openai on its own default endpoint', () => {
      const config = loadAiConfig(env({ AI_API_KEY: 'sk-test' }));

      expect(resolveBaseUrl(config.active!)).toBeUndefined();
    });
  });
});
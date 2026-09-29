import { loadAiConfig, validateAiConfig, isAiConfigured } from './ai.config';

function env(values: Record<string, string>) {
  return (key: string) => values[key];
}

describe('AI config', () => {
  describe('loadAiConfig', () => {
    it('defaults to openai when AI_PROVIDER is unset', () => {
      expect(loadAiConfig(env({})).provider).toBe('openai');
    });

    it('normalises provider case and surrounding whitespace', () => {
      const config = loadAiConfig(env({ AI_PROVIDER: '  OpenAI  ' }));

      expect(config.provider).toBe('openai');
    });

    it('reads an empty key as an empty string, not undefined', () => {
      // "" and undefined behave the same downstream today, but a distinction
      // that surfaces later as a confusing truthiness bug is cheaper to pin
      // down now than to debug.
      expect(loadAiConfig(env({ AI_API_KEY: '' })).apiKey).toBe('');
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

  describe('validateAiConfig', () => {
    it('accepts a recognised provider with a blank key', () => {
      // A missing key is the supported no-model deployment, not an error.
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_PROVIDER: 'openai' }))),
      ).not.toThrow();
    });

    it('rejects a misspelled provider instead of defaulting it', () => {
      // `AI_PROVIDER=openia` must not silently become openai, or the operator
      // only discovers the typo when their key goes nowhere.
      expect(() =>
        validateAiConfig(loadAiConfig(env({ AI_PROVIDER: 'openia' }))),
      ).toThrow(/not a known provider/);
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
  });

  describe('isAiConfigured', () => {
    it('is false when the key is empty', () => {
      expect(isAiConfigured(loadAiConfig(env({ AI_API_KEY: '' })))).toBe(false);
    });

    it('is false when the key is absent', () => {
      expect(isAiConfigured(loadAiConfig(env({})))).toBe(false);
    });

    it('is true when both a key and a model are present', () => {
      const config = loadAiConfig(
        env({ AI_API_KEY: 'sk-test', AI_MODEL: 'gpt-4' }),
      );

      expect(isAiConfigured(config)).toBe(true);
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SecretsProvider } from '@devdigest/shared';
import { configuredSecrets, errorText } from '../src/platform/error-text.js';
import { RunLogger } from '../src/platform/run-logger.js';
import { RunBus } from '../src/platform/sse.js';

const KEY = 'custom.shape:KEY~0123'; // a configured key no credential pattern recognizes

describe('errorText', () => {
  it('redacts a configured key of any shape, and credential shapes, within the bound', () => {
    const text = errorText(new Error(`upstream echoed ${KEY} and ghp_${'a'.repeat(36)} ${'z'.repeat(900)}`), [KEY]);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('ghp_');
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it('never throws: a throwing message getter or a non-string message yields a fixed text', () => {
    const hostile = Object.defineProperty({}, 'message', { get() { throw new Error('boom'); } });
    expect(errorText(hostile)).toBe('error whose message could not be read');
    expect(errorText({ message: 42 })).toBe('error without a message');
    expect(errorText(null)).toBe('error without a message');
  });
});

describe('configuredSecrets', () => {
  it('reads the provider and GitHub keys, skipping unreadable and too-short values', async () => {
    const values: Record<string, string> = { OPENROUTER_API_KEY: 'sk-or-v1-0123456789', OPENAI_API_KEY: 'short', GITHUB_TOKEN: KEY };
    const provider: SecretsProvider = {
      get: vi.fn(async (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') throw new Error('unreadable');
        return values[key];
      }),
    } as unknown as SecretsProvider;
    expect(await configuredSecrets(provider)).toEqual(['sk-or-v1-0123456789', KEY]);
  });
});

describe('RunLogger error lines', () => {
  it('a failed step redacts the configured keys on the stream; the keys never enter the structured log context', async () => {
    const bus = new RunBus();
    const calls: unknown[] = [];
    const base = { info: (o: unknown) => calls.push(o), warn: (o: unknown) => calls.push(o), error: (o: unknown, m?: string) => calls.push([o, m]), debug: (o: unknown) => calls.push(o) };
    const log = new RunLogger(bus, ['run-1'], base, { prId: 'pr-1' }, [KEY]).forRun('run-1', { agent: 'a' });
    await expect(log.step('Resolving provider', async () => { throw new Error(`denied for ${KEY}`); })).rejects.toThrow();
    const streamed = JSON.stringify(bus.buffer('run-1'));
    expect(streamed).toContain('Resolving provider failed');
    expect(streamed).not.toContain(KEY);
    expect(JSON.stringify(calls)).not.toContain(KEY);
  });
});

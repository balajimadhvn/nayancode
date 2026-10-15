import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './id';

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns a v4 UUID even where crypto.randomUUID is missing (plain-http pages)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) as T });
    const a = newId(), b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); expect(a).not.toBe(b);
  });
});

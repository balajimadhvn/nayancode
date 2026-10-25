import { describe, expect, it } from 'vitest';
import type { Protocol } from './format';
import { loadStore, saveStore, STORAGE_KEY, type StorageLike } from './store';

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const p1: Protocol = { title: 'One', steps: [{ text: 'Do it', minutes: 5 }] };
const p2: Protocol = { title: 'Two', steps: [{ text: 'Then this', note: 'note' }], description: 'desc' };
const note = { id: 'note-1', date: '2026-10-26', title: 'Run 1', text: 'Worked', protocol: 'One' };

describe('store', () => {
  it('saves two protocols and one notebook entry, then reloads them', () => {
    const s = fakeStorage();
    expect(saveStore({ protocols: [p1, p2], notebook: [note] }, s)).toBe(true);
    expect(s.map.has(STORAGE_KEY)).toBe(true);
    const loaded = loadStore(s);
    expect(loaded.blocked).toBe(false);
    expect(loaded.protocols).toEqual([p1, p2]);
    expect(loaded.notebook).toEqual([note]);
  });

  it('keeps working in memory when storage throws on every call', () => {
    const blocked: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const state = { protocols: [p1], notebook: [note] };
    expect(saveStore(state, blocked)).toBe(false);
    const loaded = loadStore(blocked);
    expect(loaded.blocked).toBe(true);
    expect(loaded.protocols).toEqual([p1]);
    expect(loaded.notebook).toEqual([note]);
  });

  it('returns an empty unblocked store when nothing has been saved', () => {
    const loaded = loadStore(fakeStorage());
    expect(loaded).toEqual({ protocols: [], notebook: [], blocked: false });
  });
});

import { describe, expect, it } from 'vitest';
import { formatDuration, fromJson, toJson, toMarkdown, type Protocol } from './format';

const protocol: Protocol = {
  title: 'Test protocol',
  description: 'A short description',
  note: 'Generic starting point.',
  steps: [
    { text: 'First step', minutes: 5 },
    { text: 'Second step', note: 'Keep on ice.' },
  ],
  mix: { reagents: [{ name: 'Buffer', perRxn: 2, unit: 'uL' }], finalVolume: 20, reactions: 2, overagePct: 10 },
};

describe('protocol JSON', () => {
  it('round-trips title, steps, notes and mix', () => {
    const r = fromJson(toJson(protocol));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.protocol).toEqual(protocol);
  });

  it('returns an error instead of throwing on invalid JSON', () => {
    expect(fromJson('{not json')).toEqual({ ok: false, error: 'The file is not valid JSON.' });
  });

  it('rejects a protocol without a title or without steps', () => {
    expect(fromJson(JSON.stringify({ steps: [] }))).toMatchObject({ ok: false });
    expect(fromJson(JSON.stringify({ title: 'No steps' }))).toMatchObject({ ok: false });
  });

  it('ignores unknown keys and drops malformed steps', () => {
    const r = fromJson(JSON.stringify({ title: 'Clean', steps: [{ text: 'Keep' }, { text: '' }, { bad: 1 }], extra: 42 }));
    expect(r.ok && r.protocol.title).toBe('Clean');
    expect(r.ok && r.protocol.steps).toEqual([{ text: 'Keep' }]);
    expect(r.ok && 'extra' in r.protocol).toBe(false);
  });
});

describe('toMarkdown', () => {
  it('starts with the title as a heading and numbers the steps', () => {
    const md = toMarkdown(protocol);
    expect(md.startsWith('# Test protocol')).toBe(true);
    expect(md).toContain('1. First step (5 min)');
    expect(md).toContain('2. Second step');
    expect(md).toContain('> Keep on ice.');
  });
});

describe('formatDuration', () => {
  it('formats the known values', () => {
    expect(formatDuration(3909)).toBe('1:05:09');
    expect(formatDuration(270)).toBe('4:30');
    expect(formatDuration(0)).toBe('0:00');
  });
});

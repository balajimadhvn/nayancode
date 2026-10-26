import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bridge, BridgeError } from './bridge';

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

function fake(routes: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return await routes(url, init);
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe('Bridge client', () => {
  it('sends the bearer token and parses health', async () => {
    fake(() => json({ name: 'nayancode-bridge', version: '1.0.0', tools: {}, gpus: [], cpus: 8, memoryGb: 16, platform: 'linux', runsActive: 0 }));
    const h = await new Bridge('http://127.0.0.1:8787/', 'secret').health();
    expect(h.cpus).toBe(8);
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret');
    expect(calls[0].url).toBe('http://127.0.0.1:8787/v1/health');
  });

  it('turns a 401 into BridgeError with the server message and status', async () => {
    fake(() => json({ error: 'Missing or wrong token' }, 401));
    const err = await new Bridge('http://127.0.0.1:8787', 'bad').health().catch((e) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Missing or wrong token');
  });

  it('turns a network failure into the documented message', async () => {
    fake(() => { throw new TypeError('fetch failed'); });
    const err = await new Bridge('http://127.0.0.1:8787', 't').health().catch((e) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.status).toBe(0);
    expect(err.message).toContain('Cannot reach the Bridge');
  });

  it('polls run state and passes increasing log offsets', async () => {
    let stateCalls = 0;
    fake((url) => {
      if (url.endsWith('/run')) return json({ runId: 'abc123' });
      if (url.includes('/runs/abc123/log')) {
        return url.includes('from=0') ? json({ text: 'hello ', next: 6 }) : json({ text: 'world', next: 11 });
      }
      stateCalls++;
      return json({ state: stateCalls < 2 ? 'running' : 'exited', code: 0, signal: null, startedAt: 1, endedAt: 2, tool: 'cat', args: [] });
    });
    const chunks: string[] = [];
    const result = await new Bridge('http://127.0.0.1:8787', 't').run('job1', 'cat', [], { pollMs: 100, onLog: (t) => chunks.push(t) });
    expect(result).toEqual({ code: 0, state: 'exited' });
    expect(chunks.join('')).toBe('hello world');
    const logs = calls.filter((c) => c.url.includes('/log')).map((c) => c.url);
    expect(logs[0]).toContain('from=0');
    expect(logs[1]).toContain('from=6');
  });

  it('reports upload progress and downloads raw bytes', async () => {
    fake((url, init) => url.endsWith('/reads.fastq') && init.method === 'PUT' ? json({ name: 'reads.fastq', bytes: 5 }) : new Response(new TextEncoder().encode('ACGT\n')));
    const seen: [number, number][] = [];
    const b = new Bridge('http://127.0.0.1:8787', 't');
    await b.upload('job1', 'reads.fastq', 'ACGT\n', (sent, total) => seen.push([sent, total]));
    expect(seen).toEqual([[0, 5], [5, 5]]);
    const blob = await b.download('job1', 'reads.fastq');
    expect(await blob.text()).toBe('ACGT\n');
  });

  it('cancels the run when the abort signal fires', async () => {
    fake((url) => {
      if (url.endsWith('/run')) return json({ runId: 'r1' });
      if (url.endsWith('/runs/r1') && calls.some((c) => c.init.method === 'DELETE')) return json({ killed: 'r1' });
      if (url.includes('/log')) return json({ text: '', next: 0 });
      return json({ state: 'running', code: null, signal: null, startedAt: 1, endedAt: null, tool: 'sleep', args: ['30'] });
    });
    const ac = new AbortController();
    ac.abort();
    const err = await new Bridge('http://127.0.0.1:8787', 't').run('job1', 'sleep', ['30'], { signal: ac.signal }).catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(calls.some((c) => c.url.endsWith('/runs/r1') && c.init.method === 'DELETE')).toBe(true);
  });
});

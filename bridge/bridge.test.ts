import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  startServer, parseNvidiaSmi, parseRocmSmi, parseRocminfo, parseClinfo, parseVulkanInfo,
  parseLspci, parseMacProfiler, parseWindowsVideo, mergeGpus, parseGmxVersion, pickGmxGpuMode,
  whichTool, minimalEnv,
} from './nayancode-bridge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let bridge: { port: number; token: string; url: string; close(): Promise<void> };
let root: string;
const base = () => `http://127.0.0.1:${bridge.port}`;
const auth = () => ({ Authorization: `Bearer ${bridge.token}` });

async function call(pathname: string, init: RequestInit = {}) {
  return await fetch(base() + pathname, { ...init, headers: { ...auth(), ...(init.headers as Record<string, string> | undefined) } });
}
async function jsonCall(pathname: string, init: RequestInit = {}) {
  const r = await call(pathname, init);
  return { status: r.status, body: await r.json() as any, headers: r.headers };
}
async function newJob() {
  return (await jsonCall('/v1/jobs', { method: 'POST' })).body.id as string;
}
async function pollTerminal(job: string, runId: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await jsonCall(`/v1/jobs/${job}/runs/${runId}`);
    if (r.body.state !== 'running') return r.body;
    await sleep(50);
  }
  throw new Error('run did not finish in time');
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-bridge-test-'));
  bridge = await startServer({
    port: 0, host: '127.0.0.1', root, silent: true, maxUploadMb: 1,
    origins: ['http://allowed.example'], allow: ['cat', 'sleep', 'echo', 'ls'],
  });
});
afterAll(async () => { await bridge.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('security and CORS', () => {
  it('rejects a missing or wrong token and accepts the right one', async () => {
    expect((await fetch(`${base()}/v1/health`)).status).toBe(401);
    expect((await fetch(`${base()}/v1/health`, { headers: { Authorization: 'Bearer deadbeef' } })).status).toBe(401);
    const ok = await jsonCall('/v1/health');
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('nayancode-bridge');
  });

  it('rejects a foreign Origin even with a valid token, and reflects an allowed Origin', async () => {
    const bad = await call('/v1/health', { headers: { Origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    const good = await call('/v1/health', { headers: { Origin: 'http://allowed.example' } });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe('http://allowed.example');
  });

  it('answers OPTIONS preflight without a token and allows private network access', async () => {
    const r = await fetch(`${base()}/v1/health`, {
      method: 'OPTIONS', headers: { Origin: 'http://allowed.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
    expect(r.headers.get('access-control-allow-origin')).toBe('http://allowed.example');
    expect(r.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/v1/health', headers: { Authorization: `Bearer ${bridge.token}`, Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(403);
  });

  it('accepts an explicitly allow-listed tunnel hostname', async () => {
    const tunnel = await startServer({ port: 0, root: path.join(root, 'tunnel'), silent: true, allowHosts: ['bridge.example'] });
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: tunnel.port, path: '/v1/health', headers: { Authorization: `Bearer ${tunnel.token}`, Host: 'bridge.example' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', reject); req.end();
      });
      expect(status).toBe(200);
    } finally { await tunnel.close(); }
  });
});

describe('tool and path safety', () => {
  it('only runs allow-listed tools found through PATH', async () => {
    const job = await newJob();
    for (const tool of ['bash', 'sh', 'python3', 'rm', 'node', '../../bin/ls', '/bin/ls']) {
      const r = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool, args: [] }) });
      expect([400, 403]).toContain(r.status);
    }
    const ok = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'ls', args: [] }) });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.runId).toBe('string');
  });

  it('rejects arguments that escape the job directory and accepts in-folder paths', async () => {
    const job = await newJob();
    for (const args of [['-o', '/etc/passwd'], ['../x'], ['--out=../../y'], ['sub/../../z']]) {
      const r = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'ls', args }) });
      expect(r.status).toBe(400);
    }
    for (const args of [['file.txt'], ['-n']]) {
      const r = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'ls', args }) });
      expect(r.status).toBe(200);
    }
  });
});

describe('files', () => {
  it('validates names, lists and downloads bytes, and enforces the upload cap', async () => {
    const job = await newJob();
    for (const name of ['../x', 'a/b', '.hidden', '']) {
      const r = await call(`/v1/jobs/${job}/files/${encodeURIComponent(name)}`, { method: 'PUT', body: 'hello' });
      expect(r.status).toBe(400);
    }
    const bytes = new Uint8Array(1024).map((_, i) => i % 251);
    const up = await call(`/v1/jobs/${job}/files/reads.fastq`, { method: 'PUT', body: bytes });
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ name: 'reads.fastq', bytes: 1024 });
    const list = await (await call(`/v1/jobs/${job}/files`)).json() as any[];
    expect(list).toEqual([{ name: 'reads.fastq', bytes: 1024, modified: expect.any(Number) }]);
    const down = new Uint8Array(await (await call(`/v1/jobs/${job}/files/reads.fastq`)).arrayBuffer());
    expect(down).toEqual(bytes);
    const big = await call(`/v1/jobs/${job}/files/big.bin`, { method: 'PUT', body: new Uint8Array(2 * 1024 * 1024) });
    expect(big.status).toBe(413);
  });
});

describe('runs', () => {
  it('feeds stdin, logs without a shell, and advances the log offset', async () => {
    const job = await newJob();
    const started = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'cat', args: [], stdin: 'hello' }) });
    expect(started.status).toBe(200);
    const done = await pollTerminal(job, started.body.runId);
    expect(done.state).toBe('exited');
    expect(done.code).toBe(0);
    const log = await jsonCall(`/v1/jobs/${job}/runs/${started.body.runId}/log?from=0`);
    expect(log.body.text).toBe('hello');
    expect(log.body.next).toBe(5);

    const echo = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'echo', args: ['$(whoami); rm -rf /'] }) });
    const echoed = await pollTerminal(job, echo.body.runId);
    expect(echoed.state).toBe('exited');
    const first = await jsonCall(`/v1/jobs/${job}/runs/${echo.body.runId}/log?from=0`);
    expect(first.body.text.trim()).toBe('$(whoami); rm -rf /');
    expect(first.body.next).toBeGreaterThan(0);
    const empty = await jsonCall(`/v1/jobs/${job}/runs/${echo.body.runId}/log?from=${first.body.next}`);
    expect(empty.body).toEqual({ text: '', next: first.body.next });
  });

  it('times out, kills on request, and limits concurrent runs', async () => {
    const job = await newJob();
    const long = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'sleep', args: ['30'], timeoutSec: 1 }) });
    const timed = await pollTerminal(job, long.body.runId);
    expect(timed.state).toBe('timeout');

    const killedRun = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'sleep', args: ['30'], timeoutSec: 60 }) });
    const first = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'sleep', args: ['30'], timeoutSec: 60 }) });
    const third = await jsonCall(`/v1/jobs/${job}/run`, { method: 'POST', body: JSON.stringify({ tool: 'sleep', args: ['30'], timeoutSec: 60 }) });
    expect(first.status).toBe(200);
    expect(third.status).toBe(429);
    const del = await call(`/v1/jobs/${job}/runs/${killedRun.body.runId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await pollTerminal(job, killedRun.body.runId)).state).toBe('killed');
    await call(`/v1/jobs/${job}/runs/${first.body.runId}`, { method: 'DELETE' });
  });

  it('deletes a job folder and creates the root with mode 0700', async () => {
    const job = await newJob();
    expect(fs.existsSync(path.join(root, job))).toBe(true);
    expect((await call(`/v1/jobs/${job}`, { method: 'DELETE' })).status).toBe(200);
    expect(fs.existsSync(path.join(root, job))).toBe(false);
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
  });

  it.skipIf(!whichTool('gmx'))('reports a real GROMACS installation when it is allow-listed', async () => {
    const test = await startServer({ port: 0, root: path.join(root, 'gmx'), silent: true, allow: ['gmx'] });
    try {
      const r = await fetch(`http://127.0.0.1:${test.port}/v1/health`, { headers: { Authorization: `Bearer ${test.token}` } });
      const h = await r.json() as any;
      expect(h.tools.gmx.version).toContain('GROMACS');
      const run = await fetch(`http://127.0.0.1:${test.port}/v1/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${test.token}` } });
      const { id } = await run.json() as any;
      const started = await fetch(`http://127.0.0.1:${test.port}/v1/jobs/${id}/run`, { method: 'POST', headers: { Authorization: `Bearer ${test.token}` }, body: JSON.stringify({ tool: 'gmx', args: ['--version'] }) });
      const j = await started.json() as any;
      const end = Date.now() + 15_000;
      let state = 'running';
      while (Date.now() < end && state === 'running') {
        const s = await fetch(`http://127.0.0.1:${test.port}/v1/jobs/${id}/runs/${j.runId}`, { headers: { Authorization: `Bearer ${test.token}` } });
        state = (await s.json() as any).state;
        if (state === 'running') await sleep(100);
      }
      expect(state).toBe('exited');
    } finally { await test.close(); }
  });
});

describe('hardware parsers', () => {
  it('reads NVIDIA, AMD and Intel devices and their memory', () => {
    const nv = parseNvidiaSmi(fixture('nvidia-smi.csv'));
    expect(nv[0]).toMatchObject({ name: 'NVIDIA GeForce RTX 3060', vendor: 'nvidia', memoryMb: 12288, driver: '550.54' });
    expect(parseRocmSmi(fixture('rocm-smi.json'))[0]).toMatchObject({ name: 'Radeon RX 7900 XTX', vendor: 'amd', memoryMb: 24560 });
    expect(parseRocminfo(fixture('rocminfo.txt'))[0].name).toBe('AMD Radeon RX 7900 XTX');
    const cl = parseClinfo(fixture('clinfo.txt'));
    expect(cl).toHaveLength(2);
    expect(cl[0]).toMatchObject({ name: 'Intel(R) Arc(TM) A770 Graphics', vendor: 'intel', memoryMb: 16368 });
    expect(cl[1]).toMatchObject({ vendor: 'amd', memoryMb: 24560 });
    const arc = parseVulkanInfo(fixture('vulkan-intel-arc.txt'))[0];
    expect(arc).toMatchObject({ name: 'Intel(R) Arc(TM) A770 Graphics', vendor: 'intel', kind: 'discrete' });
    const uhd = parseVulkanInfo(fixture('vulkan-intel-uhd.txt'))[0];
    expect(uhd).toMatchObject({ vendor: 'intel', kind: 'integrated' });
    const lspci = parseLspci(fixture('lspci.txt'));
    expect(lspci.map((g: any) => g.vendor)).toEqual(['intel', 'nvidia', 'amd']);
  });

  it('reads Apple and Windows reports, and merges a laptop with two GPUs', () => {
    expect(parseMacProfiler(fixture('apple-system-profiler.txt'))[0]).toMatchObject({ name: 'Apple M2 Pro', vendor: 'apple', kind: 'integrated', driver: 'Metal 3' });
    const win = parseWindowsVideo(fixture('windows-video.json'));
    expect(win[0]).toMatchObject({ name: 'NVIDIA GeForce GTX 1650', vendor: 'nvidia', kind: 'discrete', memoryMb: 4096 });
    expect(win[1]).toMatchObject({ name: 'AMD Radeon(TM) Graphics', vendor: 'amd', kind: 'integrated' });
    const merged = mergeGpus([parseNvidiaSmi(fixture('nvidia-smi.csv')), parseVulkanInfo(fixture('vulkan-intel-uhd.txt'))]);
    expect(merged).toHaveLength(2);
  });

  it('parses five GROMACS builds and recommends only matching offload', () => {
    const cuda = parseGmxVersion(fixture('gmx-cuda-version.txt'));
    expect(cuda).toMatchObject({ version: '2024.1', precision: 'mixed', gpu: 'CUDA', simd: 'AVX2_256', threading: 'thread_mpi' });
    expect(parseGmxVersion(fixture('gmx-opencl-version.txt')).gpu).toBe('OpenCL');
    expect(parseGmxVersion(fixture('gmx-sycl-version.txt')).gpu).toBe('SYCL');
    expect(parseGmxVersion(fixture('gmx-hip-version.txt')).gpu).toBe('HIP');
    expect(parseGmxVersion(fixture('gmx-disabled-version.txt')).gpu).toBe('disabled');

    const nv = [{ vendor: 'nvidia', name: 'RTX' }], amd = [{ vendor: 'amd', name: 'RX' }];
    const intel = [{ vendor: 'intel', name: 'Arc' }], apple = [{ vendor: 'apple', name: 'M2' }];
    expect(pickGmxGpuMode(nv, cuda)).toMatchObject({ mode: 'gpu', flags: ['-nb', 'gpu', '-pme', 'gpu', '-bonded', 'gpu'] });
    expect(pickGmxGpuMode(amd, { gpu: 'HIP' })).toMatchObject({ mode: 'gpu', flags: ['-nb', 'gpu', '-pme', 'gpu'] });
    expect(pickGmxGpuMode(intel, { gpu: 'SYCL' }).note).toContain('nonbonded');
    expect(pickGmxGpuMode(intel, { gpu: 'OpenCL' }).note).toContain('slower');
    expect(pickGmxGpuMode(apple, cuda)).toMatchObject({ mode: 'cpu', note: expect.stringContaining('Apple Silicon') });
    const mismatch = pickGmxGpuMode(amd, cuda);
    expect(mismatch.mode).toBe('cpu');
    expect(mismatch.howToGetGpu).toContain('HIP');
    expect(pickGmxGpuMode([], { gpu: 'HIP' }).mode).toBe('cpu');
    expect(pickGmxGpuMode(nv, { gpu: 'disabled' }).mode).toBe('cpu');
    expect(pickGmxGpuMode([], { gpu: 'unknown' }).mode).toBe('cpu');

    const vendors = { nvidia: nv, amd, intel, apple, none: [] } as const;
    const expected: Record<string, string[]> = {
      CUDA: ['nvidia'], HIP: ['amd'], SYCL: ['nvidia', 'amd', 'intel'], OpenCL: ['amd', 'intel'], disabled: [], unknown: [],
    };
    for (const [gpu, gpuVendors] of Object.entries(expected)) {
      for (const [vendor, devices] of Object.entries(vendors)) {
        expect(pickGmxGpuMode(devices, { gpu }).mode, `${gpu} build with ${vendor}`).toBe(gpuVendors.includes(vendor) ? 'gpu' : 'cpu');
      }
    }
  });

  it('keeps only the documented environment variables for child processes', () => {
    expect(minimalEnv({ PATH: '/bin', HOME: '/home/x', SECRET: 'no', LANG: 'C' })).toEqual({ PATH: '/bin', HOME: '/home/x', LANG: 'C' });
  });
});

import { create } from 'zustand';

/** One device that the Bridge found through a vendor tool. */
export interface BridgeGpu {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';
  kind: 'discrete' | 'integrated' | 'unknown';
  memoryMb: number | null;
  driver: string | null;
  backends: string[];
}

export interface GmxBuild {
  version: string | null;
  precision: string | null;
  gpu: 'CUDA' | 'OpenCL' | 'SYCL' | 'HIP' | 'disabled' | 'unknown';
  simd: string | null;
  threading: string;
}

export interface GmxRecommendation {
  mode: 'gpu' | 'cpu';
  flags: string[];
  note: string;
  howToGetGpu?: string;
}

export interface BridgeTool {
  path: string;
  version: string;
  build?: GmxBuild;
  recommendation?: GmxRecommendation;
}

export interface BridgeHealth {
  name: 'nayancode-bridge';
  version: string;
  tools: Record<string, BridgeTool>;
  gpus: BridgeGpu[];
  cpus: number;
  memoryGb: number;
  platform: string;
  runsActive: number;
}

export interface RunStatus {
  state: 'running' | 'exited' | 'killed' | 'timeout' | 'error';
  code: number | null;
  signal: string | null;
  startedAt: number;
  endedAt: number | null;
  tool: string;
  args: string[];
}

export type RunResult = { code: number | null; state: RunStatus['state'] };
export interface RunOptions {
  stdin?: string;
  onLog?: (text: string) => void;
  signal?: AbortSignal;
  pollMs?: number;
}

const NETWORK = 'Cannot reach the Bridge. Is it running, and did your browser ask permission to access local devices? (Chrome shows a prompt.)';
const TERMINAL: RunStatus['state'][] = ['exited', 'killed', 'timeout', 'error'];

export class BridgeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Feature-detected Local Network Access hint. Older browsers ignore unknown RequestInit keys. */
function loopbackInit(url: string): RequestInit {
  try {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return {};
    if ('targetAddressSpace' in Request.prototype) return { targetAddressSpace: 'loopback' } as unknown as RequestInit;
  } catch { /* not a URL yet; fetch will report it */ }
  return {};
}

export class Bridge {
  readonly baseUrl: string;
  readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    this.token = token.trim();
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${pathname}`;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    let r: Response;
    try {
      r = await fetch(url, { ...init, headers, ...loopbackInit(url) });
    } catch {
      throw new BridgeError(0, NETWORK);
    }
    if (!r.ok) {
      let message = `Bridge request failed (${r.status})`;
      try { const j = await r.json() as { error?: string }; if (j?.error) message = j.error; } catch { /* not JSON */ }
      throw new BridgeError(r.status, message);
    }
    return r;
  }

  private async json<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    return await (await this.request(pathname, init)).json() as T;
  }

  async health(): Promise<BridgeHealth> {
    return await this.json<BridgeHealth>('/v1/health');
  }

  async createJob(): Promise<string> {
    const r = await this.json<{ id: string }>('/v1/jobs', { method: 'POST' });
    return r.id;
  }

  async upload(job: string, name: string, data: Blob | Uint8Array | string, onProgress?: (sent: number, total: number) => void): Promise<{ name: string; bytes: number }> {
    const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const total = body instanceof Blob ? body.size : body.byteLength;
    onProgress?.(0, total);
    const r = await this.json<{ name: string; bytes: number }>(`/v1/jobs/${job}/files/${encodeURIComponent(name)}`, {
      method: 'PUT', body: body as BodyInit, headers: { 'Content-Type': 'application/octet-stream' },
    });
    onProgress?.(total, total);
    return r;
  }

  async list(job: string): Promise<{ name: string; bytes: number; modified: number }[]> {
    return await this.json(`/v1/jobs/${job}/files`);
  }

  async download(job: string, name: string): Promise<Blob> {
    return await (await this.request(`/v1/jobs/${job}/files/${encodeURIComponent(name)}`)).blob();
  }

  async remove(job: string): Promise<void> {
    await this.request(`/v1/jobs/${job}`, { method: 'DELETE' });
  }

  async runStatus(job: string, runId: string): Promise<RunStatus> {
    return await this.json(`/v1/jobs/${job}/runs/${runId}`);
  }

  async log(job: string, runId: string, from = 0): Promise<{ text: string; next: number }> {
    return await this.json(`/v1/jobs/${job}/runs/${runId}/log?from=${Math.max(0, Math.floor(from))}`);
  }

  async cancel(job: string, runId: string): Promise<void> {
    await this.request(`/v1/jobs/${job}/runs/${runId}`, { method: 'DELETE' });
  }

  async run(job: string, tool: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    const pollMs = Math.max(100, opts.pollMs ?? 500);
    const { runId } = await this.json<{ runId: string }>(`/v1/jobs/${job}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, stdin: opts.stdin }),
    });
    let from = 0;
    for (;;) {
      if (opts.signal?.aborted) { await this.cancel(job, runId).catch(() => {}); throw new DOMException('Aborted', 'AbortError'); }
      const status = await this.runStatus(job, runId);
      const log = await this.log(job, runId, from);
      if (log.text) opts.onLog?.(log.text);
      from = log.next;
      if (TERMINAL.includes(status.state)) return { code: status.code, state: status.state };
      try { await sleep(pollMs, opts.signal); }
      catch { await this.cancel(job, runId).catch(() => {}); throw new DOMException('Aborted', 'AbortError'); }
    }
  }
}

/** Shared connection state so studios can ask whether a Bridge is connected. */
interface BridgeStore {
  baseUrl: string;
  connected: boolean;
  health: BridgeHealth | null;
  client: Bridge | null;
  setConnected: (client: Bridge, health: BridgeHealth) => void;
  disconnect: () => void;
}

export const useBridge = create<BridgeStore>((set) => ({
  baseUrl: 'http://127.0.0.1:8787',
  connected: false,
  health: null,
  client: null,
  setConnected: (client, health) => set({ client, health, connected: true, baseUrl: client.baseUrl }),
  disconnect: () => set({ client: null, health: null, connected: false }),
}));

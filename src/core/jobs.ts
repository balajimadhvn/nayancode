import { create } from 'zustand';
import { sha256Hex } from './hash';
import { CITATIONS, useProvenance, type ToolInfo } from './provenance';

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';
export interface Job { id: string; label: string; status: JobStatus; progress: number; note?: string; startedAt: number; endedAt?: number; error?: string }

interface JobState { jobs: Job[]; patch(id: string, p: Partial<Job>): void; add(j: Job): void; clear(): void }
export const useJobs = create<JobState>((set) => ({
  jobs: [],
  add: (j) => set((s) => ({ jobs: [j, ...s.jobs].slice(0, 30) })),
  patch: (id, p) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) })),
  clear: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'running') })),
}));

export interface RunSpec<T> {
  label: string;
  tool: ToolInfo;
  params: Record<string, unknown>;
  inputs: { name: string; data: string }[];
  signal?: AbortSignal;
  run(h: { onProgress(p: number, note?: string): void; signal: AbortSignal }): Promise<T>;
  summary?: (result: T) => string;
}

const active = new Map<string, AbortController>();
export const cancelJob = (id: string) => active.get(id)?.abort();

/** Runs a computation as a tracked job and writes a provenance record on success. */
export async function runJob<T>(spec: RunSpec<T>): Promise<T> {
  const id = crypto.randomUUID();
  const ac = new AbortController();
  active.set(id, ac);
  spec.signal?.addEventListener('abort', () => ac.abort());
  const { add, patch } = useJobs.getState();
  const t0 = performance.now();
  add({ id, label: spec.label, status: 'running', progress: 0, startedAt: Date.now() });
  try {
    const result = await spec.run({ onProgress: (p, note) => patch(id, { progress: p, note }), signal: ac.signal });
    const inputs = await Promise.all(spec.inputs.map(async (i) => ({ name: i.name, sha256: await sha256Hex(i.data), bytes: i.data.length })));
    useProvenance.getState().add({
      toolId: spec.tool.id, toolName: spec.tool.name, toolVersion: spec.tool.version, engine: spec.tool.engine,
      citations: spec.tool.citations.filter((c) => c in CITATIONS), params: spec.params, inputs,
      startedAt: new Date(Date.now() - (performance.now() - t0)).toISOString(), durationMs: Math.round(performance.now() - t0),
      summary: spec.summary ? spec.summary(result) : spec.tool.describe(spec.params),
    });
    patch(id, { status: 'done', progress: 1, endedAt: Date.now() });
    return result;
  } catch (e) {
    const cancelled = e instanceof DOMException && e.name === 'AbortError';
    patch(id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : (e as Error).message, endedAt: Date.now() });
    throw e;
  } finally {
    active.delete(id);
  }
}

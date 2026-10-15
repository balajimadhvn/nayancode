import { assetUrl } from '@/core/asset';
/** Promise client for the RDKit worker (public/rdkit/chem-worker.js). Cancel = terminate + respawn. */
let worker: Worker | null = null; let seq = 0;
const get = () => (worker ??= new Worker(assetUrl('rdkit/chem-worker.js')));
export function chemCall<T>(op: string, payload: Record<string, unknown> = {}, opts: { onProgress?(p: number, note?: string): void; signal?: AbortSignal } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = get(), id = ++seq;
    const done = () => { w.removeEventListener('message', on); opts.signal?.removeEventListener('abort', abort); };
    const on = (e: MessageEvent) => { if (e.data.id !== id) return; if ('progress' in e.data) return opts.onProgress?.(e.data.progress, e.data.note); done(); if ('error' in e.data) reject(new Error(e.data.error)); else resolve(e.data.result as T); };
    const abort = () => { done(); w.terminate(); if (worker === w) worker = null; reject(new DOMException('Cancelled', 'AbortError')); };
    w.addEventListener('message', on); opts.signal?.addEventListener('abort', abort); if (opts.signal?.aborted) return abort();
    w.postMessage({ id, op, ...payload });
  });
}

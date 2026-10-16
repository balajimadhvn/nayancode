import { assetUrl } from '@/core/asset';
/** Promise client for public/wasm/tool-runner.js (vendored minimap2, samtools, bcftools; all MIT). Cancel = terminate + respawn. */
import type { ToolResult } from './pipeline';
export type { ToolResult };
let worker: Worker | null = null, seq = 0;
const get = () => (worker ??= new Worker(assetUrl('wasm/tool-runner.js')));
export function runTool(tool: 'minimap2' | 'samtools' | 'bcftools', args: string[], files: Record<string, Uint8Array | string>, outputs: string[] = [], opts: { onLog?(l: string): void; signal?: AbortSignal } = {}): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const w = get(), id = ++seq;
    const done = () => { w.removeEventListener('message', on); opts.signal?.removeEventListener('abort', abort); };
    const on = (e: MessageEvent) => { if (e.data.id !== id) return; if ('log' in e.data) return opts.onLog?.(e.data.log); done(); if ('error' in e.data) reject(new Error(`${tool}: ${e.data.error}`)); else resolve(e.data.result as ToolResult); };
    const abort = () => { done(); w.terminate(); if (worker === w) worker = null; reject(new DOMException('Cancelled', 'AbortError')); };
    w.addEventListener('message', on); opts.signal?.addEventListener('abort', abort); if (opts.signal?.aborted) return abort();
    w.postMessage({ id, tool, args, files, outputs });
  });
}

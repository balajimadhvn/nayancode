/** Minimal typed worker RPC with progress + cancellation (cancel = terminate & respawn). */
export interface KernelCtx { progress(p: number, note?: string): void }
export type Kernel<A = any, R = any> = (arg: A, ctx: KernelCtx) => R | Promise<R>;
export type Kernels = Record<string, Kernel>;
export type Remote<K extends Kernels> = {
  [M in keyof K]: (arg: Parameters<K[M]>[0], opts?: CallOpts) => Promise<Awaited<ReturnType<K[M]>>>;
};
export interface CallOpts { onProgress?: (p: number, note?: string) => void; signal?: AbortSignal }

/** Worker side. */
export function exposeKernels(kernels: Kernels) {
  self.onmessage = async (e: MessageEvent) => {
    const { id, method, arg } = e.data;
    try {
      const fn = kernels[method];
      if (!fn) throw new Error(`Unknown kernel: ${method}`);
      const result = await fn(arg, { progress: (p, note) => self.postMessage({ id, progress: p, note }) });
      self.postMessage({ id, result });
    } catch (err) {
      self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** Main-thread side. */
export function createRemote<K extends Kernels>(factory: () => Worker): Remote<K> {
  let worker: Worker | null = null;
  let seq = 0;
  const get = () => (worker ??= factory());
  return new Proxy({}, {
    get: (_t, method: string) => (arg: unknown, opts: CallOpts = {}) =>
      new Promise((resolve, reject) => {
        const w = get();
        const id = ++seq;
        const cleanup = () => { w.removeEventListener('message', onMsg); opts.signal?.removeEventListener('abort', onAbort); };
        const onMsg = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          if ('progress' in e.data) { opts.onProgress?.(e.data.progress, e.data.note); return; }
          cleanup();
          if ('error' in e.data) reject(new Error(e.data.error)); else resolve(e.data.result);
        };
        const onAbort = () => { cleanup(); w.terminate(); if (worker === w) worker = null; reject(new DOMException('Cancelled', 'AbortError')); };
        if (opts.signal?.aborted) return onAbort();
        w.addEventListener('message', onMsg);
        opts.signal?.addEventListener('abort', onAbort);
        w.postMessage({ id, method, arg });
      }),
  }) as Remote<K>;
}

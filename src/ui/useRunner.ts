import { useCallback, useRef, useState } from 'react';
import { runJob, type RunSpec } from '@/core/jobs';

/** Wraps runJob with local busy/progress/error state and cancellation for a studio panel. */
export function useRunner() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);
  const run = useCallback(async <T,>(spec: Omit<RunSpec<T>, 'signal'>): Promise<T | undefined> => {
    ac.current?.abort(); ac.current = new AbortController();
    setBusy(true); setError(null); setProgress(0); setNote(undefined);
    try {
      return await runJob<T>({ ...spec, signal: ac.current.signal, run: (h) => spec.run({ ...h, onProgress: (p, n) => { setProgress(p); setNote(n); h.onProgress(p, n); } }) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError((e as Error).message);
      return undefined;
    } finally { setBusy(false); }
  }, []);
  const cancel = useCallback(() => ac.current?.abort(), []);
  return { run, busy, progress, note, error, cancel, setError };
}

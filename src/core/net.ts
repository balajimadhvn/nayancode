import { create } from 'zustand';

interface NetState { sentBytes: number; requests: number; hosts: Record<string, number>; log(host: string, bytes: number): void }
export const useNet = create<NetState>((set) => ({
  sentBytes: 0, requests: 0, hosts: {},
  log: (host, bytes) => set((s) => ({ sentBytes: s.sentBytes + bytes, requests: s.requests + 1, hosts: { ...s.hosts, [host]: (s.hosts[host] ?? 0) + 1 } })),
}));

/** The only sanctioned way to reach the network. Counts every outbound request and its body size. */
export async function trackedFetch(url: string, init?: RequestInit): Promise<Response> {
  const body = init?.body;
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body).length : body instanceof Blob ? body.size : body instanceof ArrayBuffer ? body.byteLength : 0;
  useNet.getState().log(new URL(url, location.href).host, bytes);
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url, location.href).host} responded ${res.status}`);
  return res;
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

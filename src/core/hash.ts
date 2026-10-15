export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const sub = globalThis.crypto?.subtle;
  if (!sub) { let h = 5381; for (const b of buf) h = ((h << 5) + h + b) | 0; return 'fnv-' + (h >>> 0).toString(16); }
  const d = await sub.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

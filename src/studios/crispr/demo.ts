/** Deterministic 600-bp demo sequence for the CRISPR Studio (same sequence on every visit). */
export function demoSequence(n = 600, seed = 20261026): string {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: n }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');
}

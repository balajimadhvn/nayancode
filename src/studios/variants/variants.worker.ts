import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';
import * as sg from './signatures';

async function readText(a: { file?: File; text?: string }, ctx: { progress(p: number, n?: string): void }): Promise<string> {
  if (a.text !== undefined) return a.text; const f = a.file!; const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) { const s = f.stream().pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>).pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>); const parts: string[] = []; const r = s.getReader(); let n = 0; for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value as unknown as string); n += (value as unknown as string).length; ctx.progress(Math.min(0.5, n / (f.size * 6)), 'Decompressing'); } return parts.join(''); }
  return f.text();
}
const MAX_ROWS = 150_000;
const vcf: Kernel<{ file?: File; text?: string }, { samples: string[]; variants: k.Variant[]; skipped: number; total: number; truncated: boolean }> = async (a, ctx) => {
  const text = await readText(a, ctx); ctx.progress(0.55, 'Parsing VCF'); const v = k.parseVcf(text); ctx.progress(0.95, 'Packing');
  const slim = v.variants.slice(0, MAX_ROWS).map((x) => ({ ...x, info: {} }));
  return { samples: v.samples, variants: slim, skipped: v.skipped, total: v.variants.length, truncated: v.variants.length > MAX_ROWS };
};
const gwas: Kernel<{ file?: File; text?: string }, ReturnType<typeof k.gwasSummary>> = async (a, ctx) => { const t = await readText(a, ctx); ctx.progress(0.6, 'Summarising'); return k.gwasSummary(k.parseGwas(t)); };
const sigSelect: Kernel<{ V: number[][]; kMax: number }, { k: number; error: number; stability: number; cosine: number }[]> = (a, ctx) => {
  const out = []; for (let k = 1; k <= a.kMax; k++) { const e = sg.extractSignatures(a.V, k, 6); out.push({ k, error: e.error, stability: e.stability, cosine: e.cosineToInput }); ctx.progress(k / a.kMax, `k = ${k}`); } return out;
};
const sigExtract: Kernel<{ V: number[][]; k: number; ref?: { names: string[]; sigs: number[][] } }, { ex: sg.Extraction; matches: { sig: number; ref: string; cosine: number }[]; refit: { sample: number; exposures: number[]; cosine: number }[] }> = (a, ctx) => {
  const ex = sg.extractSignatures(a.V, a.k, 10, (f) => ctx.progress(f * 0.8, 'NMF restarts'));
  const matches = a.ref ? ex.signatures.map((s, i) => { const c = a.ref!.sigs.map((r) => sg.cosine(s, r)), j = c.indexOf(Math.max(...c)); return { sig: i, ref: a.ref!.names[j], cosine: c[j] }; }) : [];
  const refit = a.ref ? a.V.map((row, i) => ({ sample: i, ...sg.refit(row, a.ref!.sigs) })) : [];
  return { ex, matches, refit };
};
const sbs: Kernel<{ vcf: { file?: File; text?: string }; fasta: string; sampleIdx: number[] }, { rows: { sample: string; counts: number[]; used: number; skipped: number; missingContig: number }[] }> = async (a, ctx) => {
  const v = k.parseVcf(await readText(a.vcf, ctx)); const g = sg.parseFastaMap(a.fasta); if (!g.size) throw new Error('The FASTA contained no sequences.');
  const idx = a.sampleIdx.length ? a.sampleIdx : v.samples.map((_, i) => i); if (!idx.length) idx.push(-1);
  return { rows: idx.map((i) => { const r = sg.sbs96Counts(v.variants, g, i); return { sample: i >= 0 ? v.samples[i] : 'all variants', counts: Array.from(r.counts), used: r.used, skipped: r.skipped, missingContig: r.missingContig }; }) };
};
export type VariantKernels = { vcf: typeof vcf; gwas: typeof gwas; sigSelect: typeof sigSelect; sigExtract: typeof sigExtract; sbs: typeof sbs };
exposeKernels({ vcf, gwas, sigSelect, sigExtract, sbs } as Record<string, Kernel>);

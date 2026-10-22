import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';
import * as sg from './signatures';
import * as ga from './assoc';

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
export interface AssocArgs { geno: { file?: File; text?: string }; vcf: boolean; pheno: { file?: File; text?: string }; opts: ga.AssocOptions }
const assoc: Kernel<AssocArgs, { res: Omit<ga.AssocResult, 'rows'> & { nRows: number; top: ga.AssocRow[] }; summary: ReturnType<typeof k.gwasSummary> | null; csv: string }> = async (a, ctx) => {
  ctx.progress(0.05, 'Reading genotypes'); const gt = await readText(a.geno, ctx), pt = await readText(a.pheno, ctx);
  const geno = a.vcf ? ga.parseGenotypeVcf(gt) : ga.parseGenotypeTable(gt); const ph = ga.parsePhenotypes(pt, geno.samples);
  const r = ga.runAssociation(geno, ph, a.opts, (f) => ctx.progress(0.15 + 0.7 * f, 'Testing variants'));
  if (!r.rows.length) throw new Error('No variants passed the filters. Relax the MAF, call-rate or HWE thresholds.');
  ctx.progress(0.9, 'Summarising'); const sorted = [...r.rows].sort((x, y) => x.p - y.p);
  const summary = k.gwasSummary(r.rows.map((x) => ({ chrom: x.chrom, pos: x.pos, p: x.p, id: x.id })));
  const csv = ['id,chrom,pos,maf,call_rate,hwe_p,n,beta,se,p', ...sorted.map((x) => [x.id, x.chrom, x.pos, x.maf.toFixed(4), x.callRate.toFixed(3), x.hwe.toExponential(2), x.n, x.beta.toFixed(5), Number.isFinite(x.se) ? x.se.toFixed(5) : '', x.p.toExponential(4)].join(','))].join('\n');
  const { rows, ...rest } = r; return { res: { ...rest, nRows: rows.length, top: sorted.slice(0, 200) }, summary, csv };
};

export type VariantKernels = { vcf: typeof vcf; gwas: typeof gwas; assoc: typeof assoc; sigSelect: typeof sigSelect; sigExtract: typeof sigExtract; sbs: typeof sbs };
exposeKernels({ vcf, gwas, assoc, sigSelect, sigExtract, sbs } as Record<string, Kernel>);

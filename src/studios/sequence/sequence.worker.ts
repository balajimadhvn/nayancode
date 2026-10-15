import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';
import * as d from './design';

const kernels = {
  orfs: ((a: { seq: string; minAa: number }) => k.findOrfs(a.seq, a.minAa)) as Kernel,
  composition: ((a: { seq: string; win: number }) => k.composition(a.seq, a.win)) as Kernel,
  digest: ((a: { seq: string; enzymes: string[]; circular: boolean }) => k.digest(a.seq, a.enzymes, a.circular)) as Kernel,
  align: ((a: { a: string; b: string; opts: k.AlignOpts }, ctx) => k.align(a.a, a.b, a.opts, (p) => ctx.progress(p))) as Kernel,
  dotplot: ((a: { a: string; b: string; k: number }) => k.dotplot(a.a, a.b, a.k)) as Kernel,
};
export type SequenceKernels = SeqKernels2 & {
  orfs: Kernel<{ seq: string; minAa: number }, k.Orf[]>;
  composition: Kernel<{ seq: string; win: number }, k.Composition>;
  digest: Kernel<{ seq: string; enzymes: string[]; circular: boolean }, k.Digest>;
  align: Kernel<{ a: string; b: string; opts: k.AlignOpts }, k.Alignment>;
  dotplot: Kernel<{ a: string; b: string; k: number }, ReturnType<typeof k.dotplot>>;
};
const packs = new Map<string, unknown>();
async function jaspar(base: string): Promise<{ meta: { license: string; attribution: string; n: number; built: string }; matrices: d.Pfm[] }> { if (!packs.has(base)) { const r = await fetch(base + 'jaspar_core_vertebrates.json'); if (!r.ok) throw new Error(`Could not load JASPAR matrices (${r.status})`); packs.set(base, await r.json()); } return packs.get(base) as never; }
const primers: Kernel<{ template: string; target: { start: number; len: number }; params: Partial<d.PrimerParams>; excluded: [number, number][] }, ReturnType<typeof d.designPrimers>> = (a, ctx) => { ctx.progress(0.1, 'Enumerating candidates'); return d.designPrimers(a.template, a.target, a.params, a.excluded); };
const pcr: Kernel<{ fwd: string; rev: string; template: string }, ReturnType<typeof d.insilicoPcr>> = (a) => d.insilicoPcr(a.fwd, a.rev, a.template);
const crispr: Kernel<{ seq: string; nucleaseId: string; genome: [string, string][]; maxMm: number; top: number }, { guides: d.Guide[]; total: number; scanned: number }> = (a, ctx) => {
  const nuc = d.NUCLEASES.find((n) => n.id === a.nucleaseId)!, all = d.findGuides(a.seq, nuc), genome = new Map<string, string>(a.genome.length ? a.genome : [['target', a.seq.toUpperCase()]]), scanned = [...genome.values()].reduce((x, y) => x + y.length, 0);
  const top = all.slice(0, a.top); top.forEach((g, i) => { g.offTargets = d.offTargets(g, genome, nuc, a.maxMm); ctx.progress((i + 1) / top.length, `off-target scan ${i + 1}/${top.length}`); });
  return { guides: top.sort((x, y) => (y.offTargets?.specificity ?? 0) * 0.5 + y.score * 0.5 - ((x.offTargets?.specificity ?? 0) * 0.5 + x.score * 0.5)), total: all.length, scanned };
};
const motifs: Kernel<{ dataBase: string; ids: string[]; query: string; seqs: { id: string; seq: string }[]; minRel: number; shuffles: number }, { list?: { id: string; name: string; consensus: string; len: number }[]; results: { id: string; name: string; consensus: string; pfm: d.Pfm; hits: (d.MotifHit & { seqId: string })[]; expected: number; fold: number }[]; meta: { license: string; attribution: string; n: number; built: string } }> = async (a, ctx) => {
  const j = await jaspar(a.dataBase); if (a.query) { const q = a.query.toLowerCase(); return { list: j.matrices.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || d.pwmConsensus(m).includes(a.query.toUpperCase())).slice(0, 40).map((m) => ({ id: m.id, name: m.name, consensus: d.pwmConsensus(m), len: m.A.length })), results: [], meta: j.meta }; }
  let s = 7; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296), shuffle = (x: string) => { const arr = x.split(''); for (let i = arr.length - 1; i > 0; i--) { const k2 = Math.floor(rnd() * (i + 1)); [arr[i], arr[k2]] = [arr[k2], arr[i]]; } return arr.join(''); };
  const out = a.ids.map((id, mi) => { const m = j.matrices.find((x) => x.id === id)!; if (!m) throw new Error(`Matrix ${id} not found`); const pwm = d.pfmToPwm(m), hits: (d.MotifHit & { seqId: string })[] = []; for (const q of a.seqs) for (const h of d.scanPwm(q.seq, pwm, a.minRel)) hits.push({ ...h, seqId: q.id }); let bg = 0; for (let r = 0; r < a.shuffles; r++) for (const q of a.seqs) bg += d.scanPwm(shuffle(q.seq.toUpperCase()), pwm, a.minRel).length; const expected = a.shuffles ? bg / a.shuffles : 0; ctx.progress((mi + 1) / a.ids.length, m.name); return { id, name: m.name, consensus: d.pwmConsensus(m), pfm: m, hits: hits.sort((x, y) => y.rel - x.rel).slice(0, 500), expected, fold: expected ? hits.length / expected : NaN }; });
  return { results: out, meta: j.meta };
};
export type SeqKernels2 = { primers: typeof primers; pcr: typeof pcr; crispr: typeof crispr; motifs: typeof motifs };
exposeKernels({ ...kernels, primers, pcr, crispr, motifs } as Record<string, Kernel>);

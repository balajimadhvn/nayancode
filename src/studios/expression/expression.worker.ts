import { exposeKernels, type Kernel } from '@/compute/rpc';
import * as k from './kernels';
import * as en from './enrichment';
import { combat, parseBatches } from './combat';

export interface Analysed { qc: { samples: string[]; libSize: number[]; detected: number[]; sf: number[]; groups: string[] }; pca: k.PcaResult; de: k.DeResult; heat: { genes: string[]; z: number[][]; samples: string[] }; batch?: { labels: string[]; nBatches: number; pcaBefore: k.PcaResult; correctedCsv: string } }

const analyse: Kernel<{ counts: string; sheet: string; params: Omit<k.DeParams, 'groupA' | 'groupB'> & { groupA: string; groupB: string } }, Analysed> = (a, ctx) => {
  ctx.progress(0.05, 'Parsing matrix');
  const m = k.parseMatrix(a.counts);
  const groups = k.parseGroups(a.sheet, m.samples);
  ctx.progress(0.2, 'Normalising (median-of-ratios)');
  const logged = k.normalise(m);
  const batches = parseBatches(a.sheet, m.samples);
  ctx.progress(0.4, batches ? 'ComBat batch correction' : 'PCA');
  const S = m.samples.length;
  const cb = batches ? combat(logged.x, m.genes.length, S, batches, groups) : null;
  const view: k.Logged = cb ? { ...logged, x: cb.x } : logged;
  const pcaRaw = k.pca(logged, 500, 4);
  const pca = cb ? k.pca(view, 500, 4) : pcaRaw;
  ctx.progress(0.6, 'Differential expression');
  const de = k.differential(m, groups, a.params);
  ctx.progress(0.85, 'Clustering top genes');
  const idx = new Map(m.genes.map((g, i) => [g, i]));
  const top = de.rows.slice(0, 40).map((r) => r.gene);
  const rows = top.map((g) => Float64Array.from({ length: S }, (_, j) => view.x[idx.get(g)! * S + j]));
  const order = k.clusterOrder(rows);
  const z = order.map((i) => { const r = rows[i]; const mean = r.reduce((x, y) => x + y, 0) / S; const sd = Math.sqrt(r.reduce((x, y) => x + (y - mean) ** 2, 0) / (S - 1)) || 1; return Array.from(r, (v) => (v - mean) / sd); });
  return { qc: { samples: m.samples, libSize: logged.libSize, detected: logged.detected, sf: Array.from(logged.sf), groups }, pca, de, heat: { genes: order.map((i) => top[i]), z, samples: m.samples }, batch: cb ? { labels: batches!, nBatches: cb.nBatches, pcaBefore: pcaRaw, correctedCsv: 'gene,' + m.samples.join(',') + '\n' + m.genes.map((g, i) => g + ',' + Array.from({ length: S }, (_, j) => cb.x[i * S + j].toFixed(4)).join(',')).join('\n') } : undefined };
};
const packCache = new Map<string, unknown>();
async function loadJson<T>(url: string): Promise<T> { if (!packCache.has(url)) { const r = await fetch(url); if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`); packCache.set(url, await r.json()); } return packCache.get(url) as T; }
export interface EnrichArgs { dataBase: string; collection: 'reactome' | 'wikipathways' | 'go_bp'; method: 'ora-up' | 'ora-down' | 'ora-all' | 'gsea'; rows: { gene: string; t: number; fdr: number; log2FC: number }[]; fdr: number; lfc: number; perms: number }
const FILES = { reactome: 'reactome_human.json', wikipathways: 'wikipathways_human.json', go_bp: 'go_bp_human.json' } as const;
const enrich: Kernel<EnrichArgs, { kind: 'ora' | 'gsea'; ora?: en.OraRow[]; gsea?: en.GseaRow[]; meta: en.GeneSetPack['meta']; mapped: number; unmapped: number; listSize: number; bgSize: number }> = async (a, ctx) => {
  ctx.progress(0.05, 'Loading gene sets');
  const pack = await loadJson<en.GeneSetPack>(a.dataBase + FILES[a.collection]); const sets = en.unpack(pack);
  let ens: Record<string, string> | undefined; if (a.rows.some((r) => /^ENSG\d/i.test(r.gene))) ens = (await loadJson<{ ensembl: Record<string, string> }>(a.dataBase + 'human_idmap.json')).ensembl;
  const norm = en.normaliseGenes(a.rows.map((r) => r.gene), ens); const rows = a.rows.map((r, i) => ({ ...r, gene: norm.symbols[i] }));
  ctx.progress(0.2, a.method === 'gsea' ? 'Preranked GSEA' : 'Over-representation');
  if (a.method === 'gsea') { const g = en.gsea(sets, rows.map((r) => ({ gene: r.gene, score: r.t })), { perms: a.perms }, (f) => ctx.progress(0.2 + 0.75 * f, 'Preranked GSEA')); return { kind: 'gsea', gsea: g, meta: pack.meta, ...norm, listSize: rows.length, bgSize: rows.length }; }
  const pick = rows.filter((r) => r.fdr <= a.fdr && Math.abs(r.log2FC) >= a.lfc && (a.method === 'ora-all' || (a.method === 'ora-up' ? r.log2FC > 0 : r.log2FC < 0)));
  if (pick.length < 3) throw new Error(`Only ${pick.length} genes pass the thresholds (FDR ≤ ${a.fdr}, |log2FC| ≥ ${a.lfc}) in this direction.`);
  return { kind: 'ora', ora: en.ora(sets, pick.map((r) => r.gene), rows.map((r) => r.gene)), meta: pack.meta, ...norm, listSize: pick.length, bgSize: rows.length };
};
export type ExpressionKernels = { analyse: typeof analyse; enrich: typeof enrich };
exposeKernels({ analyse, enrich } as Record<string, Kernel>);

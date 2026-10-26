/** GFF3 / GTF annotation parsing for read counting. Gene models use the merged union of every exon of every
 *  transcript, which is the length used for TPM. Pure TypeScript, no DOM. */

export interface GffFeature {
  seqid: string;
  source: string;
  type: string;
  start: number; // 1-based inclusive
  end: number;
  score: string;
  strand: '+' | '-' | '.';
  phase: string;
  attrs: Record<string, string>;
}

export interface GffGene {
  id: string;
  name: string;
  seqid: string;
  strand: '+' | '-';
  /** Merged, sorted, 1-based inclusive exon intervals. */
  exons: [number, number][];
  /** Sum of exon lengths after merging (bases). */
  length: number;
}

export interface GffModel { format: 'gff3' | 'gtf'; features: GffFeature[]; genes: GffGene[] }

const GTF = /(?:^|;)\s*([A-Za-z_][\w.]*)\s+"([^"]*)"/g;
const GFF_KEY = /(?:^|;)\s*([A-Za-z_][\w.]*)=([^;]*)/g;

export function parseAttrColumn(col9: string, format: 'gff3' | 'gtf'): Record<string, string> {
  const out: Record<string, string> = {};
  if (format === 'gtf') {
    for (const m of col9.matchAll(GTF)) out[m[1]] = m[2];
    if (Object.keys(out).length === 0) for (const m of col9.matchAll(GFF_KEY)) out[m[1]] = m[2];
    return out;
  }
  for (const m of col9.matchAll(GFF_KEY)) {
    try { out[m[1]] = decodeURIComponent(m[2]); } catch { out[m[1]] = m[2]; }
  }
  // A few GTF-like GFF3 files mix the two styles; take whatever is left.
  for (const m of col9.matchAll(GTF)) if (!(m[1] in out)) out[m[1]] = m[2];
  return out;
}

/** Detect GFF3 (`key=value;`) vs GTF (`key "value";`) from column 9. */
export function detectFormat(text: string): 'gff3' | 'gtf' {
  let gff3 = 0, gtf = 0;
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    if (f.length < 9) continue;
    for (const _ of f[8].matchAll(GFF_KEY)) gff3++;
    for (const _ of f[8].matchAll(GTF)) gtf++;
    if (gff3 + gtf > 2000) break;
  }
  return gtf > gff3 ? 'gtf' : 'gff3';
}

const mergeExons = (xs: [number, number][]): [number, number][] => {
  if (!xs.length) return [];
  const s = [...xs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [[s[0][0], s[0][1]]];
  for (let i = 1; i < s.length; i++) {
    const cur = out[out.length - 1], [a, b] = s[i];
    if (a <= cur[1] + 1) cur[1] = Math.max(cur[1], b);
    else out.push([a, b]);
  }
  return out;
};
const exonLength = (xs: [number, number][]) => xs.reduce((a, [s, e]) => a + (e - s + 1), 0);

/** Parse a GFF3 or GTF file into features and gene models. */
export function parseGff(text: string): GffModel {
  const format = detectFormat(text), features: GffFeature[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    if (f.length < 9) continue;
    const start = Number(f[3]), end = Number(f[4]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) continue;
    const strand: '+' | '-' | '.' = f[6] === '-' ? '-' : f[6] === '+' ? '+' : '.';
    features.push({ seqid: f[0], source: f[1], type: f[2].toLowerCase(), start, end, score: f[5], strand, phase: f[7], attrs: parseAttrColumn(f[8], format) });
  }
  const genes = format === 'gtf' ? buildGtf(features) : buildGff3(features);
  return { format, features, genes };
}

const nameOf = (attrs: Record<string, string>, id: string) => attrs.Name || attrs.name || attrs.gene || attrs.gene_name || attrs.locus_tag || attrs.ID || attrs.gene_id || id;

const makeGene = (id: string, attrs: Record<string, string>, f: GffFeature | undefined): GffGene => ({
  id, name: nameOf(attrs, id), seqid: f?.seqid ?? '', strand: f?.strand === '-' ? '-' : '+', exons: [], length: 0,
});

function finish(genes: GffGene[]): GffGene[] {
  for (const g of genes) {
    g.exons = mergeExons(g.exons);
    g.length = exonLength(g.exons);
  }
  return genes.filter((g) => g.length > 0 && g.seqid).sort((a, b) => (a.seqid < b.seqid ? -1 : a.seqid > b.seqid ? 1 : a.exons[0][0] - b.exons[0][0]));
}

function buildGff3(features: GffFeature[]): GffGene[] {
  const byId = new Map<string, GffGene>(), txGene = new Map<string, string>(), rows: GffFeature[] = [];
  const parents = (f: GffFeature) => (f.attrs.Parent || '').split(',').map((s) => s.trim()).filter(Boolean);
  const geneTypes = new Set(['gene', 'pseudogene', 'transposable_element_gene']);
  for (const f of features) {
    if (geneTypes.has(f.type) && f.attrs.ID) {
      if (!byId.has(f.attrs.ID)) byId.set(f.attrs.ID, makeGene(f.attrs.ID, f.attrs, f));
    } else if (f.attrs.ID && f.attrs.Parent && f.type !== 'exon' && f.type !== 'cds') {
      for (const p of parents(f)) txGene.set(f.attrs.ID, p);
    }
    if (f.type === 'exon' || f.type === 'cds') rows.push(f);
  }
  // Transcripts whose gene row is absent still define a gene.
  for (const [, p] of txGene) if (!byId.has(p)) byId.set(p, makeGene(p, {}, undefined));
  const exons = new Map<string, [number, number][]>(), cds = new Map<string, [number, number][]>();
  for (const f of rows) {
    for (const p of parents(f)) {
      let gene = byId.get(p);
      if (!gene) { const tx = txGene.get(p); if (tx) gene = byId.get(tx); }
      if (!gene) { gene = makeGene(txGene.get(p) ?? p, {}, f); byId.set(gene.id, gene); }
      const target = f.type === 'exon' ? exons : cds;
      const list = target.get(gene.id) ?? []; list.push([f.start, f.end]); target.set(gene.id, list);
      if (!gene.seqid) { gene.seqid = f.seqid; gene.strand = f.strand === '-' ? '-' : '+'; }
    }
  }
  for (const g of byId.values()) {
    const ex = exons.get(g.id);
    g.exons = ex?.length ? ex : cds.get(g.id) ?? [];
  }
  return finish([...byId.values()]);
}

function buildGtf(features: GffFeature[]): GffGene[] {
  const byId = new Map<string, GffGene>(), exons = new Map<string, [number, number][]>(), cds = new Map<string, [number, number][]>(), rows = new Map<string, [number, number]>();
  for (const f of features) {
    const id = f.attrs.gene_id;
    if (!id) continue;
    let g = byId.get(id);
    if (!g) { g = makeGene(id, f.attrs, f); byId.set(id, g); }
    if (f.type === 'exon') { const l = exons.get(id) ?? []; l.push([f.start, f.end]); exons.set(id, l); }
    else if (f.type === 'cds') { const l = cds.get(id) ?? []; l.push([f.start, f.end]); cds.set(id, l); }
    else if (f.type === 'gene' || f.type === 'transcript' || !rows.has(id)) rows.set(id, [f.start, f.end]);
  }
  for (const g of byId.values()) {
    const ex = exons.get(g.id), cd = cds.get(g.id), row = rows.get(g.id);
    g.exons = ex?.length ? ex : cd?.length ? cd : row ? [row] : [];
  }
  return finish([...byId.values()]);
}

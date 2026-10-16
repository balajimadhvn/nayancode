/** Genome containers shared by the primer-specificity and CRISPR off-target searches (pure TypeScript, no DOM). Bases are
 *  stored as codes A=0 C=1 G=2 T=3 and anything else (N, IUPAC codes, gaps) as 4, which never matches a primer or guide base. */
export interface Contig { name: string; description: string; length: number; codes: Uint8Array }
export interface Gene { contig: string; start: number; end: number; strand: '+' | '-'; id: string; name: string; locusTag: string; biotype: string; product: string; cds: [number, number] | null }
export interface Genome { id: string; name: string; contigs: Contig[]; genes: Gene[] }

const CODE = new Uint8Array(256).fill(4);
for (const [i, c] of [...'ACGT'].entries()) { CODE[c.charCodeAt(0)] = i; CODE[c.toLowerCase().charCodeAt(0)] = i; }
CODE['U'.charCodeAt(0)] = 3; CODE['u'.charCodeAt(0)] = 3;
export const BASES = 'ACGT';
export const encodeSeq = (s: string): Uint8Array => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = CODE[s.charCodeAt(i) & 255]; return o; };
export const decodeSeq = (c: ArrayLike<number>, a = 0, b = c.length): string => { let s = ''; for (let i = a; i < b; i++) s += c[i] < 4 ? BASES[c[i]] : 'N'; return s; };
export const revCompCodes = (c: Uint8Array): Uint8Array => { const n = c.length, o = new Uint8Array(n); for (let i = 0; i < n; i++) { const v = c[n - 1 - i]; o[i] = v < 4 ? 3 - v : 4; } return o; };

/** Multi-FASTA text → contigs. Empty records are skipped. */
export function parseFastaCodes(text: string): Contig[] {
  const out: Contig[] = []; let head: string | null = null, parts: Uint8Array[] = [];
  const flush = () => { if (head === null) return; const len = parts.reduce((a, p) => a + p.length, 0); if (len) { const codes = new Uint8Array(len); let o = 0; for (const p of parts) { codes.set(p, o); o += p.length; } const sp = head.search(/\s/); out.push({ name: sp < 0 ? head : head.slice(0, sp), description: sp < 0 ? '' : head.slice(sp + 1).trim(), length: len, codes }); } };
  for (let p = 0; p < text.length;) {
    let e = text.indexOf('\n', p); if (e < 0) e = text.length;
    const line = text.charCodeAt(p) === 62 ? text.slice(p + 1, e).replace(/\r$/, '') : null;
    if (line !== null) { flush(); head = line; parts = []; } else if (head !== null) { let q = e; if (q > p && text.charCodeAt(q - 1) === 13) q--; if (q > p) parts.push(encodeSeq(text.slice(p, q))); }
    p = e + 1;
  }
  flush(); return out;
}

const attr = (s: string, k: string) => { const m = new RegExp(`(?:^|;)${k}=([^;]*)`).exec(s); return m ? decodeURIComponent(m[1]) : ''; };
/** GFF3 (NCBI RefSeq flavour) → gene models. CDS rows contribute the product name and coding extent of their parent gene. */
export function parseGenes(gff: string): Gene[] {
  const genes = new Map<string, Gene>(), cds: { parent: string; s: number; e: number; product: string }[] = [], pseudo: Gene[] = [];
  for (const line of gff.split('\n')) {
    if (!line || line[0] === '#') continue; const f = line.split('\t'); if (f.length < 9) continue;
    const type = f[2];
    if (type === 'gene' || type === 'pseudogene') { const id = attr(f[8], 'ID'), g: Gene = { contig: f[0], start: +f[3] - 1, end: +f[4], strand: f[6] === '-' ? '-' : '+', id, name: attr(f[8], 'Name') || attr(f[8], 'gene'), locusTag: attr(f[8], 'locus_tag'), biotype: attr(f[8], 'gene_biotype') || type, product: '', cds: null }; genes.set(id, g); pseudo.push(g); }
    else if (type === 'CDS') cds.push({ parent: attr(f[8], 'Parent'), s: +f[3] - 1, e: +f[4], product: attr(f[8], 'product') });
  }
  for (const c of cds) { const g = genes.get(c.parent); if (!g) continue; g.cds = g.cds ? [Math.min(g.cds[0], c.s), Math.max(g.cds[1], c.e)] : [c.s, c.e]; if (!g.product) g.product = c.product; }
  return pseudo.sort((a, b) => (a.contig < b.contig ? -1 : a.contig > b.contig ? 1 : a.start - b.start));
}
export const geneLabel = (g: Gene) => g.name || g.locusTag || g.id;

/** Genic context of a coordinate interval (0-based half-open): overlapping gene(s), else the nearest gene. */
export function annotateInterval(genes: Gene[], contig: string, start: number, end: number): { where: string; gene: string; product: string; distance: number } {
  let best: Gene | null = null, bestD = Infinity; const over: Gene[] = [];
  for (const g of genes) { if (g.contig !== contig) continue; if (g.start < end && g.end > start) over.push(g); else { const d = g.end <= start ? start - g.end : g.start - end; if (d < bestD) { bestD = d; best = g; } } }
  if (over.length) { const g = over.find((x) => x.cds && x.cds[0] < end && x.cds[1] > start) ?? over[0], coding = !!g.cds && g.cds[0] < end && g.cds[1] > start; return { where: coding ? 'CDS' : g.cds ? 'gene (outside CDS)' : g.biotype && g.biotype !== 'gene' ? g.biotype : 'gene', gene: over.map(geneLabel).join(', '), product: g.product, distance: 0 }; }
  return best ? { where: 'intergenic', gene: geneLabel(best), product: best.product, distance: bestD } : { where: 'no annotation', gene: '', product: '', distance: 0 };
}

/** Manifest of bundled genomes (public/genomes/manifest.json, written by scripts/fetch-genomes.mjs). */
export interface ManifestFile { file: string; url: string; bytes: number; sha256: string; md5: string }
export interface ManifestGenome { id: string; name: string; taxid: number; accession: string; assemblyName: string; source: string; totalLength: number; genes: number; sequences: { id: string; description: string; length: number; circular: boolean }[]; fasta: ManifestFile; gff: ManifestFile }
export interface Manifest { generated: string; licence: string; citation: string; genomes: ManifestGenome[] }

/** Gunzips with DecompressionStream; bytes without the gzip magic (a host that already decoded the file) are read as text. */
const gunzipText = async (buf: ArrayBuffer): Promise<string> => { const h = new Uint8Array(buf, 0, 2); return h[0] === 0x1f && h[1] === 0x8b ? new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf); };
let manifestP: Promise<Manifest> | null = null;
const base = () => new URL(import.meta.env.BASE_URL + 'genomes/', (self as unknown as { location: Location }).location.origin).href;
export const loadManifest = () => (manifestP ??= fetch(base() + 'manifest.json').then((r) => { if (!r.ok) throw new Error(`Genome manifest not found (HTTP ${r.status})`); return r.json() as Promise<Manifest>; }));
const cache = new Map<string, Promise<Genome>>();
/** Downloads a bundled genome (gzip, decompressed with DecompressionStream) and its annotation. Cached per page / worker. */
export function loadBundled(id: string): Promise<Genome> {
  let p = cache.get(id);
  if (!p) { p = (async () => {
    const m = (await loadManifest()).genomes.find((g) => g.id === id); if (!m) throw new Error(`Unknown bundled genome "${id}"`);
    const [fa, gff] = await Promise.all([m.fasta, m.gff].map(async (f) => { const r = await fetch(base() + f.file); if (!r.ok) throw new Error(`${f.file}: HTTP ${r.status}`); return gunzipText(await r.arrayBuffer()); }));
    return { id: m.id, name: m.name, contigs: parseFastaCodes(fa), genes: parseGenes(gff) };
  })(); p.catch(() => cache.delete(id)); cache.set(id, p); }
  return p;
}
/** Plain-text bundled files (decompressed FASTA / GFF3) for the genome viewer and for use as a mapping reference. */
export async function loadBundledText(id: string, kind: 'fasta' | 'gff'): Promise<string> {
  const m = (await loadManifest()).genomes.find((g) => g.id === id); if (!m) throw new Error(`Unknown bundled genome "${id}"`);
  const f = m[kind], r = await fetch(base() + f.file); if (!r.ok) throw new Error(`${f.file}: HTTP ${r.status}`); return gunzipText(await r.arrayBuffer());
}

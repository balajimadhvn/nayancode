/** In-silico PCR: ungapped primer binding on both strands, exact 3′ end, products and orphan sites. */
import { revComp } from '@/studios/sequence/kernels';

export interface Template { name: string; seq: string }
export interface Primer { name: string; seq: string }
export interface PcrOptions { maxMm?: number; min3?: number; maxSize?: number }
export interface PcrSite {
  template: string;
  primer: string;
  primerIndex: number;
  /** 1-based inclusive coordinates on the plus strand. */
  start: number;
  end: number;
  strand: '+' | '-';
  mismatches: number;
  /** Binding window as the primer reads it. */
  site: string;
}
export interface PcrProduct {
  template: string;
  f: string;
  r: string;
  start: number;
  end: number;
  size: number;
  mismatches: number;
  sequence: string;
}
export interface PcrResult { products: PcrProduct[]; single: PcrSite[] }

/** Lines are `name sequence`; a FASTA header sets the name for the following line. */
export function parsePrimers(text: string): Primer[] {
  const out: Primer[] = [];
  let pending = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('>')) { pending = line.slice(1).trim().split(/\s+/)[0] || ''; continue; }
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    const seq = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).toUpperCase().replace(/[^ACGT]/g, '');
    if (!seq) continue;
    out.push({ name: pending || (parts.length > 1 ? parts[0] : `primer${out.length + 1}`), seq });
    pending = '';
  }
  return out;
}

const clean = (s: string) => s.toUpperCase().replace(/[^ACGT]/g, '');

function findSites(template: string, primer: Primer, index: number, maxMm: number, min3: number): PcrSite[] {
  const p = clean(primer.seq), sites: PcrSite[] = [];
  if (!p.length) return sites;
  const tail = p.slice(-Math.min(min3, p.length));
  for (const strand of ['+', '-'] as const) {
    const s = strand === '+' ? template : revComp(template);
    for (let i = 0; i + p.length <= s.length; i++) {
      if (s.slice(i + p.length - tail.length, i + p.length) !== tail) continue;
      let mm = 0;
      for (let k = 0; k < p.length; k++) if (s[i + k] !== p[k]) { mm++; if (mm > maxMm) break; }
      if (mm > maxMm) continue;
      const start0 = strand === '+' ? i : template.length - (i + p.length);
      sites.push({
        template: '', primer: primer.name, primerIndex: index, start: start0 + 1, end: start0 + p.length,
        strand, mismatches: mm, site: s.slice(i, i + p.length),
      });
    }
  }
  return sites;
}

/** Run one PCR: every plus-strand site can pair with a downstream minus-strand site within maxSize. */
export function inSilicoPcr(templates: Template[], primers: Primer[], opts: PcrOptions = {}): PcrResult {
  const { maxMm = 2, min3 = 8, maxSize = 5000 } = opts;
  const products: PcrProduct[] = [], used = new Set<PcrSite>(), all: PcrSite[] = [];
  for (const t of templates) {
    const seq = clean(t.seq);
    if (!seq.length) continue;
    const sites: PcrSite[] = [];
    primers.forEach((p, i) => sites.push(...findSites(seq, p, i, maxMm, min3).map((s) => ({ ...s, template: t.name }))));
    all.push(...sites);
    const fwd = sites.filter((s) => s.strand === '+'), rev = sites.filter((s) => s.strand === '-');
    for (const f of fwd) for (const r of rev) {
      if (r.start <= f.end) continue;
      const size = r.end - f.start + 1;
      if (size > maxSize) continue;
      products.push({ template: t.name, f: f.primer, r: r.primer, start: f.start, end: r.end, size, mismatches: f.mismatches + r.mismatches, sequence: seq.slice(f.start - 1, r.end) });
      used.add(f); used.add(r);
    }
  }
  products.sort((a, b) => a.template.localeCompare(b.template) || a.start - b.start || a.end - b.end);
  return { products, single: all.filter((s) => !used.has(s)) };
}

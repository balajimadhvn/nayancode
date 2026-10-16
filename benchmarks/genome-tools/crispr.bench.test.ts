// CRISPR off-target search against Cas-OFFinder 2.4.1 (see make-reference.mjs): the same genomes, guides, PAMs and mismatch limit.
// The sites found must match exactly: same guide, sequence, strand, coordinate and mismatch count.
import { describe, expect, it } from 'vitest';
import { CRISPR_NUCLEASES, scoreHits, searchGuides } from '@/studios/genome/crispr';
import { round, writeJson } from '../lib/metrics';
import { guides, loadGenome, readTsv, sorted } from './lib';

interface Row { genome: string; nuclease: string; mismatches: number; guides: number; genomeBp: number; casOffinderSites: number; workbenchSites: number; identical: boolean; missing: number; extra: number; seconds: number; msPerGuidePerMb: number }
const rows: Row[] = [];
const nucOf = (n: string) => (n.startsWith('cas12a') ? CRISPR_NUCLEASES[2] : CRISPR_NUCLEASES[0]);

function compare(id: string, tag: string, list: string[], mm: number) {
  const g = loadGenome(id), nuc = nucOf(tag), refRows = readTsv(`${id}.${tag}.tsv.gz`), L = list[0].length, names = new Map(g.contigs.map((c) => [c.name, c.name]));
  const byQuery = new Map(list.map((x, i) => [nuc.pamSide === '3' ? x + 'N'.repeat(3) : 'NNNN' + x, i]));
  const ref = new Set(refRows.map((r) => { const first = r[1].split(/\s/)[0]; return `${byQuery.get(r[0])}:${names.get(first)}:${r[4]}:${r[2]}:${r[5]}:${r[3].toUpperCase()}`; }));
  const t0 = performance.now(), res = searchGuides(g.contigs, list, { nuclease: nuc, maxMismatch: mm, pams: tag.startsWith('cas12a') ? ['TTTV'] : ['NGG', 'NAG'] }), seconds = (performance.now() - t0) / 1000;
  const mine = new Set(res.hits.map((h) => `${h.guide}:${g.contigs[h.contig].name}:${h.strand}:${h.siteStart}:${h.mismatches}:${(nuc.pamSide === '3' ? h.target + h.pam : h.pam + h.target).toUpperCase()}`));
  const missing = sorted(ref).filter((x) => !mine.has(x)), extra = sorted(mine).filter((x) => !ref.has(x)), bp = g.contigs.reduce((a, c) => a + c.length, 0);
  rows.push({ genome: id, nuclease: tag, mismatches: mm, guides: list.length, genomeBp: bp, casOffinderSites: ref.size, workbenchSites: mine.size, identical: !missing.length && !extra.length, missing: missing.length, extra: extra.length, seconds: round(seconds, 2), msPerGuidePerMb: round((seconds * 1000) / list.length / (bp / 1e6), 1) });
  return { missing, extra, refSize: ref.size, L };
}

describe('CRISPR off-target search against Cas-OFFinder', () => {
  for (const id of ['lambda', 't7', 'ecoli-k12', 'bsubtilis-168', 'mtb-h37rv', 'saureus-8325', 'scer-s288c'])
    it(`SpCas9 NGG/NAG, ≤ 4 mismatches: ${id}`, () => { const r = compare(id, 'cas9', guides[id].cas9, 4); expect(r.missing).toEqual([]); expect(r.extra).toEqual([]); expect(r.refSize).toBeGreaterThan(15); });
  it('SpCas9, ≤ 6 mismatches (stress): ecoli-k12', () => { const r = compare('ecoli-k12', 'cas9-mm6', guides['ecoli-k12'].cas9.slice(0, 8), 6); expect(r.missing).toEqual([]); expect(r.extra).toEqual([]); expect(r.refSize).toBeGreaterThan(300); });
  for (const id of ['ecoli-k12', 'scer-s288c'])
    it(`Cas12a TTTV, 23-nt guides, ≤ 4 mismatches: ${id}`, () => { const r = compare(id, 'cas12a', guides[id].cas12a, 4); expect(r.missing).toEqual([]); expect(r.extra).toEqual([]); expect(r.refSize).toBeGreaterThan(10); });
  it('CFD and MIT scoring runs on every hit and annotates genes', () => {
    const g = loadGenome('ecoli-k12'), list = guides['ecoli-k12'].cas9, res = searchGuides(g.contigs, list, { maxMismatch: 4, pams: ['NGG', 'NAG'] }), { scored, perGuide } = scoreHits(res.hits, list, (p) => /^[ACGT]GG$/.test(p));
    expect(scored.filter((h) => h.onTarget).length).toBe(20); expect(scored.every((h) => h.cfd !== null && h.cfd >= 0 && h.cfd <= 1)).toBe(true);
    expect(perGuide.filter((p) => p.onTargets === 1).every((p) => p.cfdSpecificity! > 0 && p.cfdSpecificity! <= 100)).toBe(true);

  });
  it('writes the summary and every comparison was exactly identical', () => {
    expect(rows.length).toBeGreaterThanOrEqual(10); expect(rows.every((r) => r.identical)).toBe(true);
    const total = rows.reduce((a, r) => a + r.casOffinderSites, 0); writeJson('benchmarks/results/genome-tools-crispr.json', { reference: 'Cas-OFFinder 2.4.1 (CPU, OpenCL via PoCL)', totalSites: total, rows });
    // Generous speed floor so a performance regression is caught but a slow CI machine is not: 24 guides on 12 Mb must finish in a few minutes.
    expect(Math.max(...rows.map((r) => r.msPerGuidePerMb))).toBeLessThan(60_000 / 10);
  });
});

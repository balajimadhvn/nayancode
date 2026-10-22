import { describe, expect, it } from 'vitest';
import { readSequences } from '../../core/readstream';
import { buildIndex, classify, forEachKmer, pseudoalign, quantify, type Tx } from './pseudoalign';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const randSeq = (r: () => number, n: number) => Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join('');
const rc = (s: string) => [...s].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c] ?? 'N')).join('');
const spearman = (a: number[], b: number[]) => { const rk = (v: number[]) => v.map((x) => v.filter((y) => y < x).length + (v.filter((y) => y === x).length - 1) / 2); const ra = rk(a), rb = rk(b), n = a.length, ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n; let c = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return c / Math.sqrt(da * db); };

describe('k-mers', () => {
  it('canonical k-mers are strand-independent and skip ambiguous bases', () => {
    const r = rng(1), s = randSeq(r, 80), a: number[] = [], b: number[] = []; forEachKmer(s, 21, (k) => a.push(k)); forEachKmer(rc(s), 21, (k) => b.push(k));
    expect(a.sort()).toEqual(b.sort()); expect(a).toHaveLength(60);
    const n: number[] = []; forEachKmer('ACGTACGTACGTACGTACGTNACGTACGTACGTACGTACGT', 11, (k) => n.push(k)); expect(n.length).toBe(10 + 10);
  });
});

describe('index and classification', () => {
  const r = rng(7), shared = randSeq(r, 300), tx: Tx[] = [{ id: 'A', seq: randSeq(r, 400) + shared }, { id: 'B', seq: shared + randSeq(r, 400) }, { id: 'C', seq: randSeq(r, 600) }];
  const ix = buildIndex(tx, 25);
  it('a read from a unique region maps to one transcript, from the shared region to both, in either orientation', () => {
    expect(classify(ix, tx[0].seq.slice(50, 150))).toEqual([0]); expect(classify(ix, rc(tx[2].seq.slice(100, 200)))).toEqual([2]);
    expect(classify(ix, shared.slice(50, 150))).toEqual([0, 1]);
    expect(classify(ix, randSeq(rng(99), 100))).toEqual([]);
  });
  it('a read spanning the junction of unique and shared sequence maps to the transcript that contains both', () => { expect(classify(ix, tx[0].seq.slice(350, 450))).toEqual([0]); });
  it('rejects bad parameters and over-large inputs', () => { expect(() => buildIndex(tx, 31)).toThrow(/between/); expect(() => buildIndex([{ id: 'x', seq: 'ACGT' }], 21)).toThrow(/at least/); });
});

describe('quantification from simulated reads', () => {
  const r = rng(11), T = 40, tx: Tx[] = Array.from({ length: T }, (_, i) => ({ id: `t${i}`, seq: randSeq(r, 800 + Math.floor(r() * 1200)) }));
  // isoform pair: t1 is t0 minus an internal 300-nt exon
  tx[1] = { id: 't1', seq: tx[0].seq.slice(0, 400) + tx[0].seq.slice(700) };
  const truth = tx.map((_, i) => (i === 0 ? 400 : i === 1 ? 100 : Math.floor(Math.exp(r() * 4) * 8)));
  const reads: string[] = [];
  tx.forEach((t, i) => { for (let n = 0; n < truth[i]; n++) { const s = Math.floor(r() * (t.seq.length - 100)); let rd = t.seq.slice(s, s + 100); if (r() < 0.5) rd = rc(rd); rd = [...rd].map((c) => (r() < 0.004 ? 'ACGT'[Math.floor(r() * 4)] : c)).join(''); reads.push(rd); } });
  const ix = buildIndex(tx, 25), ec = pseudoalign(ix, reads), q = quantify(ix, ec, { fragLen: 101 });
  it('maps nearly all reads', () => expect(ec.mapped / ec.reads).toBeGreaterThan(0.97));
  it('recovers counts (Spearman > 0.98) and conserves the number of mapped reads', () => {
    expect(spearman(q.quant.map((x) => x.estCounts), truth)).toBeGreaterThan(0.98);
    expect(q.quant.reduce((a, x) => a + x.estCounts, 0)).toBeCloseTo(ec.mapped, 3);
  });
  it('EM splits ambiguous reads between isoforms in proportion to their unique evidence', () => {
    const a = q.quant[0].estCounts, b = q.quant[1].estCounts; expect(a / b).toBeGreaterThan(2.5); expect(a / b).toBeLessThan(6.5); // truth 4
  });
  it('TPM sums to one million', () => expect(q.quant.reduce((a, x) => a + x.tpm, 0)).toBeCloseTo(1e6, 0));
  it('paired reads are classified by intersecting both mates', () => {
    const t = tx[5].seq, ecp = pseudoalign(ix, [[t.slice(0, 100), rc(t.slice(200, 300))] as [string, string]]); expect(ecp.mapped).toBe(1); expect(ecp.sets[0]).toEqual([5]);
  });
});

describe('read streaming', () => {
  it('reads FASTQ and multi-line FASTA from text, and rejects other formats', async () => {
    const out: string[] = []; for await (const s of readSequences({ text: '@r1\nacgt\n+\nIIII\n@r2\nTTGG\n+\nIIII\n' })) out.push(s); expect(out).toEqual(['ACGT', 'TTGG']);
    const fa: string[] = []; for await (const s of readSequences({ text: '>a\nAC\nGT\n>b\nTT\n' })) fa.push(s); expect(fa).toEqual(['ACGT', 'TT']);
    await expect((async () => { for await (const _ of readSequences({ text: 'hello\n' })) void _; })()).rejects.toThrow(/FASTQ or FASTA/);
  });
  it('honours maxReads', async () => { const out: string[] = []; for await (const s of readSequences({ text: '>a\nAC\n>b\nGG\n>c\nTT\n' }, { maxReads: 2 })) out.push(s); expect(out).toEqual(['AC', 'GG']); });
});

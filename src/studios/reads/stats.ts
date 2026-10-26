/** Streaming FASTQ summary statistics. */
import { phred, type FastqRecord } from './fastq';
import { ADAPTERS, trimAdapter3 } from './trim';

const MAX_POS = 300;
const ADAPTER_LIST = Object.values(ADAPTERS);

export interface StatsAcc {
  reads: number; bases: number; gc: number; n: number; q20: number; q30: number;
  lengthHist: Map<number, number>;
  posSum: number[]; posN: number[];
  adapterHits: number;
}
export function newStats(): StatsAcc {
  return { reads: 0, bases: 0, gc: 0, n: 0, q20: 0, q30: 0, lengthHist: new Map(), posSum: new Array(MAX_POS).fill(0), posN: new Array(MAX_POS).fill(0), adapterHits: 0 };
}

export function addRecord(s: StatsAcc, r: FastqRecord): void {
  s.reads++; s.bases += r.seq.length;
  s.lengthHist.set(r.seq.length, (s.lengthHist.get(r.seq.length) ?? 0) + 1);
  for (let i = 0; i < r.seq.length; i++) {
    const b = r.seq[i].toUpperCase();
    if (b === 'G' || b === 'C') s.gc++;
    if (b === 'N') s.n++;
    const q = phred(r.qual[i]);
    if (q >= 20) s.q20++;
    if (q >= 30) s.q30++;
    if (i < MAX_POS) { s.posSum[i] += q; s.posN[i]++; }
  }
  if (ADAPTER_LIST.some((a) => trimAdapter3(r.seq, a, { minOverlap: 8 }) < r.seq.length)) s.adapterHits++;
}

export interface StatsSummary {
  reads: number; bases: number; meanLength: number; gcPct: number; q20Pct: number; q30Pct: number;
  nCount: number; adapterHitPct: number;
  posMean: number[]; // NaN when no read reaches this position
  lengthHist: { length: number; count: number }[];
}

export function statsSummary(s: StatsAcc): StatsSummary {
  // GC is computed over called bases (A/C/G/T); N is excluded from the denominator.
  const called = s.bases - s.n;
  const posMean = s.posSum.map((v, i) => (s.posN[i] ? v / s.posN[i] : NaN));
  while (posMean.length && Number.isNaN(posMean[posMean.length - 1])) posMean.pop();
  return {
    reads: s.reads, bases: s.bases, meanLength: s.reads ? s.bases / s.reads : 0,
    gcPct: called ? (100 * s.gc) / called : 0,
    q20Pct: s.bases ? (100 * s.q20) / s.bases : 0,
    q30Pct: s.bases ? (100 * s.q30) / s.bases : 0,
    nCount: s.n, adapterHitPct: s.reads ? (100 * s.adapterHits) / s.reads : 0,
    posMean,
    lengthHist: [...s.lengthHist.entries()].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count })),
  };
}

export function statsOf(records: Iterable<FastqRecord>): StatsSummary {
  const s = newStats();
  for (const r of records) addRecord(s, r);
  return statsSummary(s);
}

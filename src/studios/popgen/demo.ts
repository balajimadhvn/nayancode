/**
 * Seeded demo data for the Population Genetics Studio. The genotype-table demo is a small Balding–Nichols
 * simulation (two source populations plus admixed individuals), so the Fst, PCA and admixture tabs all have
 * something realistic to show without any download.
 */
import { mulberry32 } from './stats';

/** Marsaglia–Tsang gamma sampler (shape > 0); shape < 1 uses the usual boost. */
export function gammaSample(rnd: () => number, shape: number): number {
  if (shape < 1) return gammaSample(rnd, shape + 1) * Math.pow(rnd(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0, v = 0;
    do { x = normalSample(rnd); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function normalSample(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function betaSample(rnd: () => number, a: number, b: number): number {
  const x = gammaSample(rnd, a), y = gammaSample(rnd, b);
  return x / (x + y);
}

export interface DemoGenotypes {
  text: string;
  populations: string[];
  alpha: number[];
  sampleNames: string[];
  populationOf: string[];
}

/** Two source populations at a chosen Fst plus admixed individuals (each allele from source A with probability α). */
export function demoGenotypes(opts: { seed?: number; loci?: number; perPop?: number; admixed?: number; fst?: number } = {}): DemoGenotypes {
  const seed = opts.seed ?? 20261023, loci = opts.loci ?? 400, perPop = opts.perPop ?? 60, nAdm = opts.admixed ?? 20, fst = opts.fst ?? 0.1;
  const rnd = mulberry32(seed);
  const names: string[] = [];
  for (let i = 0; i < perPop; i++) names.push(`A${String(i + 1).padStart(3, '0')}`);
  for (let i = 0; i < perPop; i++) names.push(`B${String(i + 1).padStart(3, '0')}`);
  for (let i = 0; i < nAdm; i++) names.push(`M${String(i + 1).padStart(3, '0')}`);
  const populationOf = [...Array(perPop).fill('Population A'), ...Array(perPop).fill('Population B'), ...Array(nAdm).fill('Admixed')];
  const alpha = Array.from({ length: nAdm }, () => 0.2 + 0.6 * rnd());
  const n = names.length;
  const cols: string[][] = names.map(() => []);

  for (let j = 0; j < loci; j++) {
    const p = 0.1 + 0.8 * rnd();
    const a = (p * (1 - fst)) / fst, b = ((1 - p) * (1 - fst)) / fst;
    const pA = betaSample(rnd, a, b), pB = betaSample(rnd, a, b);
    const draw = (q: number) => (rnd() < q ? 1 : 0) + (rnd() < q ? 1 : 0);
    for (let i = 0; i < perPop; i++) cols[i].push(String(draw(pA)));
    for (let i = 0; i < perPop; i++) cols[perPop + i].push(String(draw(pB)));
    for (let i = 0; i < nAdm; i++) cols[2 * perPop + i].push(String(draw(alpha[i] * pA + (1 - alpha[i]) * pB)));
  }

  const head = ['sample', 'population', ...Array.from({ length: loci }, (_, j) => `snp${j + 1}`)];
  const lines = [head.join('\t')];
  for (let i = 0; i < n; i++) lines.push([names[i], populationOf[i], ...cols[i]].join('\t'));
  return { text: lines.join('\n'), populations: ['Population A', 'Population B', 'Admixed'], alpha, sampleNames: names, populationOf };
}

/** A 600-bp alignment of eight sequences with a high-diversity middle block, for the diversity tab. */
export function demoAlignment(seed = 4242): { text: string; sequences: string[] } {
  const rnd = mulberry32(seed), length = 600, n = 8;
  const base = Array.from({ length }, () => 'ACGT'[Math.floor(rnd() * 4)]);
  const seqs: string[] = [];
  for (let i = 0; i < n; i++) {
    const chars = base.slice();
    for (let j = 0; j < length; j++) {
      const rate = j >= 220 && j < 380 ? 0.09 : 0.02;
      if (rnd() < rate) chars[j] = 'ACGT'[Math.floor(rnd() * 4)];
    }
    seqs.push(chars.join(''));
  }
  const text = seqs.map((s, i) => `>sample_${i + 1}\n${s}`).join('\n');
  return { text, sequences: seqs };
}

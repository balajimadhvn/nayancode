/** Synthetic demo: 2,000 genes, 20 sets and a ranked list in which three sets are planted near the top. */
import type { GeneSet, RankedGene } from './gmt';

const N = 2000;
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoData {
  genes: string[];
  sets: GeneSet[];
  ranked: RankedGene[];
  gmtText: string;
  listText: string;
  rankedText: string;
}

export function demoData(): DemoData {
  const rnd = mulberry32(20261026);
  const genes = Array.from({ length: N }, (_, i) => `GENE${String(i + 1).padStart(4, '0')}`);
  const normal = () => {
    const u = Math.max(1e-12, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const scores = new Map(genes.map((g) => [g, normal()]));
  const ranked = [...genes].sort((a, b) => scores.get(b)! - scores.get(a)! || a.localeCompare(b)).map((g) => ({ gene: g, score: scores.get(g)! }));
  const top = ranked.slice(0, 100).map((r) => r.gene);
  const shuffle = (a: string[]) => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  };
  const pick = (pool: string[], n: number) => shuffle(pool).slice(0, n).sort();

  const planted: GeneSet[] = [
    { name: 'PLANTED_CELL_CYCLE', description: 'synthetic set planted near the top of the ranked list', genes: pick(top, 30) },
    { name: 'PLANTED_DNA_REPAIR', description: 'synthetic set planted near the top of the ranked list', genes: pick(top, 30) },
    { name: 'PLANTED_IMMUNE_RESPONSE', description: 'synthetic set planted near the top of the ranked list', genes: pick(top, 30) },
  ];
  const random: GeneSet[] = Array.from({ length: 17 }, (_, i) => ({
    name: `RANDOM_SET_${String(i + 1).padStart(2, '0')}`,
    description: 'synthetic random set (not enriched)',
    genes: pick(genes, 40),
  }));
  const sets = [...planted, ...random];

  const list = ranked.slice(0, 100).map((r) => r.gene);
  return {
    genes, sets, ranked,
    gmtText: sets.map((s) => [s.name, s.description, ...s.genes].join('\t')).join('\n'),
    listText: list.join('\n'),
    rankedText: ['gene\tscore', ...ranked.map((r) => `${r.gene}\t${r.score.toFixed(6)}`)].join('\n'),
  };
}

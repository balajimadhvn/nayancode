import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseFastaCodes, parseGenes, type Genome } from '@/studios/genome/genomeData';

const genomes = new Map<string, Genome>();
/** Loads a bundled genome straight from public/genomes (what the browser downloads), decompressed with zlib. */
export function loadGenome(id: string): Genome {
  let g = genomes.get(id);
  if (!g) { const rd = (f: string) => gunzipSync(readFileSync(`public/genomes/${f}`)).toString(); g = { id, name: id, contigs: parseFastaCodes(rd(`${id}.fna.gz`)), genes: parseGenes(rd(`${id}.gff3.gz`)) }; genomes.set(id, g); }
  return g;
}
export const guides = JSON.parse(readFileSync('benchmarks/genome-tools/reference/guides.json', 'utf8')) as Record<string, { cas9: string[]; cas12a: string[] }>;
export const readTsv = (f: string) => gunzipSync(readFileSync(`benchmarks/genome-tools/reference/${f}`)).toString().split('\n').filter(Boolean).map((l) => l.split('\t'));
export const sorted = <T>(a: Iterable<T>) => [...a].sort();

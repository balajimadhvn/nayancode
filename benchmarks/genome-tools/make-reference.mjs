// Generates the Cas-OFFinder reference results for the CRISPR off-target benchmark (benchmarks/genome-tools/crispr.bench.test.ts).
// Cas-OFFinder (BSD-3-Clause; Bae, Park & Kim 2014, Bioinformatics 30:1473) is run natively here and is never shipped.
//
//   conda create -p ./cas-env -c conda-forge -c bioconda cas-offinder pocl     # Cas-OFFinder 2.4.1 with a CPU OpenCL runtime
//   CAS_OFFINDER=./cas-env/bin/cas-offinder node benchmarks/genome-tools/make-reference.mjs
//
// For every bundled genome it samples guides (real protospacers followed by a PAM, plus random 20-mers, fixed seed), writes
// reference/guides.json, and stores Cas-OFFinder's hits (≤ 4 mismatches, PAM NRG for SpCas9, TTTV for Cas12a) as reference/<genome>.<nuclease>.tsv.gz (plus a 6-mismatch stress run, cas9-mm6).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url)), root = here('../../');
const CAS = process.env.CAS_OFFINDER ?? 'cas-offinder', DEVICE = process.env.CAS_DEVICE ?? 'C', MM = 4;
const CAS9 = ['lambda', 't7', 'ecoli-k12', 'bsubtilis-168', 'mtb-h37rv', 'saureus-8325', 'scer-s288c'], CAS12 = ['ecoli-k12', 'scer-s288c'];
const rng = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const rc = (s) => [...s].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c] ?? 'N').join('');
mkdirSync(here('.cache-genomes'), { recursive: true }); mkdirSync(here('reference'), { recursive: true });
const guides = {};
for (const id of new Set([...CAS9, ...CAS12])) {
  const fa = gunzipSync(readFileSync(`${root}public/genomes/${id}.fna.gz`)).toString(); writeFileSync(here(`.cache-genomes/${id}.fa`), fa);
  const seq = fa.split('>').slice(1)[0].split('\n').slice(1).join('').toUpperCase().replace(/[^ACGT]/g, 'N'), r = rng([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const pick = (len, pamRe, side, n) => { const out = []; while (out.length < n) { const i = Math.floor(r() * (seq.length - 40)), s = r() < 0.5 ? seq.slice(i, i + 40) : rc(seq.slice(i, i + 40)); if (side === 3 ? pamRe.test(s.slice(len, len + 3)) : pamRe.test(s.slice(0, 4))) { const g = side === 3 ? s.slice(0, len) : s.slice(4, 4 + len); if (!/N/.test(g) && !out.includes(g)) out.push(g); } } return out; };
  const randoms = Array.from({ length: 4 }, () => Array.from({ length: 20 }, () => 'ACGT'[Math.floor(r() * 4)]).join(''));
  guides[id] = { cas9: CAS9.includes(id) ? [...pick(20, /^[ACGT]GG$/, 3, 20), ...randoms] : [], cas12a: CAS12.includes(id) ? pick(23, /^TTT[ACG]$/, 5, 16) : [] };
}
writeFileSync(here('reference/guides.json'), JSON.stringify(guides, null, 1));
const run = (id, nuc, list, pattern, mm = MM, tag = nuc) => {
  const input = here(`.cache-genomes/${id}.${nuc}.in`), output = here(`.cache-genomes/${id}.${nuc}.out`);
  writeFileSync(input, [here(`.cache-genomes/${id}.fa`), pattern, ...list.map((g) => `${nuc === 'cas9' ? g + 'NNN' : 'NNNN' + g} ${mm}`)].join('\n') + '\n');
  const t0 = Date.now(); execFileSync(CAS, [input, DEVICE, output], { stdio: 'ignore' });
  const out = readFileSync(output); writeFileSync(here(`reference/${id}.${tag}.tsv.gz`), gzipSync(out));
  console.log(`${id} ${tag}: ${list.length} guides, ${out.toString().trim().split('\n').filter(Boolean).length} hits, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
};
for (const id of CAS9) run(id, 'cas9', guides[id].cas9, 'N'.repeat(20) + 'NRG');
for (const id of CAS12) run(id, 'cas12a', guides[id].cas12a, 'TTTV' + 'N'.repeat(23));
// Stress test of the mismatch logic: up to 6 mismatches (thousands of hits) for the first 8 E. coli guides.
run('ecoli-k12', 'cas9', guides['ecoli-k12'].cas9.slice(0, 8), 'N'.repeat(20) + 'NRG', 6, 'cas9-mm6');
writeFileSync(here('reference/VERSION.txt'), execFileSync(CAS, [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().split('\n')[0] + '\n');

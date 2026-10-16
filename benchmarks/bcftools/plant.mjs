// Builds the benchmark reference: E. coli REL606 with known edits planted, so that real reads (which carry the
// original sequence) show a known set of differences against it. Deterministic (fixed seed).
//   node benchmarks/bcftools/plant.mjs <REL606.fa> <out.fa> <truth.json>
// Truth is in VCF terms against the edited reference (1-based POS, REF/ALT as the reads will show them).
import { readFileSync, writeFileSync } from 'node:fs';

export function plant(fasta, { snvs = 150, dels = 40, ins = 40, seed = 20261015, minGap = 2000 } = {}) {
  const lines = fasta.split(/\r?\n/), header = lines[0], seq = lines.slice(1).join('').toUpperCase();
  let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const B = 'ACGT', n = snvs + dels + ins, pos = new Set();
  while (pos.size < n) { const p = 5000 + Math.floor(rnd() * (seq.length - 10000)); if ([...pos].every((q) => Math.abs(q - p) >= minGap) && !/N/.test(seq.slice(p - 20, p + 30))) pos.add(p); }
  const sites = [...pos].sort((a, b) => a - b), kinds = sites.map((_, i) => (i < snvs ? 'snv' : i < snvs + dels ? 'del' : 'ins'));
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let out = '', last = 0, shift = 0; const truth = [];
  sites.forEach((p, i) => {
    out += seq.slice(last, p); const mp = p + shift; // 0-based position of this site in the edited reference
    if (kinds[i] === 'snv') { const b = seq[p], nb = B[(B.indexOf(b) + 1 + Math.floor(rnd() * 3)) % 4]; out += nb; last = p + 1; truth.push({ type: 'snv', pos: mp + 1, ref: nb, alt: b }); }
    else if (kinds[i] === 'del') { // remove k bases after the anchor: the reads show an insertion
      const k = 1 + Math.floor(rnd() * 10), anchor = seq[p], gone = seq.slice(p + 1, p + 1 + k); out += anchor; last = p + 1 + k; shift -= k; truth.push({ type: 'ins', pos: mp + 1, ref: anchor, alt: anchor + gone }); }
    else { // insert k random bases after the anchor: the reads show a deletion
      const k = 1 + Math.floor(rnd() * 10), anchor = seq[p], add = Array.from({ length: k }, () => B[Math.floor(rnd() * 4)]).join(''); out += anchor + add; last = p + 1; shift += k; truth.push({ type: 'del', pos: mp + 1, ref: anchor + add, alt: anchor }); }
  });
  out += seq.slice(last);
  const id = header.slice(1).split(/\s/)[0];
  return { fasta: `>${id} REL606 with ${n} planted edits (benchmark)\n${out.replace(/(.{80})/g, '$1\n')}\n`, truth: truth.map((t) => ({ chrom: id, ...t })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, outFa, outTruth] = process.argv.slice(2);
  const r = plant(readFileSync(src, 'utf8'));
  writeFileSync(outFa, r.fasta); writeFileSync(outTruth, JSON.stringify(r.truth, null, 1) + '\n');
  console.log(`${r.truth.length} planted edits -> ${outFa}`);
}

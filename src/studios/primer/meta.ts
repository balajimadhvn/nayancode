import type { ToolInfo } from '@/core/provenance';

export const DESIGN_TOOL: ToolInfo = {
  id: 'primer.design', name: 'PCR primer-pair design', version: '0.1.0',
  engine: 'TypeScript (candidate enumeration, SantaLucia nearest-neighbour Tm, heuristic dimer checks)',
  citations: ['santalucia1998'],
  describe: (p) => `Primer pairs were enumerated around ${p.targetStart}–${p.targetEnd} of a ${Number(p.templateLen).toLocaleString()}-bp template (forward starts up to 150 bp upstream, reverse ends up to 150 bp downstream), keeping Tm ${p.tmMin}–${p.tmMax} °C, length ${p.lenMin}–${p.lenMax} nt, GC ${p.gcMin}–${p.gcMax} %, |ΔTm| ≤ ${p.maxTmDiff} °C and no high-risk dimer; pairs were ranked by Tm difference plus a GC penalty.`,
};

export const PCR_TOOL: ToolInfo = {
  id: 'primer.insilico-pcr', name: 'In-silico PCR', version: '0.1.0',
  engine: 'TypeScript (ungapped both-strand site search, exact 3′ end)',
  citations: [],
  describe: (p) => `Primer binding sites were searched on both strands with at most ${p.maxMm} mismatches and an exact ${p.min3}-nt 3′ end; forward sites were paired with downstream reverse sites up to ${Number(p.maxSize).toLocaleString()} bp apart.`,
};

export const CHECK_TOOL: ToolInfo = {
  id: 'primer.check', name: 'Primer checks', version: '0.1.0',
  engine: 'TypeScript (hairpin/dimer runs, GC clamp, homopolymer; no free energies)',
  citations: ['santalucia1998'],
  describe: (p) => `${p.count} primer(s) were checked for hairpins (stem ≥ 4 nt, loop ≥ 3 nt), self- and pair-dimers (consecutive Watson–Crick runs), GC clamp in the last five bases and homopolymer runs; Tm uses the SantaLucia nearest-neighbour model.`,
};

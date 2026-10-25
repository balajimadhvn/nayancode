import type { ToolInfo } from '@/core/provenance';

export const ORA_TOOL: ToolInfo = {
  id: 'enrich.ora', name: 'Over-representation analysis', version: '0.1.0',
  engine: 'TypeScript (log-space hypergeometric upper tail, Benjamini-Hochberg FDR)',
  citations: [],
  describe: (p) => `${p.list} gene(s) were tested against ${p.sets} gene set(s) with ${p.background ? 'a user-supplied' : 'the union of the sets as the'} background (${Number(p.universe).toLocaleString()} genes); p values are the hypergeometric upper tail and q values are Benjamini-Hochberg across the tested sets.`,
};

export const GSEA_TOOL: ToolInfo = {
  id: 'enrich.gsea', name: 'Pre-ranked GSEA', version: '0.1.0',
  engine: 'TypeScript worker (weighted running sum, seeded phenotype-free gene-set permutations)',
  citations: ['subramanian2005'],
  describe: (p) => `A pre-ranked list of ${Number(p.ranked).toLocaleString()} genes was tested against ${p.sets} gene set(s) with the Subramanian weighted running sum (weight ${p.weight}); significance used ${p.perms} seeded gene-set permutations and Benjamini-Hochberg FDR.`,
};

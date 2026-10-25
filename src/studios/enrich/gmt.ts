/** Gene-set and ranked-list parsing. Gene symbols compare upper-case; no database is bundled. */

export interface GeneSet { name: string; description: string; genes: string[] }
export interface RankedGene { gene: string; score: number }

/** GMT: `name<TAB>description<TAB>gene1<TAB>gene2...`; blank lines are ignored and genes de-duplicated. */
export function parseGmt(text: string): GeneSet[] {
  const out: GeneSet[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const f = raw.split('\t');
    if (f.length < 3) continue;
    const name = f[0].trim();
    if (!name) continue;
    const genes = [...new Set(f.slice(2).map((g) => g.trim().toUpperCase()).filter(Boolean))];
    out.push({ name, description: (f[1] ?? '').trim(), genes });
  }
  return out;
}

/** Genes split on whitespace, commas or semicolons; unique, upper-case. */
export function parseGeneList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((g) => g.trim().toUpperCase()).filter(Boolean))];
}

/**
 * Ranked list: one `gene<TAB|comma>score` pair per line. A header row whose score is not a number is
 * skipped. Sorted descending; a duplicate gene keeps its first score.
 */
export function parseRanked(text: string): RankedGene[] {
  const seen = new Set<string>();
  const rows: RankedGene[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const f = line.split(/[\t,]/);
    if (f.length < 2) continue;
    const gene = f[0].trim().toUpperCase();
    const score = Number(f[1].trim());
    if (!gene || !Number.isFinite(score) || seen.has(gene)) continue;
    seen.add(gene);
    rows.push({ gene, score });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

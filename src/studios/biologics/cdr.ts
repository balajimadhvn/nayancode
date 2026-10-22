/** Heuristic, rule-based Kabat-style CDR identification for VH and VL domains.
 *
 * There is no numbering database here: the positions come from the conserved
 * anchors (first Cys, the W[VIA]R / W[YF]Q motifs and the J-region W[GA][QRKH]G /
 * F[GA][QGSAT]G motifs). The rules reproduce the Kabat CDRs of trastuzumab and
 * adalimumab exactly (see cdr.test.ts).
 */

export interface Cdrs {
  chain: 'H' | 'L' | null;
  cdr1: string;
  cdr2: string;
  cdr3: string;
  cdr1Pos: [number, number];
  cdr2Pos: [number, number];
  cdr3Pos: [number, number];
  error?: string;
}

const empty = (): Cdrs => ({ chain: null, cdr1: '', cdr2: '', cdr3: '', cdr1Pos: [0, 0], cdr2Pos: [0, 0], cdr3Pos: [0, 0] });

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

/** Last match of `re` in `s` that ends at or before `limit`. */
function lastMatchBefore(s: string, re: RegExp, limit: number): RegExpMatchArray | null {
  const g = new RegExp(re.source, 'g');
  let best: RegExpMatchArray | null = null, m: RegExpExecArray | null;
  while ((m = g.exec(s))) {
    if (m.index + m[0].length <= limit) best = m;
    if (m[0] === '') g.lastIndex++;
  }
  return best;
}

/** Finds the Kabat CDRs of one VH or VL domain (cleaned of non-letters). */
export function findCdrs(input: string): Cdrs {
  const seq = clean(input);
  const heavyAnchors = /W[VIA]R/.test(seq) && /W[GA][QRKH]G/.test(seq);
  const lightAnchors = /W[YF]Q/.test(seq) && /F[GA][QGSAT]G/.test(seq);
  const out = empty();

  if (heavyAnchors) {
    const cys = seq.indexOf('C');
    const m1 = seq.match(/W[VIA]R/);
    const j = seq.match(/W[GA][QRKH]G/);
    if (cys >= 0 && m1 && j) {
      const w = m1.index!;
      const cdr1 = seq.slice(cys + 9, w);
      const h2Start = w + 14;
      const tail = seq.slice(h2Start + 15);
      const m2 = tail.match(/[RK][LIVFTA][TSIAN]/);
      if (m2) {
        const cdr2End = h2Start + 15 + m2.index!;
        const cdr3m = lastMatchBefore(seq, /Y[YFH]C[A-Z]{1,2}/, j.index!);
        if (cdr3m && cdr1.length && cdr2End > h2Start) {
          const cdr3Start = cdr3m.index! + cdr3m[0].length;
          return {
            chain: 'H', cdr1, cdr2: seq.slice(h2Start, cdr2End), cdr3: seq.slice(cdr3Start, j.index!),
            cdr1Pos: [cys + 10, w], cdr2Pos: [h2Start + 1, cdr2End], cdr3Pos: [cdr3Start + 1, j.index!],
          };
        }
      }
    }
  }
  if (lightAnchors) {
    const m = seq.match(/[VIAL][TS]C/);
    const wq = seq.match(/W[YF]Q/);
    const j = seq.match(/F[GA][QGSAT]G/);
    if (m && wq && j) {
      const l1Start = m.index! + m[0].length, w = wq.index!;
      const l3m = lastMatchBefore(seq, /[YF][YF]C/, j.index!);
      if (l3m) {
        const l3Start = l3m.index! + l3m[0].length;
        return {
          chain: 'L', cdr1: seq.slice(l1Start, w), cdr2: seq.slice(w + 15, w + 22), cdr3: seq.slice(l3Start, j.index!),
          cdr1Pos: [l1Start + 1, w], cdr2Pos: [w + 16, w + 22], cdr3Pos: [l3Start + 1, j.index!],
        };
      }
    }
  }
  return { ...out, error: 'Not recognised as a VH or VL domain' };
}

/** Splits a scFv at a run of at least two GGGGS linkers; otherwise returns the input as one domain. */
export function splitScFv(seq: string): { a: string; b: string } | null {
  const s = clean(seq);
  const m = /(GGGGS){2,}/.exec(s);
  if (!m) return null;
  return { a: s.slice(0, m.index), b: s.slice(m.index! + m[0].length) };
}

/** Analyses a chain or a scFv (splitting the linker first). */
export function analyseChains(input: string): { label: string; seq: string; cdr: Cdrs }[] {
  const s = clean(input);
  if (!s) return [];
  const split = splitScFv(s);
  if (split) return [{ label: 'Chain 1', seq: split.a, cdr: findCdrs(split.a) }, { label: 'Chain 2', seq: split.b, cdr: findCdrs(split.b) }];
  return [{ label: 'Chain', seq: s, cdr: findCdrs(s) }];
}

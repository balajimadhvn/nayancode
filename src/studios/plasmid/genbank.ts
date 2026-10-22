/** Minimal GenBank reader/writer for the Plasmid Studio.
 *
 * Handles what real plasmid files use: `complement(...)`, `join(...)` (outer
 * span and strand), `<`/`>` partial markers, qualifiers continued over several
 * lines and ORIGIN blocks. Anything more exotic is reduced to its outer span.
 */

export interface Feature {
  type: string;
  /** 1-based inclusive. For a feature crossing the origin, `end` may exceed the sequence length. */
  start: number;
  end: number;
  strand: 1 | -1;
  label: string;
  qualifiers: Record<string, string>;
  /** True when the feature crosses the origin of a circular plasmid. */
  wraps?: boolean;
  /** Identity of an annotated hit (0–1); absent on hand-typed features. */
  identity?: number;
  /** Coverage of the library element (0–1). */
  coverage?: number;
}

export interface Plasmid {
  name: string;
  topology: 'circular' | 'linear';
  seq: string;
  features: Feature[];
}

/** Extracts the outer span and strand of a GenBank location expression. */
export function parseLocation(loc: string): { start: number; end: number; strand: 1 | -1 } {
  const strand: 1 | -1 = /complement/i.test(loc) ? -1 : 1;
  const clean = loc.replace(/complement|join|order|group/gi, '').replace(/[<>]/g, '');
  const ranges = [...clean.matchAll(/(\d+)\s*(?:\.\.\s*(\d+))?/g)];
  if (!ranges.length) throw new Error(`Unreadable feature location "${loc}".`);
  const starts = ranges.map((m) => Number(m[1])), ends = ranges.map((m) => (m[2] ? Number(m[2]) : Number(m[1])));
  return { start: Math.min(...starts), end: Math.max(...ends), strand };
}

/** Parses a GenBank flat file into a plasmid. */
export function parseGenBank(text: string): Plasmid {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let name = 'plasmid', topology: 'circular' | 'linear' = 'circular';
  const locus = lines.find((l) => /^LOCUS/.test(l));
  if (locus) {
    const parts = locus.trim().split(/\s+/);
    name = parts[1] || name;
    if (/\blinear\b/i.test(locus)) topology = 'linear';
    else if (/\bcircular\b/i.test(locus)) topology = 'circular';
  }
  // FEATURES block
  const features: Feature[] = [];
  const fi = lines.findIndex((l) => /^FEATURES/.test(l));
  if (fi >= 0) {
    let cur: { type: string; loc: string; quals: Record<string, string>; last?: string } | null = null;
    const flush = () => {
      if (!cur) return;
      try {
        const { start, end, strand } = parseLocation(cur.loc);
        const label = cur.quals.label ?? cur.quals.gene ?? cur.quals.product ?? cur.quals.note ?? cur.type;
        features.push({ type: cur.type, start, end, strand, label, qualifiers: { ...cur.quals } });
      } catch { /* skip unreadable locations rather than failing the whole file */ }
      cur = null;
    };
    for (let i = fi + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^ORIGIN/.test(line)) break;
      if (/^[A-Z]/.test(line)) break; // next top-level section
      const key = line.match(/^ {5}(\S+)\s+(.*)$/);
      if (key) {
        flush();
        cur = { type: key[1], loc: key[2].trim(), quals: {} };
        continue;
      }
      if (!cur) continue;
      const q = line.match(/^ {21}\/([A-Za-z_]+)(?:=(.*))?$/);
      if (q) {
        const k = q[1];
        let v = (q[2] ?? '').trim();
        if (v.startsWith('"') && !v.endsWith('"')) cur.last = k; // value continues on the next line
        else v = v.replace(/^"|"$/g, '');
        cur.quals[k] = v;
        continue;
      }
      const cont = line.match(/^ {21}(\S.*)$/);
      if (cont) {
        if (cur.last) {
          const k = cur.last;
          let v = (cur.quals[k] + ' ' + cont[1].trim()).trim();
          if (v.endsWith('"')) { cur.quals[k] = v.replace(/"$/, ''); cur.last = undefined; }
          else cur.quals[k] = v;
        } else if (!cur.quals.label && /^\/?[A-Za-z]/.test(cont[1])) {
          // continuation of the location itself (long join expressions)
          cur.loc += cont[1].trim();
        }
      }
    }
    flush();
  }
  // ORIGIN
  const oi = lines.findIndex((l) => /^ORIGIN/.test(l));
  if (oi < 0) throw new Error('No ORIGIN section: this is not a GenBank nucleotide file.');
  let seq = '';
  for (let i = oi + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\/\//.test(l)) break;
    seq += l.replace(/[\d\s]/g, '').toUpperCase();
  }
  if (!seq) throw new Error('The ORIGIN section is empty.');
  return { name, topology, seq, features };
}

/** Writes a minimal, valid GenBank file (features without qualifier quoting beyond /label). */
export function toGenBank(p: Plasmid): string {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '-').toUpperCase();
  const out: string[] = [];
  out.push(`LOCUS       ${p.name.slice(0, 16).padEnd(16)} ${String(p.seq.length).padStart(11)} bp    DNA     ${p.topology} SYN ${date}`);
  out.push(`DEFINITION  ${p.name}.`);
  out.push('FEATURES             Location/Qualifiers');
  for (const f of p.features) {
    const loc = `${f.strand === -1 ? 'complement(' : ''}${f.start}..${f.end}${f.strand === -1 ? ')' : ''}`;
    out.push(`     ${f.type.padEnd(15)} ${loc}`);
    if (f.label) out.push(`                     /label="${f.label.replace(/"/g, "'")}"`);
    for (const [k, v] of Object.entries(f.qualifiers)) if (k !== 'label') out.push(`                     /${k}="${String(v).replace(/"/g, "'")}"`);
  }
  out.push('ORIGIN');
  for (let i = 0; i < p.seq.length; i += 60) {
    const row = p.seq.slice(i, i + 60).toLowerCase().match(/.{1,10}/g)?.join(' ') ?? '';
    out.push(`${String(i + 1).padStart(9)} ${row}`);
  }
  out.push('//');
  return out.join('\n') + '\n';
}

/** Reads a FASTA file as a plasmid (linear unless the header says circular). */
export function parseFastaPlasmid(text: string): Plasmid {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const hi = lines.findIndex((l) => l.startsWith('>'));
  if (hi < 0) throw new Error('No FASTA header found.');
  const header = lines[hi].slice(1).trim();
  const name = header.split(/\s+/)[0] || 'plasmid';
  const seq = lines.slice(hi + 1).join('').replace(/[\d\s]/g, '').toUpperCase();
  if (!seq) throw new Error('The FASTA sequence is empty.');
  if (!/^[ACGTN]+$/.test(seq)) throw new Error('The FASTA sequence contains non-nucleotide characters.');
  const topology: 'circular' | 'linear' = /circular|plasmid|vector/i.test(header) ? 'circular' : 'linear';
  return { name, topology, seq, features: [] };
}

/** Case-insensitive lookup of a feature by label. */
export const featureByLabel = (p: Plasmid, label: string) => p.features.find((f) => f.label.toLowerCase() === label.toLowerCase());

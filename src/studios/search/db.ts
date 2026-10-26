/**
 * FASTA database parsing and the synthetic demo database.
 * Sequences are encoded once to BLOSUM62 codes so the CPU and GPU kernels use
 * the same integer input; user data never leaves the browser.
 */
import { parseFasta } from '@/studios/sequence/kernels';
import { mulberry32 } from '@/compute/gpuBench';
import { encodeResidues } from './sw';

export const MAX_SEQUENCES = 300_000;
export const MAX_BYTES = 150 * 1024 * 1024;

export interface DbSeq { id: string; description: string; seq: string; codes: Uint8Array; length: number }
export interface Db { seqs: DbSeq[]; residues: number; bytes: number; skipped: number }

/** Parse a protein FASTA file. Empty records are skipped and counted; huge inputs fail clearly. */
export function parseDb(fastaText: string): Db {
  const bytes = new TextEncoder().encode(fastaText).length;
  if (bytes > MAX_BYTES) throw new Error(`Database is ${(bytes / 1024 / 1024).toFixed(0)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB. Split it or use a smaller database.`);
  let headers = 0;
  for (const line of fastaText.split(/\r?\n/)) if (line.startsWith('>')) headers++;
  if (headers > MAX_SEQUENCES) throw new Error(`Database has ${headers.toLocaleString()} sequences; the limit is ${MAX_SEQUENCES.toLocaleString()}.`);
  const records = parseFasta(fastaText);
  if (records.length > MAX_SEQUENCES) throw new Error(`Database has ${records.length.toLocaleString()} sequences; the limit is ${MAX_SEQUENCES.toLocaleString()}.`);
  const seqs: DbSeq[] = records.map((r) => ({ id: r.id, description: r.description, seq: r.seq, codes: encodeResidues(r.seq), length: r.seq.length }));
  let residues = 0;
  for (const s of seqs) residues += s.length;
  const out: Db = { seqs, residues, bytes, skipped: Math.max(0, headers - seqs.length) };
  if (seqs.length === 0) throw new Error('No protein sequences were found in the FASTA file.');
  return out;
}

const AA = 'ACDEFGHIKLMNPQRSTVWY';

/**
 * Demo: 2,000 SYNTHETIC proteins (50-600 residues) plus five members of a
 * planted family, each 30 % substituted from the 300-residue query. Seeded, so
 * every visitor sees the same database and the same planted answer.
 */
export function demoDatabase(seed = 20261026, nSeq = 2000, queryLen = 300): { query: string; db: Db; familyIds: string[] } {
  const rnd = mulberry32(seed);
  const pick = () => AA[Math.floor(rnd() * AA.length)];
  const query = Array.from({ length: queryLen }, pick).join('');
  const mutate = (s: string) => {
    let out = '';
    for (const c of s) out += rnd() < 0.3 ? pick() : c;
    return out;
  };
  const familyIds: string[] = [];
  const rows: { id: string; seq: string }[] = [];
  for (let k = 0; k < 5; k++) {
    const id = `PLANTED_${k + 1}`;
    familyIds.push(id);
    rows.push({ id, seq: mutate(query) });
  }
  for (let i = rows.length; i < nSeq; i++) {
    const len = 50 + Math.floor(rnd() * 551);
    rows.push({ id: `SYNTH_${String(i + 1).padStart(4, '0')}`, seq: Array.from({ length: len }, pick).join('') });
  }
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const seqs: DbSeq[] = rows.map((r) => ({ id: r.id, description: 'SYNTHETIC demo protein', seq: r.seq, codes: encodeResidues(r.seq), length: r.seq.length }));
  let residues = 0;
  for (const s of seqs) residues += s.length;
  const db: Db = { seqs, residues, bytes: residues + 8 * seqs.length + queryLen, skipped: 0 };
  return { query, db, familyIds };
}

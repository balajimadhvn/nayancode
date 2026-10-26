import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readFastq, readPairs, type FastqRecord } from './fastq';

const RECS: FastqRecord[] = [
  { id: 'r1', desc: 'first', seq: 'ACGTACGT', qual: 'IIIIIIII' },
  { id: 'r2', desc: '', seq: 'TTTTGGCC', qual: '########' },
];
const text = RECS.map((r) => `@${r.id}${r.desc ? ' ' + r.desc : ''}\n${r.seq}\n+\n${r.qual}`).join('\n') + '\n';

async function collect(file: File) {
  const out: FastqRecord[] = [];
  for await (const r of readFastq(file)) out.push(r);
  return out;
}

describe('readFastq', () => {
  it('reads plain and gzipped FASTQ identically', async () => {
    const plain = await collect(new File([text], 'reads.fastq'));
    const gz = await collect(new File([gzipSync(text)], 'reads.fastq.gz'));
    expect(plain).toEqual(RECS);
    expect(gz).toEqual(RECS);
  });

  it('accepts CRLF line endings', async () => {
    const crlf = text.replace(/\n/g, '\r\n');
    expect(await collect(new File([crlf], 'crlf.fastq'))).toEqual(RECS);
  });

  it('names the record when sequence and quality lengths differ', async () => {
    const bad = '@r1\nACGT\n+\nIII\n';
    await expect(collect(new File([bad], 'bad.fastq'))).rejects.toThrow(/Record 1: sequence has 4 bases but the quality line has 3/);
  });

  it('rejects multi-line FASTQ with a clear message', async () => {
    const bad = '@r1\nACGT\nACGT\n+\nIIIIIIII\n';
    await expect(collect(new File([bad], 'multi.fastq'))).rejects.toThrow(/multi-line FASTQ is not supported/);
  });

  it('rejects truncated records', async () => {
    await expect(collect(new File(['@r1\nACGT\n+\n'], 'short.fastq'))).rejects.toThrow(/incomplete FASTQ record/);
  });
});

describe('readPairs', () => {
  it('pairs /1 and /2 ids in lock-step', async () => {
    const a = '@a/1\nACGT\n+\nIIII\n@b/1\nGGGG\n+\nIIII\n';
    const b = '@a/2\nTGCA\n+\nIIII\n@b/2\nCCCC\n+\nIIII\n';
    const out: string[] = [];
    for await (const [x, y] of readPairs(new File([a], 'r1.fastq'), new File([b], 'r2.fastq'))) out.push(`${x.id}:${y.id}`);
    expect(out).toEqual(['a/1:a/2', 'b/1:b/2']);
  });

  it('reports the record number on an id mismatch', async () => {
    const a = '@a/1\nACGT\n+\nIIII\n@b/1\nGGGG\n+\nIIII\n';
    const b = '@a/2\nTGCA\n+\nIIII\n@c/2\nCCCC\n+\nIIII\n';
    const it = readPairs(new File([a], 'r1.fastq'), new File([b], 'r2.fastq'));
    await expect((async () => { for await (const _ of it) void _; })()).rejects.toThrow(/Record 2: read ids do not match/);
  });

  it('reports unequal mate file lengths', async () => {
    const a = '@a/1\nACGT\n+\nIIII\n@b/1\nGGGG\n+\nIIII\n';
    const b = '@a/2\nTGCA\n+\nIIII\n';
    const it = readPairs(new File([a], 'r1.fastq'), new File([b], 'r2.fastq'));
    await expect((async () => { for await (const _ of it) void _; })()).rejects.toThrow(/different lengths/);
  });
});

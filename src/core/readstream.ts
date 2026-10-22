/** Streams sequences from a (possibly gzipped) FASTQ or FASTA File or string without holding the file in memory. */
export interface SeqSource { file?: File; text?: string }
export interface ReadOpts { maxReads?: number; onProgress?(fraction: number, reads: number): void }

async function* lines(src: SeqSource, onBytes?: (n: number) => void): AsyncGenerator<string> {
  if (src.text !== undefined) { for (const l of src.text.split('\n')) yield l.endsWith('\r') ? l.slice(0, -1) : l; return; }
  const f = src.file; if (!f) return;
  const head = new Uint8Array(await f.slice(0, 2).arrayBuffer()), gz = head[0] === 0x1f && head[1] === 0x8b;
  let stream: ReadableStream<Uint8Array> = f.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, c) { onBytes?.(chunk.length); c.enqueue(chunk); } }));
  if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const parts = (rest + (value as unknown as string)).split('\n'); rest = parts.pop() ?? '';
    for (const l of parts) yield l.endsWith('\r') ? l.slice(0, -1) : l;
  }
  if (rest) yield rest;
}

/** Yields read sequences (upper case) from FASTQ (4-line records) or FASTA (multi-line records, joined). Format is detected from the first character. */
export async function* readSequences(src: SeqSource, o: ReadOpts = {}): AsyncGenerator<string> {
  let bytes = 0, n = 0, mode: 'q' | 'a' | '' = '', buf: string[] = [], seq = '';
  const total = src.file?.size ?? 0, tick = () => { if (o.onProgress && n % 5000 === 0) o.onProgress(total ? Math.min(0.99, bytes / total) : 0, n); };
  for await (const l of lines(src, (b) => { bytes += b; })) {
    if (!l) continue;
    if (!mode) { mode = l[0] === '@' ? 'q' : l[0] === '>' ? 'a' : ''; if (!mode) throw new Error('Not FASTQ or FASTA: the first line must start with "@" or ">".'); }
    if (mode === 'q') {
      buf.push(l);
      if (buf.length === 4) { if (buf[0][0] !== '@' || buf[2][0] !== '+') throw new Error(`Not valid FASTQ near read ${n + 1}.`); yield buf[1].toUpperCase(); buf = []; n++; tick(); if (o.maxReads && n >= o.maxReads) return; }
    } else if (l[0] === '>') { if (seq) { yield seq; n++; tick(); if (o.maxReads && n >= o.maxReads) return; } seq = ''; } else seq += l.toUpperCase();
  }
  if (mode === 'a' && seq) yield seq;
}

/** Streaming FASTQ reading (plain or gzip) and Save-to-disk output. */
export interface FastqRecord { id: string; desc: string; seq: string; qual: string }

export const phred = (ch: string) => ch.charCodeAt(0) - 33;

/** 4-line FASTQ lines from a File, with gzip auto-detected from the first two bytes. */
async function* lines(file: File, signal?: AbortSignal): AsyncGenerator<string> {
  let stream = file.stream();
  const head = file.size >= 2 ? new Uint8Array(await file.slice(0, 2).arrayBuffer()) : new Uint8Array();
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress gzip files. Use a plain .fastq file, or a current Chrome, Edge, Firefox or Safari.');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
      }
    }
    if (buffer.length) yield buffer.replace(/\r$/, '');
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Parse one four-line FASTQ record stream. Multi-line FASTQ is rejected explicitly. */
export async function* readFastq(file: File, opts: { signal?: AbortSignal } = {}): AsyncGenerator<FastqRecord> {
  let n = 0, head = '', seq = '', plus = '', qual = '';
  for await (const line of lines(file, opts.signal)) {
    n++;
    switch ((n - 1) % 4) {
      case 0:
        if (!line.startsWith('@')) throw new Error(`Record ${Math.ceil(n / 4)}: expected a header starting with "@".`);
        head = line.slice(1);
        break;
      case 1: seq = line; break;
      case 2:
        if (!line.startsWith('+')) throw new Error(`Record ${Math.ceil(n / 4)}: expected "+" on line 3; multi-line FASTQ is not supported.`);
        plus = line;
        break;
      default: {
        qual = line;
        const record = Math.ceil(n / 4);
        if (seq.length !== qual.length) throw new Error(`Record ${record}: sequence has ${seq.length} bases but the quality line has ${qual.length} characters.`);
        const sp = head.indexOf(' ');
        yield { id: sp < 0 ? head : head.slice(0, sp), desc: sp < 0 ? '' : head.slice(sp + 1).trim(), seq, qual };
        void plus;
      }
    }
  }
  if (n % 4 !== 0) throw new Error(`Record ${Math.floor(n / 4) + 1}: incomplete FASTQ record (${n % 4} of 4 lines).`);
}

const normId = (id: string) => id.replace(/\/[12]$/, '');

/** Paired-end reader in lock-step. Read ids must agree after stripping /1 and /2. */
export async function* readPairs(f1: File, f2: File, opts: { signal?: AbortSignal } = {}): AsyncGenerator<[FastqRecord, FastqRecord]> {
  const a = readFastq(f1, opts), b = readFastq(f2, opts);
  let rec = 0;
  for (;;) {
    const [x, y] = await Promise.all([a.next(), b.next()]);
    if (x.done || y.done) {
      if (x.done !== y.done) throw new Error(`Mate files have different lengths (one ends at record ${rec + 1}).`);
      return;
    }
    rec++;
    if (normId(x.value.id) !== normId(y.value.id)) throw new Error(`Record ${rec}: read ids do not match (${x.value.id} vs ${y.value.id}).`);
    yield [x.value, y.value];
  }
}

export function formatFastq(r: FastqRecord): string {
  return `@${r.id}${r.desc ? ' ' + r.desc : ''}\n${r.seq}\n+\n${r.qual}\n`;
}

export interface Sink { write(text: string): Promise<void>; close(): Promise<void> }

interface WritableLike { getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> } }
interface SaveHandle { createWritable(): Promise<WritableLike> }
type Picker = (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

/**
 * Open an output sink. With the File System Access API (Chrome/Edge) bytes go
 * straight to the chosen file, so multi-GB output never grows in RAM. Other
 * browsers accumulate a Blob and download it when the sink closes.
 */
export async function openSink(name: string, opts: { gzip?: boolean } = {}): Promise<Sink> {
  const gz = !!opts.gzip;
  const picker = (globalThis as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker) {
    const handle = await picker({ suggestedName: name, types: [{ description: gz ? 'Gzipped FASTQ' : 'FASTQ', accept: { 'application/octet-stream': [gz ? '.fastq.gz' : '.fastq'] } }] });
    const w = await handle.createWritable();
    if (!gz) {
      const writer = w.getWriter();
      return { write: (text) => writer.write(new TextEncoder().encode(text)), close: () => writer.close() };
    }
    const cs = new CompressionStream('gzip'), gwriter = cs.writable.getWriter();
    const done = cs.readable.pipeTo(w as unknown as WritableStream<Uint8Array>);
    return { write: (text) => gwriter.write(new TextEncoder().encode(text)), close: async () => { await gwriter.close(); await done; } };
  }
  const chunks: BlobPart[] = [];
  return {
    write: async (text) => { chunks.push(text); },
    close: async () => {
      if (typeof document === 'undefined') return;
      const raw = new Blob(chunks, { type: 'text/plain' });
      let blob = raw;
      if (gz) {
        if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot gzip the output. Save uncompressed FASTQ instead, or use a current Chrome, Edge, Firefox or Safari.');
        blob = await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
      }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

/** Write records through a sink in batches (one write call per `chunk` records). */
export async function writeFastqChunks(records: AsyncIterable<FastqRecord> | Iterable<FastqRecord>, sink: Sink, chunk = 500): Promise<number> {
  let buf = '', n = 0;
  for await (const r of records) {
    buf += formatFastq(r); n++;
    if (n % chunk === 0) { await sink.write(buf); buf = ''; }
  }
  if (buf) await sink.write(buf);
  return n;
}

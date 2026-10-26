import { useEffect, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { detectDevice, detectGpuDetailed, rememberGpu } from '@/compute/device';
import { classifyDevice, recommendedLimits, type Tier } from '@/compute/hardware';
import { parseFasta } from '@/studios/sequence/kernels';
import { Busy, Callout, Card, Field, FileDrop, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { demoDatabase, parseDb, MAX_SEQUENCES, type Db } from './db';
import { bitScore, eValue } from './evalue';
import { encodeResidues } from './sw';
import { createSearchGpu, disposeSearchGpu, runSearchGpu } from './swGpu';
import type { SearchKernels } from './search.worker';
import type { EngineChoice, HitRow, SearchResult } from './SearchStudio';

const remote = createRemote<SearchKernels>(() => new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' }));

const TOOL: ToolInfo = {
  id: 'search.sw', name: 'Smith-Waterman protein search', version: '0.1.0', engine: 'TypeScript + WebGPU',
  citations: ['smith1981', 'gotoh1982', 'altschul1990'],
  describe: (p) => `A protein query (${p.query} residues) was searched against ${p.db} sequences (${p.residues} residues) with exhaustive affine-gap Smith-Waterman on the ${p.engine === 'gpu' ? 'GPU' : 'CPU'}`,
};

function parseQuery(text: string): string {
  const t = text.trim();
  if (t.startsWith('>')) return (parseFasta(t)[0]?.seq ?? '').replace(/[^A-Z]/g, '');
  return t.replace(/[^A-Za-z]/g, '').toUpperCase();
}

const TOP_HITS = 50;

export default function SearchTab({ query, setQuery, db, setDb, engine, setEngine, onResults }: {
  query: string; setQuery(v: string): void; db: Db | null; setDb(d: Db | null): void;
  engine: EngineChoice; setEngine(e: EngineChoice): void; onResults(r: SearchResult): void;
}) {
  const { run, busy, progress, note, error, cancel, setError } = useRunner();
  const [device, setDevice] = useState('detecting…');
  const [gpuReady, setGpuReady] = useState(false);
  const [tier, setTier] = useState<Tier>('cpu-threads');
  const [family, setFamily] = useState<string[]>([]);
  const recommend = recommendedLimits(tier).searchDbSequences;
  const threads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const det = await detectGpuDetailed();
      rememberGpu(det);
      const d = detectDevice(undefined, undefined, det);
      if (!alive) return;
      setTier(classifyDevice(d).tier);
      const usable = !!det.info && !det.info.fallback;
      setGpuReady(usable);
      setDevice(usable && det.info ? `GPU: ${det.info.vendor} ${det.info.architecture || det.info.description}`.trim() : `CPU: ${d.threads} threads`);
    })();
    return () => { alive = false; };
  }, []);

  // Diagnostic hook for e2e/gpu/search.spec.ts. Installed only with ?searchParity=1.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('searchParity')) return;
    type Win = { __ncSearchParity?: () => Promise<{ gpu: boolean; mismatch: number; top5: string[]; familyRanks: number[]; maxFamilyE: number; gcups: number }> };
    const w = window as unknown as Win;
    w.__ncSearchParity = async () => {
      const { query: q, db, familyIds } = demoDatabase(20261026, 2005);
      const seqs = db.seqs.map((s) => s.seq);
      const cpu = await remote.topHits({ query: q, seqs, n: 10 });
      const state = await createSearchGpu(encodeResidues(q), db.seqs);
      if (!state) return { gpu: false, mismatch: -1, top5: [], familyRanks: [], maxFamilyE: NaN, gcups: 0 };
      let scores: Int32Array;
      let gcups = 0;
      try { const r = await runSearchGpu(state); scores = r.scores; gcups = r.gcups; } finally { disposeSearchGpu(state); }
      let mismatch = 0;
      for (let i = 0; i < scores.length; i++) if (scores[i] !== cpu.scores[i]) mismatch++;
      const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a] || a - b);
      const rank = new Map(order.map((idx, k) => [idx, k + 1]));
      const family = db.seqs.map((s, i) => ({ id: s.id, score: scores[i] })).filter((x) => familyIds.includes(x.id));
      const maxFamilyE = Math.max(...family.map((x) => eValue(x.score, q.length, db.residues)));
      return { gpu: true, mismatch, top5: order.slice(0, 5).map((i) => db.seqs[i].id), familyRanks: family.map((x) => rank.get(db.seqs.findIndex((s) => s.id === x.id)) ?? -1), maxFamilyE, gcups };
    };
    return () => { delete w.__ncSearchParity; };
  }, []);

  const loadDemo = () => {
    const d = demoDatabase();
    setDb(d.db); setQuery(d.query); setFamily(d.familyIds);
  };

  const loadFasta = (text: string, name: string) => {
    try { setDb(parseDb(text)); setFamily([]); }
    catch (e) { setDb(null); setError(`${name}: ${(e as Error).message}`); }
  };

  const q = parseQuery(query);
  const maxLen = db ? db.seqs.reduce((m, s) => Math.max(m, s.length), 0) : 0;

  const go = () => void run<SearchResult>({
    label: `Smith-Waterman · ${db ? db.seqs.length.toLocaleString() : 0} sequences`,
    tool: TOOL,
    params: { db: db?.seqs.length ?? 0, residues: db?.residues ?? 0, query: q.length, engine },
    inputs: [{ name: 'query', data: q }, { name: 'database', data: db ? `${db.seqs.length} sequences / ${db.residues} residues` : '' }],
    run: async (h) => {
      if (!db) throw new Error('Load a protein FASTA database first.');
      if (!q) throw new Error('Paste a protein query (one letter code or FASTA).');
      const t0 = performance.now();
      let scores: Int32Array = new Int32Array(0);
      let usedGpu = false;
      let ms = 0;
      let gcups: number | null = null;
      let noteText: string | undefined;
      const gpuWanted = engine !== 'cpu';
      const gpuPossible = gpuWanted && gpuReady && q.length <= 1024 && maxLen <= 4000;
      if (gpuWanted && !gpuPossible) {
        noteText = !gpuReady ? 'WebGPU is not available, so the search ran on the CPU.' : `The GPU path supports queries up to 1,024 and sequences up to 4,000 residues; this search ran on the CPU.`;
      }
      if (gpuWanted && gpuPossible) {
        const state = await createSearchGpu(encodeResidues(q), db.seqs);
        if (state) {
          usedGpu = true;
          try {
            const r = await runSearchGpu(state, (p) => h.onProgress(p * 0.85, `GPU search · ${fmt(p * 100, 0)}%`));
            scores = r.scores; ms = r.ms; gcups = r.gcups;
          } finally { disposeSearchGpu(state); }
        } else {
          noteText = 'This database does not fit the WebGPU limits granted by the browser; the search ran on the CPU.';
        }
      }
      if (!usedGpu) {
        const t = performance.now();
        const r = await remote.topHits({ query: q, seqs: db.seqs.map((s) => s.seq), n: TOP_HITS }, {
          onProgress: (p) => h.onProgress(p * 0.85, `CPU search · ${fmt(p * 100, 0)}%`), signal: h.signal,
        });
        scores = Int32Array.from(r.scores);
        ms = performance.now() - t;
        gcups = r.cells / Math.max(ms, 1e-9) / 1e6;
      }
      const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a] || a - b).slice(0, TOP_HITS);
      // The shared traceback allocator refuses matrices over 25M cells; skip only those.
      const traceable = order.filter((i) => q.length * db.seqs[i].length <= 25_000_000);
      const aligned = traceable.length
        ? await remote.trace({ query: q, seqs: db.seqs.map((s) => s.seq), indices: traceable }, {
          onProgress: (p) => h.onProgress(0.85 + p * 0.15, 'Traceback of the top hits'), signal: h.signal,
        })
        : [];
      const alignAt = new Map(traceable.map((idx, k) => [idx, aligned[k]]));
      const alignments: SearchResult['alignments'] = {};
      const rows: HitRow[] = order.map((index, k) => {
        const al = alignAt.get(index);
        if (al) alignments[index] = al;
        const s = db.seqs[index];
        return {
          rank: k + 1, index, id: s.id, description: s.description, length: s.length,
          score: scores[index], bits: bitScore(scores[index]), e: eValue(scores[index], q.length, db.residues),
          identity: al?.identity ?? null,
        };
      });
      const elapsed = usedGpu ? ms : performance.now() - t0;
      return { query: q, db, rows, engine: usedGpu ? 'gpu' : 'cpu', device: usedGpu ? device : `CPU: ${threads} threads`, ms: elapsed, gcups, residues: db.residues, alignments, note: noteText };
    },
  }).then((r) => { if (r) onResults(r); });

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Query"><div className="stack" style={{ gap: 8 }}>
        <Field label="Protein query (one letter code or FASTA)">
          <textarea className="input mono" rows={5} value={query} onChange={(e) => { setQuery(e.target.value); setFamily([]); }} placeholder="MKTIIALSYIFCLVFADYKDDDDK…" style={{ fontSize: 12 }} />
        </Field>
        <div className="faint" style={{ fontSize: 12 }}>{q.length ? `${q.length} residues (the first record is used).` : 'Paste one protein sequence or a FASTA record.'}</div>
      </div></Card>
      <Card title="2 · Database" actions={<button className="btn sm" onClick={loadDemo}>Load demo database</button>}>
        <div className="stack" style={{ gap: 8 }}>
          <FileDrop onText={loadFasta} accept=".fasta,.fa,.faa,.txt" label="Drop a protein FASTA, or click to choose a file" />
          <div className="faint" style={{ fontSize: 12 }}>{db ? `${db.seqs.length.toLocaleString()} sequences · ${db.residues.toLocaleString()} residues${db.skipped ? ` · ${db.skipped} empty record${db.skipped === 1 ? '' : 's'} skipped` : ''}${family.length ? ` · planted family: ${family.join(', ')}` : ''}` : 'No database loaded. The demo is 2,000 SYNTHETIC proteins with a planted family; nothing is uploaded.'}</div>
        </div>
      </Card>
      <Card title="3 · Engine and run"><div className="stack" style={{ gap: 10 }}>
        <Field label="Engine"><select className="select" value={engine} onChange={(e) => setEngine(e.target.value as EngineChoice)}>
          <option value="auto">Auto (GPU when it fits)</option><option value="gpu">GPU (WebGPU)</option><option value="cpu">CPU (Web Worker)</option>
        </select></Field>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy} onClick={go}>Run search</button>
          {busy && <button className="btn" onClick={cancel}>Cancel</button>}
        </div>
        {busy && <Busy progress={progress} note={note} />}
        {error && <Callout kind="err">{error}</Callout>}
        {db && db.seqs.length > recommend && <Callout kind="warn">This database ({db.seqs.length.toLocaleString()} sequences) is above the recommended {recommend.toLocaleString()} for your device tier ({tier}). It will still run, but may take more than a minute.</Callout>}
      </div></Card>
    </div>
    <div className="stack">
      <Card title="This run"><div className="cols-2" style={{ gap: 10 }}>
        <Stat label="Device" value={<span style={{ fontSize: 13 }}>{device}</span>} />
        <Stat label="Device tier" value={tier} />
        <Stat label="Sequences" value={db ? db.seqs.length.toLocaleString() : '–'} />
        <Stat label="Residues" value={db ? db.residues.toLocaleString() : '–'} />
        <Stat label="Recommended max" value={`${recommend.toLocaleString()} seq`} hint="Depends on your tier and the granted WebGPU limits." />
        <Stat label="Search mode" value="Exhaustive SW" />
      </div></Card>
      <Card title="Limits"><div className="faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
        The GPU runs one Smith-Waterman thread per database sequence, with queries up to 1,024 residues and database sequences up to 4,000. Anything longer is searched on the CPU. Databases are capped at {MAX_SEQUENCES.toLocaleString()} sequences and 150 MB. No sequences are uploaded. Results are research-grade and not clinical.
      </div></Card>
    </div></div>
  );
}

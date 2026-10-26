/** Protein language-model worker: ESM-2 run in the browser with ONNX Runtime Web.
 *  Model weights downloaded from HuggingFace on request and cached by the browser.
 */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import { AutoModelForMaskedLM, AutoTokenizer, env } from '@huggingface/transformers';
import { scanProfile, type ScanResult } from './plm';

const DEFAULT_MODEL = 'Xenova/esm2_t6_8M_UR50D';
export const MAX_LEN = 400;
type Tok = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForMaskedLM.from_pretrained>>;
let loaded: { tok: Tok; model: Model; vocab: Record<string, number>; mask: number; modelId: string } | null = null;
let loadedKey = '';

const load: Kernel<{ modelId?: string; provider?: string }, { model: string; layers: number }> = async (a, ctx) => {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    wasm.proxy = false;
    wasm.wasmPaths = {
      mjs: assetUrl('wasm/ort/ort-wasm-simd-threaded.mjs'),
      wasm: assetUrl('wasm/ort/ort-wasm-simd-threaded.wasm'),
    };
  }
  const modelId = a?.modelId || DEFAULT_MODEL;
  const key = `${modelId}|${a?.provider || 'wasm'}`;
  if (loaded && loadedKey === key) {
    ctx.progress(1, 'ready');
    return { model: loaded.modelId, layers: loaded.modelId.includes('t30') ? 30 : loaded.modelId.includes('t12') ? 12 : 6 };
  }
  loaded = null;
  loadedKey = key;
  loaded = await (async () => {
    const files = new Map<string, { loaded: number; total: number }>();
    const cb = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 1 });
        let l = 0,
          t = 0;
        files.forEach((v) => {
          l += v.loaded;
          t += v.total;
        });
        ctx.progress(0.05 + 0.85 * (t ? l / t : 0), `downloading ${(l / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)} MB`);
      }
    };
    const tok = await AutoTokenizer.from_pretrained(modelId, { progress_callback: cb });
    const model = await AutoModelForMaskedLM.from_pretrained(modelId, { dtype: 'q8', progress_callback: cb });
    const vocab: Record<string, number> = {};
    for (const a of 'ACDEFGHIKLMNPQRSTVWY') vocab[a] = tok.convert_tokens_to_ids(a) as number;
    return { tok, model, vocab, mask: tok.convert_tokens_to_ids('<mask>') as number, modelId };
  })();
  ctx.progress(1, 'ready');
  return { model: loaded.modelId, layers: loaded.modelId.includes('t30') ? 30 : loaded.modelId.includes('t12') ? 12 : 6 };
};

const checkSeq = (seq: string) => {
  const s = seq.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length < 5) throw new Error('Enter a protein sequence of at least 5 residues.');
  if (s.length > MAX_LEN) throw new Error(`The browser model is limited to ${MAX_LEN} residues (each position needs its own forward pass). Use a domain.`);
  if (/[^ACDEFGHIKLMNPQRSTVWY]/.test(s)) throw new Error('Only the 20 standard amino acids are supported (no B, J, O, U, X, Z).');
  return s;
};

const scan: Kernel<{ seq: string }, { seq: string; result: ScanResult }> = async (a, ctx) => {
  if (!loaded) throw new Error('Load the model first.');
  const seq = checkSeq(a.seq),
    { tok, model, vocab, mask } = loaded,
    enc = tok(seq);
  const ids = Array.from(enc.input_ids.data as unknown as BigInt64Array, Number),
    T = enc.input_ids.constructor as new (t: string, d: BigInt64Array, s: number[]) => never;
  const attn = BigInt64Array.from(ids.map(() => 1n));
  const result = await scanProfile(
    seq,
    async (pos) => {
      const m = ids.slice();
      m[pos + 1] = mask;
      const out = (await model({
        input_ids: new T('int64', BigInt64Array.from(m.map(BigInt)), [1, m.length]),
        attention_mask: new T('int64', attn, [1, m.length]),
      })) as { logits: { data: Float32Array; dims: number[] } };
      const V = out.logits.dims[2];
      return Float32Array.from(out.logits.data.slice((pos + 1) * V, (pos + 2) * V));
    },
    vocab,
    (f) => ctx.progress(f, `position ${Math.round(f * seq.length)} / ${seq.length}`),
  );
  return { seq, result };
};

export type PlmKernels = { load: typeof load; scan: typeof scan };
exposeKernels({ load, scan } as Record<string, Kernel>);

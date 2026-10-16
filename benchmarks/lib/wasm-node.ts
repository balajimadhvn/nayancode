// Runs the Workbench's vendored WebAssembly builds (public/wasm: minimap2, samtools, bcftools) under Node, with the
// same calling convention as public/wasm/tool-runner.js, so benchmarks exercise exactly the binaries the browser ships.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { RunTool, ToolResult } from '@/studios/genome/pipeline';

const base = new URL('../../public/wasm/', import.meta.url).pathname;
const require = createRequire(import.meta.url);
type Factory = (m: Record<string, unknown>) => Promise<{ FS: { writeFile(p: string, d: Uint8Array | string): void; readFile(p: string): Uint8Array }; callMain(a: string[]): number | undefined }>;
const cache = new Map<string, { make: Factory; wasm: Uint8Array }>();

// The Emscripten data-file loader uses XMLHttpRequest; serve local files to it.
(globalThis as Record<string, unknown>).XMLHttpRequest ??= class {
  url = ''; status = 0; response: ArrayBuffer | null = null; onload?: (e: unknown) => void; onerror?: (e: unknown) => void;
  open(_m: string, url: string) { this.url = url; }
  send() { try { const b = readFileSync(this.url); this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; this.status = 200; } catch { this.status = 404; } setTimeout(() => this.onload?.({}), 0); }
};

function factory(tool: string) {
  if (!cache.has(tool)) {
    const dir = base + tool + '/', src = readFileSync(dir + tool + '.js', 'utf8');
    const make = new Function('require', '__dirname', '__filename', src + '\n;return Module;')(require, dir, dir + tool + '.js') as Factory;
    cache.set(tool, { make, wasm: readFileSync(dir + tool + '.wasm') });
  }
  return { ...cache.get(tool)!, dir: base + tool + '/' };
}

/** A fresh module instance per call, as in the browser (these CLIs are not re-entrant). */
export const runToolNode: RunTool = async (tool, args, files, outputs = [], opts = {}) => {
  const f = factory(tool); let stdout = '', stderr = '';
  const mod = await f.make({ noInitialRun: true, wasmBinary: f.wasm, locateFile: (p: string) => f.dir + p, print: (t: string) => { stdout += t + '\n'; }, printErr: (t: string) => { stderr += t + '\n'; opts.onLog?.(t); } });
  for (const [name, data] of Object.entries(files)) mod.FS.writeFile('/' + name, data);
  let code = 0;
  try { const r = mod.callMain(args); if (typeof r === 'number') code = r; } catch (err) { const s = (err as { status?: number }).status; if (typeof s === 'number') code = s; else throw err; }
  const out: Record<string, Uint8Array> = {};
  for (const name of outputs) { try { out[name] = mod.FS.readFile('/' + name); } catch { /* optional output missing */ } }
  return { code, stdout, stderr, out } satisfies ToolResult;
};

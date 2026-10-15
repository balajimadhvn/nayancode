/** Loads the Vina WebAssembly module from public/wasm/vina under Node (unit tests and benchmarks only). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { VinaFactory } from './vina';

export function vinaNodeFactory(variant: 'vina' | 'vina-mt' = 'vina'): VinaFactory {
  const dir = fileURLToPath(new URL('../../../public/wasm/vina/', import.meta.url));
  const file = `${dir}${variant}.js`;
  const mod = { exports: {} as unknown };
  const make = new Function('require', '__dirname', '__filename', 'module', 'exports', `${readFileSync(file, 'utf8')}\n;return typeof VinaModule === 'function' ? VinaModule : module.exports;`)(createRequire(import.meta.url), dir, file, mod, mod.exports) as (o: Record<string, unknown>) => Promise<never>;
  return (opts) => make({ locateFile: (f: string) => `${dir}${f}`, ...opts });
}

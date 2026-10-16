/** Loads the RDKit WebAssembly build that the app serves (public/rdkit) under Node: unit tests and benchmarks only. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { RDKitModule } from './rdkitBridge';

let cached: Promise<RDKitModule> | null = null;
export function loadRdkitNode(): Promise<RDKitModule> {
  return (cached ??= (async () => {
    const dir = fileURLToPath(new URL('../../../public/rdkit/', import.meta.url));
    const init = new Function('require', '__dirname', `${readFileSync(`${dir}RDKit_minimal.js`, 'utf8')}\n;return initRDKitModule;`)(createRequire(import.meta.url), dir) as (o: unknown) => Promise<RDKitModule>;
    return init({ locateFile: (f: string) => `${dir}${f}` });
  })());
}

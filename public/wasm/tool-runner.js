/* Runs the vendored Emscripten builds (minimap2, samtools) inside a classic Web Worker.
 * Each module is evaluated in its own Function scope, because both define a global `Module`.
 * Protocol:  {id, tool, args, files:{name: Uint8Array|string}, outputs:[names]}  →  {id, result:{code, stdout, stderr, out:{name:Uint8Array}}} | {id, error} | {id, log}
 * A fresh module instance is created per call (these CLIs are not re-entrant). */
const factories = new Map();
async function factory(tool) {
  if (!factories.has(tool)) {
    const base = new URL(tool + '/', self.location.href).href;
    const r = await fetch(base + tool + '.js'); if (!r.ok) throw new Error('Could not load ' + tool + ' (' + r.status + ')');
    factories.set(tool, { make: new Function((await r.text()) + '\n;return Module;')(), base });
  }
  return factories.get(tool);
}
onmessage = async (e) => {
  const { id, tool, args, files, outputs } = e.data;
  try {
    const f = await factory(tool); let stdout = '', stderr = '';
    const mod = await f.make({ noInitialRun: true, locateFile: (p) => f.base + p, print: (t) => { stdout += t + '\n'; }, printErr: (t) => { stderr += t + '\n'; postMessage({ id, log: t }); } });
    for (const [name, data] of Object.entries(files || {})) mod.FS.writeFile('/' + name, data);
    let code = 0;
    try { const r = mod.callMain(args); if (typeof r === 'number') code = r; } catch (err) { if (err && typeof err.status === 'number') code = err.status; else throw err; }
    const out = {}; for (const name of outputs || []) { try { out[name] = mod.FS.readFile('/' + name); } catch (_) { /* optional output missing */ } }
    postMessage({ id, result: { code, stdout, stderr, out } }, Object.values(out).map((b) => b.buffer));
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};

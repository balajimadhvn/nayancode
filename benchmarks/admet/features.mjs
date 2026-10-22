// Computes RDKit MinimalLib descriptors (the same function the Workbench calls in the browser) for the training
// sets, so the shipped models see identical features. Usage: node features.mjs <in.csv> <smilesCol> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('../../public/rdkit/', import.meta.url));
const init = new Function('require', '__dirname', `${readFileSync(`${dir}RDKit_minimal.js`, 'utf8')}\n;return initRDKitModule;`)(createRequire(import.meta.url), dir);
const RD = await init({ locateFile: (f) => `${dir}${f}` });
const [, , inp, col, out] = process.argv;
const parse = (t) => { const rows = []; let r = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (c !== '\r') f += c; } return rows; };
const rows = parse(readFileSync(inp, 'utf8')); const head = rows[0], si = head.indexOf(col);
const heavy = (s) => { const m = RD.get_mol(s); if (!m || !m.is_valid()) { m && m.delete(); return -1; } try { return JSON.parse(m.get_descriptors()).NumHeavyAtoms || 0; } finally { m.delete(); } };
const res = []; let names = null;
for (const r of rows.slice(1)) {
  let smi = r[si]; if (!smi) continue;
  if (smi.includes('.')) { let best = '', bh = -1; for (const f of smi.split('.')) { const h = heavy(f); if (h > bh) { bh = h; best = f; } } smi = best; }
  const m = RD.get_mol(smi); if (!m || !m.is_valid()) { m && m.delete(); continue; }
  try { const d = JSON.parse(m.get_descriptors()); if (!names) names = Object.keys(d).filter((k) => typeof d[k] === 'number').sort(); res.push({ smiles: smi, row: r, x: names.map((k) => (Number.isFinite(d[k]) ? d[k] : 0)) }); } finally { m.delete(); }
}
writeFileSync(out, JSON.stringify({ head, names, rows: res }));
console.log(inp, res.length, 'molecules,', names.length, 'descriptors');

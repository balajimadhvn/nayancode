/* RDKit Web Worker. Classic script: RDKit_minimal.js is not an ES module. BSD-3-Clause RDKit build is self-hosted beside this file. */
importScripts('RDKit_minimal.js');
let RD = null;
const ready = initRDKitModule({ locateFile: (f) => new URL(f, self.location.href).href }).then((m) => { RD = m; });

// Illustrative structural alerts (hand-written SMARTS for common reactive/unstable groups). NOT the PAINS or Brenk sets.
const ALERTS = [
  ['nitroaromatic', '[c][N+](=O)[O-]'], ['aldehyde', '[CX3H1](=O)[#6]'], ['azo', '[#6]N=N[#6]'], ['acyl halide', 'C(=O)[F,Cl,Br,I]'],
  ['Michael acceptor', '[CX3]=[CX3][CX3]=O'], ['thiol', '[SX2H]'], ['quinone', 'O=C1C=CC(=O)C=C1'], ['epoxide', 'C1OC1'], ['isocyanate', 'N=C=O'], ['peroxide', 'OO'],
];
let alertQ = null;
const getAlerts = () => (alertQ ??= ALERTS.map(([n, s]) => [n, RD.get_qmol(s)]).filter(([, q]) => q && q.is_valid()));
const bitsToWords = (s) => { const w = new Uint32Array(Math.ceil(s.length / 32)); for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 49) w[i >> 5] |= 1 << (i & 31); return w; };
const heavy = (smi) => { const m = RD.get_mol(smi); if (!m || !m.is_valid()) { m && m.delete(); return -1; } try { return JSON.parse(m.get_descriptors()).NumHeavyAtoms || 0; } finally { m.delete(); } };
const tick = () => new Promise((r) => setTimeout(r, 0));

onmessage = async (e) => {
  const { id, op } = e.data;
  try {
    await ready;
    if (op === 'init') return postMessage({ id, result: { version: RD.version() } });
    if (op === 'process') {
      const { items, radius, nBits, light } = e.data, mols = [], failed = [], seen = new Set(); let stripped = 0, dupes = 0, descNames = null; const alerts = light ? [] : getAlerts();
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; let smi = it.smiles;
        if (smi.includes('.')) { const frags = smi.split('.'); let best = frags[0], bh = -1; for (const f of frags) { const h = heavy(f); if (h > bh) { bh = h; best = f; } } if (bh >= 0) { smi = best; stripped++; } }
        const m = RD.get_mol(smi);
        if (!m || !m.is_valid()) { failed.push(it); m && m.delete(); continue; }
        try {
          const canon = m.get_smiles();
          if (seen.has(canon)) { dupes++; continue; } seen.add(canon);
          const d = JSON.parse(m.get_descriptors()), logp = d.CrippenClogP, hbd = d.NumHBD ?? d.lipinskiHBD, hba = d.NumHBA ?? d.lipinskiHBA;
          if (!descNames) descNames = Object.keys(d).filter((k) => typeof d[k] === 'number').sort();
          const desc = new Float32Array(descNames.length); descNames.forEach((k, j) => { const v = d[k]; desc[j] = Number.isFinite(v) ? v : 0; });
          const hits = []; for (const [n, q] of alerts) { const r = JSON.parse(m.get_substruct_match(q) || '{}'); if (r.atoms && r.atoms.length) hits.push(n); }
          mols.push({ id: String(mols.length), name: it.name, extra: it.extra || {}, desc, smiles: smi, canon, svg: light ? '' : m.get_svg(200, 150), mw: d.amw, logp, tpsa: d.tpsa, hbd, hba, rotb: d.NumRotatableBonds, fsp3: d.FractionCSP3, rings: d.NumRings,
            lipinskiViolations: (d.amw > 500 ? 1 : 0) + (logp > 5 ? 1 : 0) + (hbd > 5 ? 1 : 0) + (hba > 10 ? 1 : 0), alerts: hits, fp: bitsToWords(m.get_morgan_fp(JSON.stringify({ radius, nBits }))) });
        } finally { m.delete(); }
        if (i % 25 === 0) { postMessage({ id, progress: i / items.length, note: `${i}/${items.length}` }); await tick(); }
      }
      return postMessage({ id, result: { mols, failed, stripped, dupes, descNames: descNames || [] } }, mols.flatMap((m) => [m.fp.buffer, m.desc.buffer]));
    }
    if (op === 'fp') {
      const m = RD.get_mol(e.data.smiles); if (!m || !m.is_valid()) { m && m.delete(); throw new Error('Query SMILES is not valid.'); }
      try { const fp = bitsToWords(m.get_morgan_fp(JSON.stringify({ radius: e.data.radius, nBits: e.data.nBits }))); return postMessage({ id, result: { fp, svg: m.get_svg(200, 150) } }, [fp.buffer]); } finally { m.delete(); }
    }
    if (op === 'substruct') {
      const q = RD.get_qmol(e.data.smarts); if (!q || !q.is_valid()) { q && q.delete(); throw new Error('SMARTS pattern is not valid.'); }
      const hits = [];
      try { e.data.smiles.forEach((smi, i) => { const m = RD.get_mol(smi); if (!m) return; try { const r = JSON.parse(m.get_substruct_match(q) || '{}'); if (r.atoms && r.atoms.length) hits.push({ i, svg: m.get_svg_with_highlights(JSON.stringify({ atoms: r.atoms, bonds: r.bonds, width: 200, height: 150 })) }); } finally { m.delete(); } }); } finally { q.delete(); }
      return postMessage({ id, result: hits });
    }
    throw new Error('Unknown op ' + op);
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};

// One-off: picks redocking complexes from RCSB and writes complexes.tsv (id, ligand comp id, SMILES, SHA-256 of the downloaded PDB file).
// Needs network. Selection is rule-based and deterministic: first candidates (in list order) that satisfy all rules until N are collected.
//   rules: X-ray, resolution <= 2.6 Å, bound non-polymer with formula weight 200-520 Da, 14-38 heavy atoms, C/H/N/O/S/F/Cl/Br only,
//          not a common crystallisation additive, one or two polymer entities.
// Candidate IDs: public PDBbind/CASF-2016 "core set"-style complexes (diverse targets: proteases, kinases, nuclear receptors, ...).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const N = Number(process.argv[2] || 40);
const CAND = `1a30 1bcu 1bzc 1c5z 1e66 1eby 1g2k 1gpk 1h22 1h23 1k1i 1lpg 1mq6 1nc1 1nc3 1nvq 1o0h 1o3f 1o5b 1owh 1p1n 1p1q 1ps3 1pxn 1q8t 1q8u 1qf1 1qkt 1r5y 1s38 1syi 1u1b 1vso 1w4o 1y6r 1yc1 1ydr 1ydt 1z6e 1z95 1z9g 2al5 2br1 2brb 2c3i 2cbv 2cet 2fvd 2fxs 2hb1 2iwx 2j78 2j7h 2p15 2pog 2qbp 2qbq 2qbr 2qe4 2qnq 2r9w 2v00 2v7a 2vkm 2vvn 2vw5 2w4x 2w66 2wbg 2wca 2wer 2wn9 2wnc 2x00 2xb8 2xbv 2xdl 2xii 2xj7 2xnb 2y5h 2yfe 2yge 2yki 2zb1 2zcq 2zcr 2zda 2zy1 3acw 3ag9 3ao4 3arp 3ary 3b1m 3b5r 3b65 3bgz 3bv9 3cj4 3coy 3d4z 3dd0 3dx1 3dx2 3e5a 3e92 3e93 3ebp 3f3a 3f3c 3f3d 3f3e 3g0w 3g2n 3g31 3gbb 3gc5 3ge7 3gnw 3gr2 3gv9 3jvr 3jvs 3jya 3k5v 3kgp 3kr8 3kwa 3l7b 3lka 3mss 3myg 3n76 3n7a 3n86 3nq9 3nw9 3nx7 3o9i 3oe4 3oe5 3ozs 3ozt 3p5o 3prs 3pww 3pxf 3pyy 3qgy 3qqs 3r88 3rr4 3rsx 3rlr 3syr 3tsk 3twp 3u5j 3u8k 3u8n 3u9q 3udh 3ueu 3uev 3uew 3uex 3ui7 3uri 3utu 3uuo 3wtj 3zdg 3zso 3zsx 4abg 4agn 4agp 4agq 4bkt 4cig 4ciw 4cr9 4cra 4crc 4ddh 4ddk 4de1 4de2 4de3 4djv 4dld 4dli 4e5w 4e6q 4ea2 4eky 4eo8 4eor 4f09 4f9w 4gfm 4gkm 4gr0 4hge 4ih5 4ih7 4ivb 4ivc 4ivd 4j21 4j28 4j3l 4jfs 4jsz 4jxs 4kz6 4kzq 4kzu 4llx 4lzs 4m0y 4m0z 4mgd 4mme 4owm 4pcs 4qac 4rfm 4twp 4ty7 4u4s 4w9c 4w9h 4w9i 4w9l 4wiv 4x6p 4yzm 5a7b 5aba 5c28 5c2h 5dwr 5enj 5tmn 1hsg 1hvr 3ptb 1stp 1dwc 2src 1fkb 1rnt`.split(/\s+/);
const ADD = new Set(['SO4', 'PO4', 'GOL', 'EDO', 'PEG', 'ACT', 'DMS', 'MPD', 'BME', 'CL', 'NA', 'K', 'FMT', 'TRS', 'IMD', 'NO3', 'ACY', 'PGE', 'PG4', 'EPE', 'MES', 'CIT', 'TLA', 'SCN', 'BR', 'IOD', 'MG', 'ZN', 'CA', 'HEM', 'NAG', 'FAD', 'NAD', 'NAP', 'ATP', 'ADP', 'COA']);
const j = async (u) => { for (let k = 0; k < 4; k++) { try { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return await r.json(); } catch (err) { if (k === 3) throw err; await new Promise((x) => setTimeout(x, 800)); } } };
const heavy = (f) => [...f.matchAll(/([A-Z][a-z]?)(\d*)/g)].reduce((s, m) => s + (m[1] === 'H' ? 0 : Number(m[2] || 1)), 0);
const els = (f) => [...f.matchAll(/([A-Z][a-z]?)(\d*)/g)].map((m) => m[1]).filter(Boolean);
const rows = [];
for (const id of CAND) {
  if (rows.length >= N) break;
  try {
    const e = await j(`https://data.rcsb.org/rest/v1/core/entry/${id.toUpperCase()}`);
    const res = e.rcsb_entry_info?.resolution_combined?.[0];
    if (!/X-RAY/i.test(e.exptl?.[0]?.method ?? '') || !(res <= 2.6)) continue;
    if (!((e.rcsb_entry_info?.polymer_entity_count ?? 0) >= 1 && (e.rcsb_entry_info?.polymer_entity_count ?? 0) <= 2)) continue;
        let best = null;
    const comps = [];
    for (const eid of e.rcsb_entry_container_identifiers?.non_polymer_entity_ids ?? []) { try { comps.push((await j(`https://data.rcsb.org/rest/v1/core/nonpolymer_entity/${id.toUpperCase()}/${eid}`)).pdbx_entity_nonpoly.comp_id); } catch { /* skip */ } }
    for (const comp of comps) {
      if (ADD.has(comp)) continue;
      const c = await j(`https://data.rcsb.org/rest/v1/core/chemcomp/${comp}`);
      const f = c.chem_comp.formula, w = c.chem_comp.formula_weight, hv = heavy(f);
      if (!(w >= 200 && w <= 520 && hv >= 14 && hv <= 38)) continue;
      if (els(f).some((x) => !['C', 'H', 'N', 'O', 'S', 'F', 'Cl', 'Br'].includes(x))) continue;
      const smi = (c.rcsb_chem_comp_descriptor?.SMILES_stereo ?? c.rcsb_chem_comp_descriptor?.SMILES ?? '').replace(/\[N@@?\]/g, 'N');
      if (!smi || smi.includes('.')) continue;
      if (!best || w > best.w) best = { comp, w, smi, hv };
    }
    if (!best) continue;
    const pdb = await (await fetch(`https://files.rcsb.org/download/${id.toUpperCase()}.pdb`)).text();
    if (!pdb.includes('HETATM')) continue;
    rows.push([id.toUpperCase(), best.comp, best.smi, createHash('sha256').update(pdb).digest('hex'), res, best.hv].join('\t'));
    console.error(rows.length, id, best.comp, best.hv, res);
  } catch (err) { console.error('skip', id, String(err).slice(0, 80)); }
}
writeFileSync(new URL('complexes.tsv', import.meta.url), '# pdb\tligand\tsmiles\tsha256(pdb)\tresolution\theavy\n' + rows.join('\n') + '\n');

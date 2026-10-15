import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { trackedFetch } from '@/core/net';
import { Busy, Callout, Card, Field, FileDrop } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { StructureAnalysis, type ResRef, type Src } from './StructureAnalysis';

const TOOL: ToolInfo = {
  id: 'structure.view', name: 'Structure visualisation', version: '0.1.0', engine: 'Mol* (WebGL)', citations: ['molstar', 'rcsb', 'alphafold'],
  describe: (p) => `The ${p.source} structure ${p.id} was retrieved and visualised with Mol*`,
};
const EXAMPLES = [['1CRN', 'Crambin'], ['1HSG', 'HIV-1 protease + inhibitor'], ['4HHB', 'Haemoglobin'], ['1TUP', 'p53 + DNA'], ['6LU7', 'SARS-CoV-2 Mpro']];

interface Info { title: string; method?: string; resolution?: string; year?: string; entities?: string[] }

export default function StructureStudio() {
  const host = useRef<HTMLDivElement>(null);
  const plugin = useRef<import('molstar/lib/mol-plugin-ui/context').PluginUIContext | null>(null);
  const [ready, setReady] = useState(false);
  const [pdb, setPdb] = useState('1HSG'), [uni, setUni] = useState('P69905');
  const [info, setInfo] = useState<Info | null>(null);
  const [src, setSrc] = useState<Src | null>(null);
  const [colorBy, setColorBy] = useState<'default' | 'plddt'>('default');
  const { run, busy, error } = useRunner();

  useEffect(() => {
    let disposed = false;
    let mount: HTMLDivElement | null = null;
    (async () => {
      const [{ createPluginUI }, { renderReact18 }, { DefaultPluginUISpec }] = await Promise.all([
        import('molstar/lib/mol-plugin-ui'), import('molstar/lib/mol-plugin-ui/react18'), import('molstar/lib/mol-plugin-ui/spec'),
      ]);
      await import('molstar/lib/mol-plugin-ui/skin/dark.scss');
      if (disposed || !host.current) return;
      const spec = DefaultPluginUISpec();
      // Mol* owns its own React root: give it a private element React never touches.
      mount = document.createElement('div'); mount.style.cssText = 'position:absolute;inset:0';
      host.current.appendChild(mount);
      const ctx = await createPluginUI({ target: mount, render: renderReact18, spec: { ...spec, layout: { initial: { isExpanded: false, showControls: false, controlsDisplay: 'reactive' } }, components: { ...spec.components, remoteState: 'none' } } });
      if (disposed) { ctx.dispose(); return; }
      const { Color } = await import('molstar/lib/mol-util/color');
      ctx.canvas3d?.setProps({ renderer: { backgroundColor: Color(0x0b0f1a) } });
      plugin.current = ctx; setReady(true);
      // Mol*'s logo link has no text; give it an accessible name once the viewer UI has rendered.
      setTimeout(() => mount?.querySelectorAll('a.msp-logo').forEach((l) => l.setAttribute('aria-label', 'Mol* viewer website')), 500);
    })().catch(() => { /* surfaced by `ready` staying false */ });
    return () => { disposed = true; plugin.current?.dispose(); plugin.current = null; mount?.remove(); };
  }, []);

  const loadData = useCallback(async (data: string | Uint8Array, format: 'mmcif' | 'pdb', label: string, binary = false, append = false) => {
    const p = plugin.current; if (!p) throw new Error('Viewer is still starting.');
    if (!append) await p.clear();
    const d = await p.builders.data.rawData({ data: data as string, label }, { state: { isGhost: true } });
    const traj = await p.builders.structure.parseTrajectory(d, format);
    await p.builders.structure.hierarchy.applyPreset(traj, 'default', { representationPreset: colorBy === 'plddt' ? 'auto' : 'auto' });
    void binary;
  }, [colorBy]);

  const loadPdb = (id: string) => run({ label: `Fetch PDB ${id.toUpperCase()}`, tool: TOOL, params: { source: 'RCSB PDB', id: id.toUpperCase() }, inputs: [], run: async () => {
    id = id.trim().toUpperCase(); if (!/^[0-9][A-Z0-9]{3}$/.test(id)) throw new Error('A PDB ID is 4 characters, e.g. 1HSG.');
    const [cif, meta] = await Promise.all([trackedFetch(`https://files.rcsb.org/download/${id}.cif`).then((r) => r.text()), trackedFetch(`https://data.rcsb.org/rest/v1/core/entry/${id}`).then((r) => r.json()).catch(() => null)]);
    await loadData(cif, 'mmcif', id); setSrc({ text: cif, label: id });
    setInfo(meta ? { title: meta.struct?.title, method: meta.exptl?.[0]?.method, resolution: meta.rcsb_entry_info?.resolution_combined?.[0]?.toFixed?.(2), year: meta.rcsb_accession_info?.initial_release_date?.slice(0, 4), entities: [`${meta.rcsb_entry_info?.polymer_entity_count ?? '?'} polymer entities`, `${meta.rcsb_entry_info?.deposited_atom_count?.toLocaleString?.() ?? '?'} atoms`] } : { title: id });
  } });

  const loadAf = (acc: string) => run({ label: `Fetch AlphaFold ${acc.toUpperCase()}`, tool: TOOL, params: { source: 'AlphaFold DB', id: acc.toUpperCase() }, inputs: [], run: async () => {
    acc = acc.trim().toUpperCase(); if (!/^[A-Z0-9]{6,10}$/.test(acc)) throw new Error('Enter a UniProt accession, e.g. P69905.');
    const meta = await trackedFetch(`https://alphafold.ebi.ac.uk/api/prediction/${acc}`).then((r) => r.json());
    const entry = meta?.[0]; if (!entry?.cifUrl) throw new Error('No AlphaFold model found for this accession.');
    const cif = await trackedFetch(entry.cifUrl).then((r) => r.text());
    await loadData(cif, 'mmcif', acc); setSrc({ text: cif, label: `AlphaFold ${acc}` });
    setInfo({ title: `${entry.uniprotDescription ?? acc} (${entry.gene ?? ''}) · ${entry.organismScientificName ?? ''}`, method: 'AlphaFold prediction', entities: [`model v${entry.latestVersion ?? '?'}`, 'colour by pLDDT confidence'] });
    setColorBy('plddt');
  } });

  const loadFile = (text: string, name: string) => run({ label: `Load ${name}`, tool: TOOL, params: { source: 'local file', id: name }, inputs: [{ name, data: text }], run: async () => {
    const fmt = /\.(cif|mmcif)$/i.test(name) || text.trimStart().startsWith('data_') ? 'mmcif' : 'pdb';
    await loadData(text, fmt, name); setSrc({ text, label: name }); setInfo({ title: name, method: 'Local file', entities: ['Never uploaded'] });
  } });

  /** Select residues (auth chain + number) in the 3D view and move the camera to them. */
  const focusResidues = useCallback(async (list: ResRef[]) => {
    const p = plugin.current; if (!p || !list.length) return;
    const [{ Script }, { StructureSelection }] = await Promise.all([import('molstar/lib/mol-script/script'), import('molstar/lib/mol-model/structure')]);
    const data = p.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data; if (!data) return;
    const sel = Script.getStructureSelection((Q) => Q.struct.generator.atomGroups({ 'residue-test': Q.core.logic.or(list.slice(0, 400).map((r) => Q.core.logic.and([Q.core.rel.eq([Q.struct.atomProperty.macromolecular.auth_asym_id(), r.chain]), Q.core.rel.eq([Q.struct.atomProperty.macromolecular.auth_seq_id(), r.seq])]))) }), data);
    const loci = StructureSelection.toLociWithSourceUnits(sel);
    p.managers.structure.selection.clear(); p.managers.structure.selection.fromLoci('add', loci); p.managers.camera.focusLoci(loci);
  }, []);
  const showSuperposition = useCallback(async (a: string, bPdb: string) => {
    const fmtA = a.trimStart().startsWith('data_') || /^_atom_site/m.test(a.slice(0, 3000)) ? 'mmcif' : 'pdb';
    await loadData(a, fmtA, 'A'); await loadData(bPdb, 'pdb', 'B (superposed)', false, true);
  }, [loadData]);
  const hand = useHandoff((s) => s.structure);
  useEffect(() => { if (!hand || !ready) return; clearHandoffSoon('structure'); if (hand.kind === 'af') { setUni(hand.id); void loadAf(hand.id); } else { setPdb(hand.id); void loadPdb(hand.id); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hand, ready]);
  const snapshot = () => { const c = host.current?.querySelector('canvas'); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'structure.png'; a.click(); };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Structure Studio</h1><p>Explore biomolecular structures from the PDB and AlphaFold, or open your own file. Rendering uses Mol* on your GPU.</p></div></div>
      <div className="split split--narrow">
        <div className="stack">
          <Card title="RCSB PDB">
            <div className="stack" style={{ gap: 10 }}>
              <Field label="PDB ID"><input className="input mono" value={pdb} maxLength={4} onChange={(e) => setPdb(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadPdb(pdb)} /></Field>
              <button className="btn primary" disabled={!ready || busy} onClick={() => void loadPdb(pdb)}>Load structure</button>
              <div className="row" style={{ gap: 6 }}>{EXAMPLES.map(([id, n]) => <button key={id} className="btn sm" title={n} disabled={!ready || busy} onClick={() => { setPdb(id); void loadPdb(id); }}>{id}</button>)}</div>
            </div>
          </Card>
          <Card title="AlphaFold DB">
            <div className="stack" style={{ gap: 10 }}>
              <Field label="UniProt accession"><input className="input mono" value={uni} onChange={(e) => setUni(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadAf(uni)} /></Field>
              <button className="btn" disabled={!ready || busy} onClick={() => void loadAf(uni)}>Fetch predicted model</button>
            </div>
          </Card>
          <Card title="Local file"><FileDrop accept=".pdb,.cif,.mmcif,.ent" onText={(t, n) => void loadFile(t, n)} label="Drop PDB / mmCIF" /></Card>
          {busy && <Busy progress={0.5} note="Fetching and building structure…" />}
          {error && <Callout kind="err">{error}</Callout>}
          <Callout>Fetching from RCSB or AlphaFold sends only the ID. It is counted in the network badge above.</Callout>
        </div>
        <div className="stack">
          <div style={{ position: 'relative' }}>
            <div className="molstar-host" ref={host} />
            {!ready && <div className="row dim" style={{ position: 'absolute', inset: 0, justifyContent: 'center', color: '#9aa8c7', pointerEvents: 'none' }}><span className="spinner" /> Starting Mol* viewer…</div>}
          </div>
          <StructureAnalysis src={src} onFocus={(l) => void focusResidues(l)} onShowSuperposition={(a, b) => void showSuperposition(a, b)} />
          {info && <Card title={info.title} actions={<button className="btn sm" onClick={snapshot}>Save image</button>}><div className="row dim" style={{ gap: 16 }}>{info.method && <span>{info.method}</span>}{info.resolution && <span>{info.resolution} Å</span>}{info.year && <span>{info.year}</span>}{info.entities?.map((e) => <span key={e}>{e}</span>)}</div></Card>}
        </div>
      </div>
    </div>
  );
}

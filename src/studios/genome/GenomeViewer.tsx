import { useEffect, useMemo, useRef, useState } from 'react';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import { Callout, Card, Field, downloadText } from '@/ui/kit';
import { loadBundledText } from './genomeData';
import { useManifest } from './GenomePicker';
import type { Mapped } from './MappingPanel';
import { parseFasta } from '../sequence/kernels';

/** igv.js (MIT) genome viewer. Every file is read from disk through blob URLs; nothing is uploaded. */
interface IgvTrack { name?: string }
interface IgvBrowser { loadTrack(c: unknown): Promise<IgvTrack>; removeTrack(t: IgvTrack): void; search(q: string): Promise<void>; toSVG(): string; currentLoci?(): string | string[] }
interface IgvApi { createBrowser(el: HTMLElement, c: unknown): Promise<IgvBrowser>; removeBrowser(b: unknown): void }

type Kind = 'alignment' | 'variant' | 'wig' | 'annotation';
interface TrackSpec { id: string; name: string; kind: Kind; format: string; data: Blob; index?: Blob; filename: string; gz: boolean }
const FORMATS: [RegExp, Kind, string][] = [[/\.bam$/i, 'alignment', 'bam'], [/\.cram$/i, 'alignment', 'cram'], [/\.vcf(\.gz)?$/i, 'variant', 'vcf'], [/\.(bw|bigwig)$/i, 'wig', 'bigwig'], [/\.(bb|bigbed)$/i, 'annotation', 'bigbed'], [/\.bed(\.gz)?$/i, 'annotation', 'bed'], [/\.gtf(\.gz)?$/i, 'annotation', 'gtf'], [/\.gff3?(\.gz)?$/i, 'annotation', 'gff3'], [/\.bedgraph(\.gz)?$/i, 'wig', 'bedgraph']];
const INDEX_RE = /\.(bai|crai|csi|tbi|fai|gzi)$/i;
const DATA_ACCEPT = '.bam,.cram,.bai,.crai,.csi,.vcf,.gz,.tbi,.bed,.gff,.gff3,.gtf,.bw,.bigwig,.bb,.bigbed,.bedgraph';
/** Pairs each data file with its index (x.bam + x.bam.bai or x.bai, x.vcf.gz + x.vcf.gz.tbi, …). */
export function pairFiles(files: File[]): { specs: Omit<TrackSpec, 'id'>[]; problems: string[] } {
  const idx = files.filter((f) => INDEX_RE.test(f.name)), data = files.filter((f) => !INDEX_RE.test(f.name)), specs: Omit<TrackSpec, 'id'>[] = [], problems: string[] = [];
  for (const f of data) {
    const fmt = FORMATS.find(([re]) => re.test(f.name)); if (!fmt) { problems.push(`${f.name}: unsupported file type`); continue; }
    const stem = f.name.replace(/\.(bam|cram|gz)$/i, ''), index = idx.find((i) => i.name === f.name + i.name.slice(i.name.lastIndexOf('.')) || i.name.startsWith(f.name + '.') || (fmt[1] === 'alignment' && i.name.replace(/\.(bai|crai|csi)$/i, '') === stem));
    if (fmt[1] === 'alignment' && !index) problems.push(`${f.name}: an index (.bai / .crai / .csi) is required; select it together with the alignment file`);
    else specs.push({ name: f.name, kind: fmt[1], format: fmt[2], data: f, index, filename: f.name, gz: /\.gz$/i.test(f.name) });
  }
  return { specs, problems };
}
const fromText = (name: string, text: string): Omit<TrackSpec, 'id'> | null => { const fmt = FORMATS.find(([re]) => re.test(name)); return fmt ? { name, kind: fmt[1], format: fmt[2], data: new Blob([text], { type: 'text/plain' }), filename: name, gz: false } : null; };

interface RefSpec { key: string; label: string; fasta: Blob; fai?: Blob; first: { id: string; length: number }; annotation?: Blob }
let seq = 0;

export function GenomeViewer({ mapped }: { mapped: Mapped | null }) {
  const { manifest } = useManifest(), view = useHandoff((s) => s.view);
  const host = useRef<HTMLDivElement>(null), br = useRef<IgvBrowser | null>(null), igv = useRef<IgvApi | null>(null), loaded = useRef(new Map<string, IgvTrack>()), urls = useRef(new Map<string, string[]>());
  const [choice, setChoice] = useState<string>('ecoli-k12'), [ref, setRef] = useState<RefSpec | null>(null), [tracks, setTracks] = useState<TrackSpec[]>([]), [err, setErr] = useState(''), [ready, setReady] = useState(false), [locus, setLocus] = useState(''), [local, setLocal] = useState<RefSpec | null>(null);
  const tracksRef = useRef(tracks); tracksRef.current = tracks;
  const mappedRef = useMemo<RefSpec | null>(() => { if (!mapped) return null; const f = parseFasta(mapped.refText)[0]; return { key: 'mapped', label: `Genome Studio reference (${f.id})`, fasta: new Blob([mapped.refText], { type: 'text/plain' }), first: { id: f.id, length: f.seq.length } }; }, [mapped]);

  // Resolve the reference the user picked.
  useEffect(() => {
    let live = true; setErr('');
    (async () => {
      if (choice === 'mapped') return mappedRef;
      if (choice === 'local') return local;
      const m = manifest?.genomes.find((g) => g.id === choice); if (!m) return null;
      const [fa, gff] = await Promise.all([loadBundledText(choice, 'fasta'), loadBundledText(choice, 'gff')]);
      return { key: choice, label: m.name, fasta: new Blob([fa], { type: 'text/plain' }), first: { id: m.sequences[0].id, length: m.sequences[0].length }, annotation: new Blob([gff], { type: 'text/plain' }) } as RefSpec;
    })().then((r) => live && setRef(r), (e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [choice, manifest, mappedRef, local]);

  const track = (t: TrackSpec) => {
    const u = [URL.createObjectURL(t.data)], cfg: Record<string, unknown> = { name: t.name, type: t.kind, format: t.format, url: u[0], filename: t.filename };
    if (t.index) { u.push(URL.createObjectURL(t.index)); cfg.indexURL = u[1]; } else if (t.kind !== 'alignment' && t.format !== 'bigwig' && t.format !== 'bigbed') cfg.indexed = false;
    if (t.kind === 'alignment') cfg.height = 260; if (t.kind === 'wig') { cfg.height = 70; cfg.autoscale = true; }
    urls.current.set(t.id, u); return cfg;
  };
  const addToBrowser = async (t: TrackSpec) => { const b = br.current; if (!b || loaded.current.has(t.id)) return; try { loaded.current.set(t.id, await b.loadTrack(track(t))); } catch (e) { setErr(`${t.name}: ${(e as Error).message}`); } };

  // (Re)create the browser when the reference changes, then load the current tracks.
  useEffect(() => {
    if (!ref || !host.current) return; let dead = false, el: HTMLDivElement | null = null;
    (async () => {
      try {
        igv.current ??= ((await import('igv')) as unknown as { default: IgvApi }).default; if (dead || !host.current) return;
        el = document.createElement('div'); host.current.appendChild(el); setReady(false);
        const fastaURL = URL.createObjectURL(ref.fasta), u = [fastaURL], faiURL = ref.fai ? URL.createObjectURL(ref.fai) : null, cfg: Record<string, unknown> = { reference: { id: ref.key, name: ref.label, fastaURL, ...(faiURL ? { indexURL: faiURL } : { indexed: false }) }, locus: `${ref.first.id}:1-${Math.min(ref.first.length, 8000)}`, tracks: [] };
        if (faiURL) u.push(faiURL);
        if (ref.annotation) { const au = URL.createObjectURL(ref.annotation); u.push(au); (cfg.tracks as unknown[]).push({ name: 'RefSeq genes', type: 'annotation', format: 'gff3', url: au, indexed: false, displayMode: 'EXPANDED', searchable: true }); }
        const b = await igv.current.createBrowser(el, cfg); if (dead) { igv.current.removeBrowser(b); return; }
        br.current = b; urls.current.set('__ref', u); loaded.current.clear(); setReady(true);
        for (const t of tracksRef.current) await addToBrowser(t);
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => { dead = true; try { if (br.current && igv.current) igv.current.removeBrowser(br.current); } catch { /* gone */ } br.current = null; el?.remove(); loaded.current.clear(); for (const l of urls.current.values()) l.forEach((x) => URL.revokeObjectURL(x)); urls.current.clear(); setReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  // Add tracks to a live browser.
  useEffect(() => { if (ready) for (const t of tracks) void addToBrowser(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tracks, ready]);

  const add = (specs: Omit<TrackSpec, 'id'>[]) => setTracks((t) => [...t, ...specs.map((s) => ({ ...s, id: `t${++seq}` }))]);
  const remove = (t: TrackSpec) => { const lt = loaded.current.get(t.id); if (lt && br.current) br.current.removeTrack(lt); loaded.current.delete(t.id); urls.current.get(t.id)?.forEach((x) => URL.revokeObjectURL(x)); setTracks((all) => all.filter((x) => x.id !== t.id)); };
  const onFiles = (list: FileList | null) => { if (!list) return; const { specs, problems } = pairFiles([...list]); add(specs); setErr(problems.join(' · ')); };
  useEffect(() => { if (view?.length) { const specs = view.flatMap((v) => { const s = v.file ? pairFiles([v.file]).specs : [fromText(v.name, v.text ?? '')].filter(Boolean) as Omit<TrackSpec, 'id'>[]; return s; }); add(specs); clearHandoffSoon('view'); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view]);
  const addMapping = () => { if (!mapped) return; setChoice('mapped'); const have = new Set(tracks.map((t) => t.name)); const specs: Omit<TrackSpec, 'id'>[] = []; if (!have.has('mapped.bam')) specs.push({ name: 'mapped.bam', kind: 'alignment', format: 'bam', data: new Blob([mapped.bam.slice().buffer as ArrayBuffer]), index: new Blob([mapped.bai.slice().buffer as ArrayBuffer]), filename: 'mapped.bam', gz: false }); if (mapped.calls.length && !have.has('mapped_variants.vcf')) specs.push({ name: 'mapped_variants.vcf', kind: 'variant', format: 'vcf', data: new Blob([mapped.vcf], { type: 'text/plain' }), filename: 'mapped_variants.vcf', gz: false }); add(specs); };
  const go = async () => { if (!locus.trim() || !br.current) return; try { setErr(''); await br.current.search(locus.trim()); } catch (e) { setErr((e as Error).message); } };

  return (<>
    <Card title="Genome viewer" sub="igv.js (MIT) · files stay on your computer" actions={<><span className="faint" style={{ fontSize: 12 }}>{ready ? 'drag to pan, scroll or +/− to zoom' : 'loading…'}</span><button className="btn sm" disabled={!ready} onClick={() => { const s = br.current?.toSVG(); if (s) downloadText('genome_view.svg', s, 'image/svg+xml'); }}>Export SVG</button></>}>
      <div className="row" style={{ marginBottom: 10, alignItems: 'flex-end' }}>
        <Field label="Reference"><select className="select" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Reference genome">{manifest?.genomes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}{mappedRef && <option value="mapped">{mappedRef.label}</option>}{local && <option value="local">{local.label}</option>}</select></Field>
        <Field label="Locus or gene"><input className="input" value={locus} placeholder="NC_000913.3:1000-2000 or lacZ" onChange={(e) => setLocus(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} aria-label="Locus search" /></Field>
        <button className="btn sm" disabled={!ready} onClick={() => void go()}>Go</button>
      </div>
      {err && <Callout kind="err">{err}</Callout>}
      <div ref={host} style={{ background: '#fff', borderRadius: 10, padding: 6, minHeight: 360, color: '#111' }} data-testid="igv-host" />
    </Card>
    <div className="cols-2">
      <Card title="Add tracks" sub="BAM/CRAM + index, VCF, BED, GFF/GTF, bigWig">
        <div className="stack" style={{ gap: 8 }}>
          <label className="dropzone"><input type="file" multiple hidden accept={DATA_ACCEPT} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} aria-label="Track files" />Choose track files (select an alignment and its .bai together)<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Read in place from disk. Never uploaded.</div></label>
          <label className="dropzone"><input type="file" multiple hidden accept=".fa,.fasta,.fna,.fai" onChange={async (e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; const fa = fs.find((f) => !/\.fai$/i.test(f.name)); if (!fa) return; const head = await fa.slice(0, 400).text(); const m = /^>(\S+)/.exec(head); setLocal({ key: 'local', label: `Your FASTA (${fa.name})`, fasta: fa, fai: fs.find((f) => /\.fai$/i.test(f.name)), first: { id: m?.[1] ?? 'seq', length: 8000 } }); setChoice('local'); }} aria-label="Reference FASTA" />Use your own reference FASTA<div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Loaded whole into memory (no .fai needed). Keep it to a few tens of Mb.</div></label>
          <div className="row"><button className="btn" disabled={!mapped} onClick={addMapping} title={mapped ? '' : 'Run Map & call in the Mapping tab first'}>Add Genome Studio mapping (BAM + variants)</button></div>
          {tracks.length > 0 && <div className="row" style={{ flexWrap: 'wrap' }}>{tracks.map((t) => <span key={t.id} className="badge live">{t.name} <button className="btn ghost sm" style={{ padding: '0 4px' }} aria-label={`Remove ${t.name}`} onClick={() => remove(t)}>×</button></span>)}</div>}
        </div>
      </Card>
      <Card title="Notes">
        <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>Alignments need an index (.bai, .crai or .csi); VCF and BED may be plain or .gz (unindexed files are read whole). CRAM is decoded against the selected reference. Bundled genomes carry their RefSeq gene track, which the search box understands. The view exports as SVG for figures. Whole-human-scale BAMs work only if they are indexed, because igv reads just the visible window.</div>
      </Card>
    </div>
  </>);
}

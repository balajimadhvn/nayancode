import { useEffect, useState } from 'react';
import { Callout, Field, FileDrop } from '@/ui/kit';
import { loadManifest, type Manifest } from './genomeData';
import type { GenomeSource } from './offtarget.worker';

/** Loads public/genomes/manifest.json once. */
export function useManifest() {
  const [m, setM] = useState<Manifest | null>(null), [err, setErr] = useState('');
  useEffect(() => { let live = true; loadManifest().then((x) => live && setM(x), (e: Error) => live && setErr(e.message)); return () => { live = false; }; }, []);
  return { manifest: m, error: err };
}
const mb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mb` : `${(n / 1e3).toFixed(0)} kb`);

/** Choose a bundled RefSeq genome or supply FASTA (and optionally GFF3) from disk. Nothing is uploaded. */
export function GenomePicker({ onChange }: { onChange(src: GenomeSource | null): void }) {
  const { manifest, error } = useManifest(), [sel, setSel] = useState('ecoli-k12'), [fa, setFa] = useState<{ name: string; text: string } | null>(null), [gff, setGff] = useState('');
  useEffect(() => { if (sel === 'upload') onChange(fa ? { kind: 'text', name: fa.name, fasta: fa.text, gff: gff || undefined } : null); else onChange({ kind: 'bundled', id: sel }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel, fa, gff]);
  const g = manifest?.genomes.find((x) => x.id === sel);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label="Genome"><select className="select" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Genome">
        {manifest?.genomes.map((x) => <option key={x.id} value={x.id}>{x.name} · {mb(x.totalLength)}</option>)}<option value="upload">Your own FASTA…</option></select></Field>
      {error && <Callout kind="err">{error}</Callout>}
      {g && <div className="faint" style={{ fontSize: 11.5 }}>{g.source} {g.accession} ({g.assemblyName}), {g.sequences.length} sequence{g.sequences.length > 1 ? 's' : ''}, {g.genes.toLocaleString()} genes. {manifest!.licence}</div>}
      {sel === 'upload' && <><FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t, n) => setFa({ name: n, text: t })} label={fa ? `Genome: ${fa.name}` : 'Genome FASTA (multi-FASTA; ≤ ~200 Mb in memory)'} /><FileDrop accept=".gff,.gff3,.txt" onText={(t) => setGff(t)} label={gff ? 'GFF3 annotation loaded' : 'Optional GFF3 for gene annotation'} /></>}
    </div>
  );
}

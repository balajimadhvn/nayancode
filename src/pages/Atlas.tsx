import { assetUrl } from '@/core/asset';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHandoff } from '@/core/handoff';
import { trackedFetch } from '@/core/net';
import type { ToolInfo } from '@/core/provenance';
import { geneCard, type GeneCard } from '@/studios/variants/evidence';
import { Busy, Callout, Card, DataTable, Field, Stat, fmt } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';

const TOOL: ToolInfo = { id: 'atlas.gene', name: 'Gene knowledge card', version: '0.1.0', engine: 'UniProt · Open Targets · CIViC · bundled Reactome / WikiPathways / GO', citations: ['uniprot2023', 'opentargets2023', 'civic2017', 'reactome2024', 'wikipathways2024', 'go2023'], describe: (p) => `Public annotations for ${p.gene} were retrieved from UniProt (CC BY 4.0), Open Targets (CC0) and CIViC (CC0); pathway membership used locally bundled Reactome, WikiPathways and Gene Ontology collections` };
interface Uni { acc: string; name: string; length: number; function: string; pdb: string[]; gene: string }
async function uniprot(sym: string): Promise<Uni | null> {
  const r = await trackedFetch(`https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`gene_exact:${sym} AND organism_id:9606 AND reviewed:true`)}&fields=accession,gene_primary,protein_name,cc_function,length,xref_pdb&format=json&size=1`), j = await r.json(), e = j.results?.[0]; if (!e) return null;
  return { acc: e.primaryAccession, gene: e.genes?.[0]?.geneName?.value ?? sym, name: e.proteinDescription?.recommendedName?.fullName?.value ?? '', length: e.sequence?.length ?? 0, function: e.comments?.find((c: { commentType: string }) => c.commentType === 'FUNCTION')?.texts?.[0]?.value ?? '', pdb: (e.uniProtKBCrossReferences ?? []).filter((x: { database: string }) => x.database === 'PDB').map((x: { id: string }) => x.id).slice(0, 12) };
}
interface Pack { genes: string[]; sets: { id: string; name: string; g: number[] }[] }
const cache = new Map<string, Pack>();
async function pathways(sym: string): Promise<{ db: string; id: string; name: string }[]> {
  const out: { db: string; id: string; name: string }[] = [], base = assetUrl('data/');
  for (const [db, file] of [['Reactome', 'reactome_human.json'], ['WikiPathways', 'wikipathways_human.json']] as const) { if (!cache.has(file)) cache.set(file, await fetch(base + file).then((r) => r.json())); const p = cache.get(file)!, gi = p.genes.findIndex((g) => g.toUpperCase() === sym); if (gi >= 0) for (const s of p.sets) if (s.g.includes(gi)) out.push({ db, id: String(s.id), name: s.name }); }
  return out;
}
export default function Atlas() {
  const { run, busy, error } = useRunner(); const nav = useNavigate(), setHand = useHandoff((s) => s.setStructure);
  const [q, setQ] = useState('BRAF'), [card, setCard] = useState<GeneCard | null>(null), [uni, setUni] = useState<Uni | null>(null), [pw, setPw] = useState<{ db: string; id: string; name: string }[]>([]), [sym, setSym] = useState('');
  const go = () => { const s = q.trim().toUpperCase(); if (!s) return; if (!confirm(`This sends the gene symbol "${s}" to UniProt, Open Targets and CIViC (public databases). Nothing else is sent.\n\nContinue?`)) return; void run({ label: `Atlas · ${s}`, tool: TOOL, params: { gene: s }, inputs: [], run: async () => { const [c, u, p] = await Promise.all([geneCard(s), uniprot(s), pathways(s)]); return { c, u, p }; } }).then((r) => { if (r) { setCard(r.c); setUni(r.u); setPw(r.p); setSym(s); } }); };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Atlas</h1><p>One place for what is publicly known about a gene: function, structure, disease associations, cancer evidence and pathways. Openly licensed sources only (UniProt, Open Targets, CIViC, Reactome, WikiPathways, GO).</p></div></div>
      <Card title="Gene lookup"><div className="row" style={{ alignItems: 'flex-end' }}><Field label="HGNC gene symbol"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} style={{ width: 160 }} /></Field><button className="btn primary" disabled={busy} onClick={go}>Look up</button></div>{busy && <div style={{ marginTop: 10 }}><Busy progress={0.5} note="Querying public databases…" /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}</Card>
      {card && <>
        <Card title={`${card.symbol} · ${card.name}`} sub="Open Targets (CC0) + UniProt (CC BY 4.0)">
          <div className="stack" style={{ gap: 10 }}>
            {uni && <div className="cols-4"><Stat label="UniProt" value={<span style={{ fontSize: 15 }}>{uni.acc}</span>} /><Stat label="Length (aa)" value={uni.length} /><Stat label="PDB entries" value={uni.pdb.length ? `${uni.pdb.length}+` : '0'} /><Stat label="Pathways" value={pw.length} /></div>}
            {uni?.function && <p className="dim">{uni.function}</p>}{!uni?.function && card.summary && <p className="dim">{card.summary}</p>}
            {uni && <div className="row"><button className="btn" onClick={() => { setHand({ kind: 'af', id: uni.acc }); nav('/structure'); }}>Open AlphaFold model in Structure Studio</button>{uni.pdb.slice(0, 4).map((id) => <button key={id} className="btn sm" onClick={() => { setHand({ kind: 'pdb', id }); nav('/structure'); }}>PDB {id}</button>)}<button className="btn sm" onClick={() => nav('/variants')}>Variant evidence →</button></div>}
            {card.civicDescription && <p className="dim" style={{ fontSize: 13 }}><b style={{ color: 'var(--text)' }}>CIViC:</b> {card.civicDescription.slice(0, 600)}{card.civicDescription.length > 600 ? '…' : ''}</p>}
          </div>
        </Card>
        <div className="cols-2"><Card title="Disease associations" sub="Open Targets overall score" pad={false}><DataTable rows={card.diseases} rowKey={(d) => d.id} cols={[{ key: 'n', label: 'Disease' }, { key: 's', label: 'Score', num: true, sort: (d) => d.score, render: (d) => fmt(d.score, 3) }]} /></Card>
          <Card title="Pathways containing this gene" sub="bundled offline" pad={false}>{pw.length ? <DataTable rows={pw} limit={80} rowKey={(p) => p.db + p.id} cols={[{ key: 'db', label: 'Source', sort: (p) => p.db }, { key: 'n', label: 'Pathway', sort: (p) => p.name, render: (p) => p.name }]} /> : <div className="faint" style={{ padding: 16 }}>Not found in the bundled collections for symbol {sym}.</div>}</Card></div>
      </>}
    </div>
  );
}

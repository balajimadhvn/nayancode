import { useEffect, useMemo, useState } from 'react';
import { assetUrl } from '@/core/asset';
import { trackedFetch } from '@/core/net';
import { Callout, Card, DataTable, Field, downloadText, toCsv } from '@/ui/kit';
import type { GeneSetPack } from './enrichment';
import type { DeRow } from './kernels';
import { coMembershipNetwork, communities, degrees, forceLayout, type Net } from './network';

const CAT = ['#4c72b0', '#dd8452', '#55a868', '#c44e52', '#8172b3', '#937860', '#da8bc3', '#8c8c8c'];
const W = 700, H = 500, PAD = 46;

type Source = 'reactome' | 'string';
let packCache: Promise<Record<string, string[]>> | null = null;
/** The bundled Reactome collection, cached for the session (same file the enrichment tests use). */
const reactomeSets = () => (packCache ??= fetch(assetUrl('data/reactome_human.json')).then((r) => r.json() as Promise<GeneSetPack>)
  .then((p) => Object.fromEntries(p.sets.map((s) => [s.id, s.g.map((i) => p.genes[i])]))));

interface StringHit { preferredName_A?: string; preferredName_B?: string; score?: number }
async function stringNetwork(genes: string[]): Promise<Net> {
  const url = `https://string-db.org/api/json/network?identifiers=${genes.map((g) => encodeURIComponent(g)).join('%0d')}&species=9606&required_score=700`;
  const data = (await (await trackedFetch(url, { headers: { Accept: 'application/json' } })).json()) as StringHit[];
  const nodes: string[] = genes.map((g) => g.toUpperCase());
  const index = new Map<string, number>(nodes.map((g, i): [string, number] => [g, i]));
  const w = new Map<number, number>();
  for (const e of data) {
    const a = index.get((e.preferredName_A ?? '').toUpperCase()), b = index.get((e.preferredName_B ?? '').toUpperCase());
    if (a === undefined || b === undefined || a === b) continue;
    const key = Math.min(a, b) * nodes.length + Math.max(a, b);
    w.set(key, Math.max(w.get(key) ?? 0, Math.round((e.score ?? 0) * 1000) / 1000));
  }
  return { nodes, edges: [...w.entries()].map(([key, weight]) => ({ a: Math.floor(key / nodes.length), b: key % nodes.length, w: weight })).sort((p, q) => p.a - q.a || p.b - q.b) };
}

export default function NetworkView({ de }: { de: { rows: DeRow[] } }) {
  const [n, setN] = useState(60), [net, setNet] = useState<Net | null>(null), [via, setVia] = useState<Source>('reactome');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const genes = useMemo(() => de.rows.slice().sort((a, b) => a.fdr - b.fdr || Math.abs(b.log2FC) - Math.abs(a.log2FC)).slice(0, n).map((r) => r.gene.toUpperCase()), [de, n]);
  const key = genes.join(',');

  useEffect(() => {
    let live = true; setError(null); setBusy(true); setVia('reactome');
    reactomeSets().then((sets) => {
      if (!live) return;
      setNet(coMembershipNetwork(genes, sets));
    }).catch((e: Error) => live && setError(`Could not load the bundled Reactome collection: ${e.message}`))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchString = async () => {
    setBusy(true); setError(null);
    try { setNet(await stringNetwork(genes)); setVia('string'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const nodes = net?.nodes ?? [], edges = net?.edges ?? [];
  const deg = useMemo(() => degrees(nodes.length, edges), [nodes.length, edges]);
  const comm = useMemo(() => communities(nodes.length, edges), [nodes.length, edges]);
  const pos = useMemo(() => forceLayout(nodes.length, edges, { width: W - 2 * PAD, height: H - 2 * PAD, seed: 42 }), [nodes.length, edges]);
  const hubs = useMemo(() => nodes.map((g, i) => ({ gene: g, degree: deg[i], community: comm[i] })).sort((a, b) => b.degree - a.degree || a.gene.localeCompare(b.gene)).slice(0, 15), [nodes, deg, comm]);
  const maxDeg = Math.max(1, ...deg), labelled = new Set(hubs.filter((h) => h.degree > 0).map((h) => h.gene));
  const isolated = deg.filter((d) => d === 0).length;

  return (
    <>
      <Card title="Gene network" sub={`top ${genes.length} genes by adjusted p · ${via === 'string' ? 'STRING interactions' : 'Reactome pathway co-membership'}`}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Top genes"><input className="input" type="number" min={5} max={200} step={5} value={n} onChange={(e) => setN(Math.min(200, Math.max(5, +e.target.value)))} style={{ width: 100 }} /></Field>
          <button className="btn" disabled={busy} onClick={() => { setBusy(true); reactomeSets().then((sets) => { setNet(coMembershipNetwork(genes, sets)); setVia('reactome'); }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); }}>Reactome co-membership</button>
          <button className="btn" disabled={busy || !genes.length} onClick={() => void fetchString()}>Fetch STRING interactions</button>
          <button className="btn sm" disabled={!edges.length} onClick={() => { downloadText('gene_network_edges.csv', toCsv(edges.map((e) => ({ source: via === 'string' ? 'STRING' : 'Reactome', gene_a: nodes[e.a], gene_b: nodes[e.b], weight: e.w }))), 'text/csv'); }}>Export edges CSV</button>
          {busy && <span className="faint" style={{ fontSize: 12 }}>Building…</span>}
        </div>
        <Callout>Edges from shared Reactome pathways indicate shared biology, not physical interaction. STRING (if enabled) shows curated and predicted interactions. Pathways with more than 200 genes are ignored so that they do not connect everything. Only gene symbols are sent to string-db.org.</Callout>
        {error && <Callout kind="err">{error}</Callout>}
        {net && <>
          <div className="row" style={{ gap: 14, fontSize: 12, margin: '6px 0' }}>
            <span className="faint">{nodes.length} genes · {edges.length} edges · colour = Louvain community · node size = weighted degree{isolated ? ` · ${isolated} unconnected` : ''}</span>
          </div>
          {!edges.length
            ? <div className="faint" style={{ padding: '28px 6px', textAlign: 'center' }}>These genes share no pathway below the 200-gene cap{via === 'string' ? ' in STRING at the 700 confidence threshold' : ''}.</div>
            : <div className="chart" style={{ overflow: 'auto' }}>
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gene network of ${nodes.length} genes and ${edges.length} edges`}>
                <g transform={`translate(${PAD},${PAD})`}>
                  {edges.map((e, i) => <line key={i} x1={pos[e.a][0]} y1={pos[e.a][1]} x2={pos[e.b][0]} y2={pos[e.b][1]} stroke="var(--border-hi)" strokeWidth={0.6 + 0.6 * Math.min(1, Math.log2(1 + e.w) / 2)} strokeOpacity={0.8} />)}
                  {nodes.map((g, i) => <circle key={g} cx={pos[i][0]} cy={pos[i][1]} r={3 + 9 * Math.sqrt(deg[i] / maxDeg)} fill={deg[i] ? CAT[comm[i] % CAT.length] : 'var(--text-faint)'} fillOpacity={deg[i] ? 0.85 : 0.4} stroke="var(--surface-solid)" strokeWidth={0.8} />)}
                  {nodes.map((g, i) => labelled.has(g) && <text key={`t-${g}`} x={pos[i][0] + 6 + 3 * Math.sqrt(deg[i] / maxDeg)} y={pos[i][1] + 3} fontSize={10} fill="var(--text-dim)" fontFamily="var(--mono)">{g}</text>)}
                </g>
              </svg>
            </div>}
        </>}
      </Card>
      {net && <Card title="Hubs" sub={`${hubs.filter((h) => h.degree > 0).length} highest-degree genes`} pad={false}>
        <DataTable rows={hubs.filter((h) => h.degree > 0)} rowKey={(r) => r.gene} cols={[
          { key: 'gene', label: 'Gene', sort: (r) => r.gene },
          { key: 'degree', label: 'Weighted degree', num: true, render: (r) => String(r.degree), sort: (r) => r.degree },
          { key: 'community', label: 'Community', num: true, render: (r) => `C${r.community + 1}`, sort: (r) => r.community },
        ]} />
      </Card>}
    </>
  );
}

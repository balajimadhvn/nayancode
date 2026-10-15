import { assetUrl } from '@/core/asset';
import { useEffect, useMemo, useState } from 'react';
import { DATA_SOURCES, NOT_USED, REPLACEMENTS } from '@/core/data-sources';
import { Callout, Card, DataTable } from '@/ui/kit';

interface Pkg { name: string; version: string; license: string; repo: string; homepage: string }
export default function Licenses() {
  const [data, setData] = useState<{ generated: string; allow: string[]; packages: Pkg[] } | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { fetch(assetUrl('licenses.json')).then((r) => r.json()).then(setData).catch(() => setErr(true)); }, []);
  const groups = useMemo(() => { const m = new Map<string, number>(); data?.packages.forEach((p) => m.set(p.license, (m.get(p.license) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [data]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Licences & data sources</h1><p>Everything this site ships or calls, with its terms. The production build fails automatically if any dependency has a licence outside the allow-list.</p></div></div>
      <Card title="Software" sub={data ? `${data.packages.length} production packages · audited ${data.generated}` : ''}>
        {err && <Callout kind="warn">licenses.json not found. Run <code>npm run licenses</code>.</Callout>}
        {data && <div className="row" style={{ gap: 8 }}>{groups.map(([l, n]) => <span key={l} className="badge live">{l} · {n}</span>)}</div>}
        <div className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>Allowed: {data?.allow.join(', ')}. All are permissive: commercial use, modification and redistribution are permitted with attribution (kept in each package's licence file; fonts under the SIL Open Font License 1.1).</div>
      </Card>
      {data && <Card title="Package list" pad={false}><DataTable rows={data.packages} limit={400} rowKey={(p) => p.name + p.version} cols={[{ key: 'name', label: 'Package', sort: (p) => p.name }, { key: 'version', label: 'Version' }, { key: 'license', label: 'Licence', sort: (p) => p.license }]} /></Card>}
      <Card title="External data & services" pad={false}><DataTable rows={DATA_SOURCES} rowKey={(d) => d.name} cols={[{ key: 'name', label: 'Source', render: (d) => (d.url ? <a href={d.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{d.name}</a> : d.name) }, { key: 'kind', label: 'Type', sort: (d) => d.kind, render: (d) => <span className="badge planned">{d.kind}</span> }, { key: 'use', label: 'Used for' }, { key: 'terms', label: 'Terms' }, { key: 'commercialOk', label: 'Commercial use', render: (d) => <span className={`badge ${d.commercialOk ? 'live' : 'building'}`}>{d.commercialOk ? 'allowed' : 'restricted'}</span> }, { key: 'attribution', label: 'Attribution' }]} /></Card>
      <Card title="Restricted tools and what replaces them" pad={false}><DataTable rows={REPLACEMENTS} rowKey={(r) => r[0]} cols={[{ key: 'a', label: 'Restricted / risky', render: (r) => r[0] }, { key: 'b', label: 'Replaced by', render: (r) => r[1] }, { key: 'c', label: 'Where', render: (r) => <span className="dim">{r[2]}</span> }]} /></Card>
      <Card title="Deliberately not used" sub="to avoid commercial-licence problems"><div className="stack" style={{ gap: 8 }}>{NOT_USED.map(([n, why]) => <div key={n} className="row" style={{ justifyContent: 'space-between', gap: 20 }}><span>{n}</span><span className="faint" style={{ fontSize: 12.5, textAlign: 'right' }}>{why}</span></div>)}</div></Card>
      <Callout>This page is engineering documentation, not legal advice. Have a lawyer review it before a commercial launch, especially data-licence terms for any service you add later.</Callout>
    </div>
  );
}

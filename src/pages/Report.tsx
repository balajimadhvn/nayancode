import { useEffect, useMemo } from 'react';
import { BRAND } from '@/core/brand';
import { buildMethods, useProvenance } from '@/core/provenance';
import { useReport } from '@/core/report';
import { Callout, Card, downloadText } from '@/ui/kit';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export default function Report() {
  const r = useReport(), records = useProvenance((s) => s.records);
  useEffect(() => { void r.hydrate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const { text, refs } = useMemo(() => buildMethods(records), [records]);
  const html = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
body{font:15px/1.6 Georgia,'Times New Roman',serif;max-width:820px;margin:40px auto;padding:0 24px;color:#111}h1{font:700 28px/1.2 system-ui,sans-serif}h2{font:600 18px system-ui,sans-serif;margin-top:34px;border-bottom:1px solid #ccc;padding-bottom:4px}
figure{margin:22px 0;page-break-inside:avoid}figure img{max-width:100%;border:1px solid #ddd;border-radius:6px}figcaption{font-size:13px;color:#444;margin-top:6px}.meta{color:#555;font:13px system-ui,sans-serif}
table{border-collapse:collapse;width:100%;font:12px system-ui,sans-serif}td,th{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}ol{font-size:13px}footer{margin-top:40px;font:12px system-ui,sans-serif;color:#666}</style></head><body>
<h1>${esc(r.title)}</h1><div class="meta">${esc(r.author)}${r.author ? ' · ' : ''}${new Date().toLocaleDateString()} · generated with ${BRAND.name} ${BRAND.version}; all analyses were computed locally in the browser</div>
${r.intro ? `<p>${esc(r.intro).replace(/\n/g, '<br>')}</p>` : ''}
${r.figures.length ? '<h2>Results</h2>' + r.figures.map((f, i) => `<figure><img src="${f.png}" alt="Figure ${i + 1}"><figcaption><b>Figure ${i + 1}.</b> ${esc(f.title)}${f.caption ? ': ' + esc(f.caption) : ''} <i>(${esc(f.studio)})</i></figcaption></figure>`).join('') : ''}
${text ? `<h2>Methods</h2><p>${esc(text)}</p><h2>References</h2><ol>${refs.map((x) => `<li>${esc(x.replace(/^\[\d+\]\s*/, ''))}</li>`).join('')}</ol>` : ''}
${records.length ? `<h2>Provenance</h2><table><tr><th>Tool</th><th>Version</th><th>Time</th><th>Parameters</th><th>Inputs (SHA-256)</th></tr>${records.map((x) => `<tr><td>${esc(x.toolName)}</td><td>${esc(x.toolVersion)}</td><td>${esc(x.startedAt)}</td><td>${esc(JSON.stringify(x.params))}</td><td>${x.inputs.map((i) => esc(i.name) + ': ' + i.sha256.slice(0, 16) + '…').join('<br>')}</td></tr>`).join('')}</table>` : ''}
<footer>Research use only. Open-source components and data sources are listed on the application's Licences page.</footer></body></html>`;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Report</h1><p>Collect figures from any studio (camera button on a chart card), add notes, and export one self-contained HTML report that includes the auto-written Methods, references and provenance.</p></div>
        <div className="row"><button className="btn primary" onClick={() => downloadText(`${r.title.replace(/\W+/g, '_') || 'report'}.html`, html(), 'text/html')}>Export HTML</button><button className="btn" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(html()); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); } }}>Print / save as PDF</button></div></div>
      <Card title="Document">
        <div className="stack" style={{ gap: 10 }}>
          <div className="cols-2"><label className="field">Title<input className="input" value={r.title} onChange={(e) => r.set({ title: e.target.value })} /></label><label className="field">Author<input className="input" value={r.author} onChange={(e) => r.set({ author: e.target.value })} /></label></div>
          <label className="field">Introduction / notes<textarea className="input" style={{ fontFamily: 'var(--font)' }} value={r.intro} onChange={(e) => r.set({ intro: e.target.value })} placeholder="Study design, samples, what was analysed…" /></label>
        </div>
      </Card>
      <Card title="Figures" sub={`${r.figures.length} collected`} actions={r.figures.length ? <button className="btn sm ghost" onClick={() => r.set({ figures: [] })}>Clear figures</button> : undefined}>
        {r.figures.length === 0 && <div className="faint">No figures yet. Open a studio, run an analysis, and press the camera icon in a chart card's header.</div>}
        <div className="stack" style={{ gap: 14 }}>{r.figures.map((f, i) => (
          <div key={f.id} className="card card-pad" style={{ display: 'grid', gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><b>Figure {i + 1} · {f.title}</b><span className="row"><span className="faint" style={{ fontSize: 12 }}>{f.studio}</span><button className="btn sm ghost" onClick={() => r.move(f.id, -1)} disabled={i === 0}>↑</button><button className="btn sm ghost" onClick={() => r.move(f.id, 1)} disabled={i === r.figures.length - 1}>↓</button><button className="btn sm ghost" onClick={() => r.remove(f.id)}>Remove</button></span></div>
            <img src={f.png} alt={f.title} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
            <input className="input" placeholder="Caption" value={f.caption} onChange={(e) => r.caption(f.id, e.target.value)} />
          </div>))}</div>
      </Card>
      <Card title="Methods (auto-generated)" sub={`${records.length} recorded analyses`}>{text ? <div className="seqbox" style={{ fontFamily: 'var(--font)', fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 'none' }}>{text}</div> : <div className="faint">Run analyses in any studio and the Methods paragraph writes itself.</div>}</Card>
      <Callout>The report is stored only in this browser (IndexedDB). Export it to keep a copy.</Callout>
    </div>
  );
}

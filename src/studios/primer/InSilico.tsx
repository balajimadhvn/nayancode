import { useState } from 'react';
import { Callout, Card, DataTable, Field, FileDrop, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { parseFasta, revComp } from '@/studios/sequence/kernels';
import { demoTemplate } from './demo';
import { PCR_TOOL } from './meta';
import { inSilicoPcr, parsePrimers, type PcrResult } from './pcr';

export default function InSilico() {
  const [templatesText, setTemplatesText] = useState('');
  const [primersText, setPrimersText] = useState('');
  const [maxMm, setMaxMm] = useState(2), [min3, setMin3] = useState(8), [maxSize, setMaxSize] = useState(5000);
  const [res, setRes] = useState<PcrResult | null>(null), [sel, setSel] = useState(0);
  const { run, busy, error } = useRunner();

  const go = (tplText = templatesText, prText = primersText, mm = maxMm, m3 = min3, ms = maxSize) => {
    const templates = parseFasta(tplText).map((r) => ({ name: r.id, seq: r.seq }));
    const primers = parsePrimers(prText);
    if (!templates.length || !primers.length) return;
    setRes(null); setSel(0);
    void run({
      label: `In-silico PCR · ${primers.length} primer(s)`, tool: PCR_TOOL,
      params: { maxMm: mm, min3: m3, maxSize: ms, templates: templates.length, primers: primers.length },
      inputs: [{ name: 'templates', data: `${templates.length} sequence(s)` }, { name: 'primers', data: `${primers.length} primer(s)` }],
      run: async () => inSilicoPcr(templates, primers, { maxMm: mm, min3: m3, maxSize: ms }),
      summary: (r) => `${r.products.length} product(s) and ${r.single.length} orphan site(s)`,
    }).then((r) => r && setRes(r));
  };

  const demo = () => {
    const t = demoTemplate(), f = t.slice(300, 320), r = revComp(t.slice(800, 820));
    const tpl = `>demo_template\n${t}`;
    const pr = `F\t${f}\nR\t${r}`;
    setTemplatesText(tpl); setPrimersText(pr); go(tpl, pr);
  };

  const p = res?.products[sel];

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Templates">
        <div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => { setTemplatesText(t); setRes(null); }} label={templatesText ? 'Templates loaded' : 'Template FASTA'} />
          <textarea className="input mono" rows={5} value={templatesText} onChange={(e) => { setTemplatesText(e.target.value); setRes(null); }} spellCheck={false} placeholder=">template1&#10;ACGT…" aria-label="Templates" />
          <div className="faint" style={{ fontSize: 12 }}>{parseFasta(templatesText).length} template(s)</div>
        </div>
      </Card>
      <Card title="2 · Primers">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input mono" rows={4} value={primersText} onChange={(e) => { setPrimersText(e.target.value); setRes(null); }} spellCheck={false} placeholder={'F  ACGTACGT…\nR  revcomp…'} aria-label="Primers" />
          <div className="faint" style={{ fontSize: 12 }}>{parsePrimers(primersText).length} primer(s); one per line as name + sequence, or FASTA.</div>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Max mismatches"><input className="input" type="number" min={0} value={maxMm} onChange={(e) => setMaxMm(+e.target.value)} /></Field>
            <Field label="Exact 3′ bases"><input className="input" type="number" min={1} value={min3} onChange={(e) => setMin3(+e.target.value)} /></Field>
            <Field label="Max product size (bp)"><input className="input" type="number" min={1} value={maxSize} onChange={(e) => setMaxSize(+e.target.value)} /></Field>
          </div>
          <div className="row"><button className="btn primary" disabled={busy || !templatesText.trim() || !primersText.trim()} onClick={() => go()}>{busy ? 'Running…' : 'Run in-silico PCR'}</button><button className="btn sm" onClick={demo}>Demo: 2-kb template, F/R</button></div>
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Binding is ungapped: the last {min3} bases at each primer's 3′ end must match exactly and the rest may carry at most {maxMm} mismatches. Products are predicted only within one template.</Callout>
    </div>
    <div className="stack">
      <Card title="Products" sub={res ? `${res.products.length} product(s), ${res.single.length} orphan site(s)` : undefined} pad={false} actions={<button className="btn sm" disabled={!res?.products.length} onClick={() => res && downloadText('insilico_pcr_products.csv', toCsv(res.products.map((q) => ({ template: q.template, forward: q.f, reverse: q.r, start: q.start, end: q.end, size: q.size, mismatches: q.mismatches }))), 'text/csv')}>CSV</button>}>
        {!res ? <div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter templates and primers, or load the demo, to predict PCR products.</div> : res.products.length === 0 ? <div style={{ padding: 16 }}><Callout kind="warn">No product was predicted. Check primer orientation, the exact 3′ end and the maximum product size.</Callout></div> : <DataTable rows={res.products} rowKey={(q, i) => `${q.template}:${q.start}:${q.end}:${i}`} onRow={(q) => setSel(res.products.indexOf(q))} cols={[
          { key: 't', label: 'Template' },
          { key: 'f', label: 'Forward' },
          { key: 'r', label: 'Reverse' },
          { key: 's', label: 'Start–end', num: true, sort: (q) => q.start, render: (q) => `${q.start.toLocaleString()}–${q.end.toLocaleString()}` },
          { key: 'z', label: 'Size (bp)', num: true, sort: (q) => q.size },
          { key: 'mm', label: 'Mismatches', num: true, sort: (q) => q.mismatches },
        ]} />}
      </Card>
      {p && <Card title="Amplicon sequence" sub={`${p.template} · ${p.size} bp`}><div className="seqbox mono" style={{ maxHeight: 260, overflowWrap: 'anywhere' }}>{p.sequence}</div></Card>}
      {res && res.single.length > 0 && <Card title="Orphan primer sites" sub="sites that did not form a product" pad={false}>
        <DataTable rows={res.single} rowKey={(s, i) => `${s.template}:${s.primer}:${s.start}:${s.strand}:${i}`} cols={[
          { key: 't', label: 'Template', render: (s) => s.template },
          { key: 'p', label: 'Primer', render: (s) => s.primer },
          { key: 'pos', label: 'Position', num: true, sort: (s) => s.start, render: (s) => `${s.start.toLocaleString()}${s.strand}` },
          { key: 'mm', label: 'Mismatches', num: true, sort: (s) => s.mismatches },
        ]} />
      </Card>}
      {res && <div className="faint" style={{ fontSize: 12 }}>Coordinates are 1-based on the plus strand; {fmt(res.products.length, 0)} product(s) shown.</div>}
    </div></div>
  );
}

import { useEffect, useState } from 'react';
import { Callout, Card, Field, FileDrop, downloadText } from '@/ui/kit';
import { formatDuration, fromJson, toJson, toMarkdown, type Protocol, type ProtocolStep } from './format';
import { TEMPLATES } from './templates';

interface Props {
  protocol: Protocol;
  setProtocol(p: Protocol): void;
  onSave(p: Protocol): void;
  blocked: boolean;
}

const empty: Protocol = { title: 'Untitled protocol', steps: [] };
const clone = (p: Protocol): Protocol => JSON.parse(JSON.stringify(p)) as Protocol;

export default function ProtocolTab({ protocol, setProtocol, onSave, blocked }: Props) {
  const [runMode, setRunMode] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [timer, setTimer] = useState<{ index: number; remaining: number; running: boolean } | null>(null);
  const [template, setTemplate] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!timer?.running) return;
    const id = setInterval(() => setTimer((t) => {
      if (!t?.running) return t;
      if (t.remaining <= 1) return { ...t, remaining: 0, running: false };
      return { ...t, remaining: t.remaining - 1 };
    }), 1000);
    return () => clearInterval(id);
  }, [timer?.running]);

  const apply = (p: Protocol) => { setProtocol(clone(p)); setDone(new Set()); setTimer(null); setError(''); setSaved(false); };
  const update = (i: number, patch: Partial<ProtocolStep>) => setProtocol({ ...protocol, steps: protocol.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addStep = () => setProtocol({ ...protocol, steps: [...protocol.steps, { text: 'New step' }] });
  const toggle = (i: number) => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const start = (i: number) => {
    const minutes = protocol.steps[i]?.minutes ?? 0;
    setTimer((t) => t?.index === i ? { ...t, running: !t.running } : { index: i, remaining: Math.round(minutes * 60), running: true });
  };

  const importJson = (text: string) => {
    const r = fromJson(text);
    if (!r.ok) { setError(r.error); return; }
    apply(r.protocol);
  };

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Template and title">
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Start from a template">
            <select className="select" value={template} onChange={(e) => {
              setTemplate(e.target.value);
              const t = TEMPLATES.find((x) => x.title === e.target.value);
              apply(t ? clone(t) : empty);
            }}>
              <option value="">Blank protocol</option>
              {TEMPLATES.map((t) => <option key={t.title} value={t.title}>{t.title}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className="input" value={protocol.title} onChange={(e) => { setProtocol({ ...protocol, title: e.target.value }); setSaved(false); }} /></Field>
          <Field label="Description"><textarea className="input" rows={2} value={protocol.description ?? ''} onChange={(e) => { setProtocol({ ...protocol, description: e.target.value }); setSaved(false); }} /></Field>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn sm ${runMode ? 'primary' : ''}`} onClick={() => setRunMode((v) => !v)}>{runMode ? 'Edit mode' : 'Run mode'}</button>
            <button className="btn sm" onClick={addStep}>Add step</button>
          </div>
        </div>
      </Card>
      <Card title="2 · Steps" sub={`${protocol.steps.length} step(s) · ${done.size} ticked`}>
        {!protocol.steps.length ? <div className="faint" style={{ padding: 20, textAlign: 'center' }}>Enter a title and add steps, or start from a template.</div> : <div className="stack" style={{ gap: 10 }}>
          {protocol.steps.map((s, i) => <div key={i} className="stack" style={{ gap: 6, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Step ${i + 1} done`} style={{ marginTop: 9 }} />
              <span className="faint mono" style={{ minWidth: 22, marginTop: 8 }}>{i + 1}</span>
              {runMode ? <div style={{ flex: 1, paddingTop: 6 }}>{s.text}{s.note && <div className="faint" style={{ fontSize: 12 }}>{s.note}</div>}</div> : <div className="stack" style={{ flex: 1, gap: 6 }}>
                <textarea className="input" rows={2} value={s.text} onChange={(e) => update(i, { text: e.target.value })} aria-label={`Step ${i + 1} text`} />
                <div className="cols-2" style={{ gap: 6 }}>
                  <Field label="Minutes"><input className="input" type="number" min={0} step="0.5" value={s.minutes ?? ''} onChange={(e) => update(i, { minutes: e.target.value ? +e.target.value : undefined })} /></Field>
                  <Field label="Note"><input className="input" value={s.note ?? ''} onChange={(e) => update(i, { note: e.target.value || undefined })} /></Field>
                </div>
              </div>}
              {s.minutes ? <div className="row" style={{ gap: 4, marginTop: 4 }}>
                <button className="btn sm" onClick={() => start(i)}>{timer?.index === i && timer.running ? 'Pause' : 'Start'}</button>
                {timer?.index === i && <span className="mono" style={{ minWidth: 52, textAlign: 'right' }}>{formatDuration(timer.remaining)}</span>}
              </div> : null}
              {!runMode && <button className="btn sm" onClick={() => setProtocol({ ...protocol, steps: protocol.steps.filter((_, j) => j !== i) })} aria-label={`Remove step ${i + 1}`}>×</button>}
            </div>
          </div>)}
        </div>}
      </Card>
      <Callout>Run mode keeps a checklist and a countdown timer for any step with minutes. The timer runs only while this tab stays open; it stops when you leave the page.</Callout>
    </div>
    <div className="stack">
      <Card title="Protocol card" actions={<div className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => { onSave(protocol); setSaved(true); }}>Save</button><button className="btn sm" onClick={() => window.print()}>Print</button></div>}>
        <div className="printable">
          <h2 style={{ marginTop: 0 }}>{protocol.title}</h2>
          {protocol.description && <p className="faint">{protocol.description}</p>}
          <ol>{protocol.steps.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s.text}{s.minutes ? <span className="faint"> ({s.minutes} min)</span> : null}{s.note && <div className="faint" style={{ fontSize: 12 }}>{s.note}</div>}</li>)}</ol>
          {protocol.mix && <div className="faint" style={{ fontSize: 12 }}>Master mix: {protocol.mix.reactions} reaction(s), {protocol.mix.finalVolume} µL each, {protocol.mix.overagePct} % overage. Open the Master mix tab to rescale or edit it.</div>}
          {protocol.note && <p className="faint" style={{ fontStyle: 'italic' }}>{protocol.note}</p>}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => downloadText('protocol.md', toMarkdown(protocol), 'text/markdown')}>Markdown</button>
          <button className="btn sm" onClick={() => downloadText('protocol.json', toJson(protocol), 'application/json')}>JSON</button>
          <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>{saved ? (blocked ? 'Not saved: browser storage is blocked' : 'Saved in this browser') : 'Not saved yet'}</span>
        </div>
      </Card>
      <Card title="Import JSON">
        <FileDrop accept=".json,application/json" onText={importJson} label="Drop a protocol JSON file" />
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Imported files are parsed as data; nothing is executed. Missing titles or steps are rejected.</div>
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
    </div></div>
  );
}

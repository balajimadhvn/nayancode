import { useMemo, useState } from 'react';
import { Callout, Card, Field, downloadText } from '@/ui/kit';
import type { Protocol } from './format';
import { newId, type NotebookEntry } from './store';

interface Props {
  entries: NotebookEntry[];
  protocols: Protocol[];
  onChange(entries: NotebookEntry[]): void;
  blocked: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function NotebookTab({ entries, protocols, onChange, blocked }: Props) {
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [linked, setLinked] = useState('');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...entries].reverse().filter((e) => !q || [e.title, e.text, e.protocol ?? '', e.date].some((v) => v.toLowerCase().includes(q)));
  }, [entries, query]);

  const add = () => {
    if (!title.trim()) return;
    onChange([...entries, { id: newId('note'), date, title: title.trim(), text: text.trim(), ...(linked ? { protocol: linked } : {}) }]);
    setTitle(''); setText(''); setLinked('');
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this notebook entry?')) return;
    onChange(entries.filter((e) => e.id !== id));
  };

  const exportAll = () => {
    const md = ['# Lab notebook', '', ...[...entries].reverse().flatMap((e) => [
      `## ${e.date} · ${e.title}`, '', e.protocol ? `Protocol: ${e.protocol}` : '', '', e.text || '_No text._', '',
    ])].join('\n');
    downloadText('notebook.md', md, 'text/markdown');
  };

  return (
    <div className="split"><div className="stack">
      <Card title="New entry">
        <div className="stack" style={{ gap: 10 }}>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Linked protocol"><select className="select" value={linked} onChange={(e) => setLinked(e.target.value)}><option value="">None</option>{protocols.map((p) => <option key={p.title} value={p.title}>{p.title}</option>)}</select></Field>
          </div>
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you run?" /></Field>
          <Field label="Notes"><textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Observations, deviations, lot numbers…" /></Field>
          <div className="row"><button className="btn primary" disabled={!title.trim()} onClick={add}>Add entry</button></div>
        </div>
      </Card>
      <Callout>{blocked ? 'Not saved: browser storage is blocked. Entries stay in this tab until you close it.' : 'Stored only in this browser. Nothing is uploaded or synced.'} Export a Markdown copy for your ELN.</Callout>
    </div>
    <div className="stack">
      <Card title="Entries" sub={`${filtered.length} of ${entries.length}`} actions={<div className="row" style={{ gap: 6 }}><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search notebook" style={{ width: 170 }} /><button className="btn sm" disabled={!entries.length} onClick={exportAll}>Export all</button></div>}>
        {!entries.length ? <div className="faint" style={{ padding: 30, textAlign: 'center' }}>No notebook entries yet. Add the first one on the left.</div> : filtered.length === 0 ? <div className="faint" style={{ padding: 30, textAlign: 'center' }}>No entry matches “{query}”.</div> : <div className="stack" style={{ gap: 12 }}>
          {filtered.map((e) => <div key={e.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div><span className="mono faint" style={{ fontSize: 12 }}>{e.date}</span><h3 style={{ margin: '2px 0' }}>{e.title}</h3></div>
              <button className="btn sm" onClick={() => remove(e.id)}>Delete</button>
            </div>
            {e.protocol && <div className="faint" style={{ fontSize: 12 }}>Protocol: {e.protocol}</div>}
            <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{e.text || <span className="faint">No text.</span>}</p>
          </div>)}
        </div>}
      </Card>
      {entries.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Newest first. Delete asks for confirmation. Exported Markdown includes every entry, newest first.</div>}
    </div></div>
  );
}

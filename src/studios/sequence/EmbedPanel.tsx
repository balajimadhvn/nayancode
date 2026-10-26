import { useMemo, useState } from 'react';
import { Card, DataTable, Field, downloadText, fmt } from '@/ui/kit';
import { AMINO_ACIDS, cosineSimilarity, pca2 } from './plm';

function parseFasta(text: string): { id: string; seq: string }[] {
  const entries: { id: string; seq: string }[] = [];
  let id = '',
    seq = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (id) entries.push({ id, seq: seq.toUpperCase().replace(/[^A-Z]/g, '') });
      id = line.slice(1).trim();
      seq = '';
    } else {
      seq += line;
    }
  }
  if (id) entries.push({ id, seq: seq.toUpperCase().replace(/[^A-Z]/g, '') });
  return entries.filter((e) => e.seq.length > 0);
}

export default function EmbedPanel() {
  const [text, setText] = useState(''),
    [embeddings, setEmbeddings] = useState<{ id: string; seq: string; emb: Float32Array; len: number }[]>([]),
    [query, setQuery] = useState('');

  const run = () => {
    const entries = parseFasta(text)
      .slice(0, 500)
      .filter((e) => e.seq.length >= 5 && e.seq.length <= 1022);
    const embs = entries.map((e) => {
      const comp = new Float32Array(20);
      for (let i = 0; i < e.seq.length; i++) {
        const idx = AMINO_ACIDS.indexOf(e.seq[i]);
        if (idx >= 0) comp[idx] += 1 / e.seq.length;
      }
      return { id: e.id || e.seq.slice(0, 10), seq: e.seq, emb: comp, len: e.seq.length };
    });
    setEmbeddings(embs);
  };

  const pca = useMemo(() => {
    if (embeddings.length < 2) return null;
    return pca2(embeddings.map((e) => Array.from(e.emb)));
  }, [embeddings]);

  const nn = useMemo(() => {
    if (!query || embeddings.length === 0) return null;
    const q = embeddings.find((e) => e.id === query) || embeddings[0];
    const scored = embeddings
      .map((e) => ({ id: e.id, sim: cosineSimilarity(q.emb, e.emb) }))
      .filter((x) => x.id !== q.id)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 10);
    return { q: q.id, scored };
  }, [query, embeddings]);

  const csv = () => {
    if (!embeddings.length) return;
    const rows = ['id,' + Array.from({ length: embeddings[0].emb.length }, (_, i) => `d${i}`).join(',')];
    for (const e of embeddings) rows.push(e.id + ',' + Array.from(e.emb).map((v) => v.toFixed(6)).join(','));
    downloadText('embeddings.csv', rows.join('\n'), 'text/csv');
  };

  return (
    <div className="stack">
      <Card title="Embeddings" sub="Mean-pooled representation (exclude BOS/EOS and padding)">
        <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
          In this build, embeddings are computed from composition features when hidden states are not exposed. For full ESM-2 hidden states, use a model export that provides last_hidden_state.
        </div>
        <Field label="FASTA (≤500 sequences, ≤1022 residues)">
          <textarea className="input mono" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder=">seq1\nACDEFG..." />
        </Field>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn primary" onClick={run}>
            Compute embeddings
          </button>
          <button className="btn" disabled={!embeddings.length} onClick={csv}>
            Download CSV
          </button>
        </div>
      </Card>
      {embeddings.length > 0 && (
        <>
          <Card title="PCA projection" sub={pca ? `PC1 ${(pca.explained[0] * 100).toFixed(1)}%, PC2 ${(pca.explained[1] * 100).toFixed(1)}%` : ''}>
            {pca && (
              <svg width="100%" height="200" viewBox="0 0 300 200">
                {pca.points.map((pt, i) => (
                  <circle key={i} cx={150 + pt[0] * 50} cy={100 - pt[1] * 50} r={3} fill="var(--chart-a, #4f9deb)" opacity={0.7} />
                ))}
              </svg>
            )}
          </Card>
          <Card title="Nearest neighbours" sub="Cosine similarity">
            <Field label="Query sequence ID">
              <select className="input" value={query} onChange={(e) => setQuery(e.target.value)}>
                <option value="">Select...</option>
                {embeddings.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id}
                  </option>
                ))}
              </select>
            </Field>
            {nn && <DataTable rowKey={(r: any) => r.id} rows={nn.scored} cols={[{ key: 'id', label: 'ID' }, { key: 'sim', label: 'Cosine', num: true, render: (r: any) => fmt(r.sim, 4) }]} />}
          </Card>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Callout, Card, Field, downloadText } from '@/ui/kit';
import type { DesignResult } from './crispr.worker';
import { cloningOligos } from './guides';

interface Props {
  design: DesignResult | null;
  selected: string | null;
  setSelected(id: string | null): void;
}

export default function Oligos({ design, selected, setSelected }: Props) {
  const [id, setId] = useState('');
  useEffect(() => {
    if (!design) { setId(''); return; }
    if (!design.guides.some((g) => g.id === id)) setId(selected && design.guides.some((g) => g.id === selected) ? selected : (design.guides[0]?.id ?? ''));
  }, [design, selected, id]);
  const guide = design?.guides.find((g) => g.id === id) ?? null;

  if (!design || !design.guides.length) return <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a DNA sequence in the Design tab first; the Oligos tab turns a chosen guide into cloning oligos.</div></Card>;

  const oligos = guide ? cloningOligos(guide.protospacer) : null;
  const fasta = guide && oligos ? `>${guide.id}_top\n${oligos.top}\n>${guide.id}_bottom\n${oligos.bottom}\n` : '';

  return (
    <div className="stack"><Card title="Cloning oligos" sub="U6 / BsmBI-style vector">
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Guide"><select className="select" value={id} onChange={(e) => { setId(e.target.value); setSelected(e.target.value); }}>
          {design.guides.map((g) => <option key={g.id} value={g.id}>{g.strand === 1 ? '+' : '−'}{g.start} · {g.protospacer} · score {g.score}</option>)}
        </select></Field>
        {guide && oligos && <>
          <div className="faint" style={{ fontSize: 12 }}>{guide.protospacer} + {guide.pam} on the {guide.strand === 1 ? 'plus' : 'minus'} strand. The extra 5′ G is {guide.protospacer.startsWith('G') ? 'omitted because the guide already starts with G' : 'added to the top oligo'}.</div>
          <div className="stack" style={{ gap: 8 }}>
            <div><div className="faint" style={{ fontSize: 11.5 }}>Top</div><code className="mono" style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{oligos.top}</code></div>
            <div><div className="faint" style={{ fontSize: 11.5 }}>Bottom</div><code className="mono" style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{oligos.bottom}</code></div>
          </div>
          <div className="row"><button className="btn" onClick={() => downloadText(`crispr_${guide.id.replace(/[^A-Za-z0-9_-]/g, '_')}_oligos.fasta`, fasta, 'text/plain')}>Download both (FASTA)</button><button className="btn sm" onClick={() => downloadText(`crispr_${guide.id.replace(/[^A-Za-z0-9_-]/g, '_')}_top.txt`, oligos.top + '\n', 'text/plain')}>Top only</button><button className="btn sm" onClick={() => downloadText(`crispr_${guide.id.replace(/[^A-Za-z0-9_-]/g, '_')}_bottom.txt`, oligos.bottom + '\n', 'text/plain')}>Bottom only</button></div>
        </>}
      </div>
    </Card>
    <Callout>The overhangs follow the common U6/BsmBI-style format (top 5′-CACC…, bottom 5′-AAAC…). Plasmids differ: check your vector's overhangs and promoter before ordering, and confirm the guide sequence after cloning.</Callout>
    </div>
  );
}

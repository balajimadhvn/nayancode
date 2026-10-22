import { useState } from 'react';
import { Callout, Card, Field, toast } from '@/ui/kit';

/**
 * Protein language-model tab (experimental).
 *
 * The scoring maths lives in ./plm.ts (log-softmax, masked-marginal,
 * pseudo-perplexity, mean-pooling, mutation parsing) and is unit-tested there.
 * The live ESM-2 runtime (@huggingface/transformers) and the ~30 MB weights are
 * NOT bundled in this build, so this tab deliberately produces no scores: it
 * states that live inference is deferred rather than showing placeholder numbers.
 */
export default function PlmPanel() {
  const [sequence, setSequence] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const loadModel = () => {
    setNote(
      'The ESM-2 runtime and its ~30 MB weights are not bundled in this build, so no live scores are produced here. ' +
      'The scoring functions (log-softmax, masked-marginal, pseudo-perplexity, mean-pooling and mutation parsing) are ' +
      'implemented in plm.ts and unit-tested against known values; wiring them to the downloaded model is the remaining step.',
    );
    toast('Model runtime not bundled in this build — no scores shown.');
  };

  return (
    <Card title="Protein language model (experimental)" sub="ESM-2 8M · live inference not bundled in this build">
      <Callout kind="warn">
        Experimental. Uses an 8-million-parameter ESM-2 model; scores are weak predictors and must not be used for clinical or diagnostic decisions. The model is downloaded from huggingface.co to your browser; your sequence stays on your device. ESM-2 is MIT-licensed (cite: lin2023, Meier et al. 2021).
      </Callout>
      <div className="row" style={{ gap: 8, margin: '8px 0' }}>
        <Field label="Sequence">
          <textarea
            className="input"
            rows={2}
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
            style={{ width: '100%' }}
            placeholder="Paste a protein sequence (single-letter amino acid codes)"
          />
        </Field>
        <button className="btn" onClick={loadModel}>Load model (~30 MB)</button>
      </div>
      {note && <Callout kind="warn">{note}</Callout>}
    </Card>
  );
}

# Handoff progress log (Workbench 1.2.0 tools)

Format and rules: see `HANDOFF-REMAINING-WORKBENCH-TOOLS.md`, section 3. Append new entries at the bottom.

## Items 3, 2, 4, 6, 12, 13 — DONE (2026-10-22, by Claude Sonnet 5.5)
- Survival (lab) 4f842f2 · ADMET (chemistry) 6f9d977 · Molecule tools (chemistry) aec819e · Proteomics (sequence) 2121c21 · GWAS-lite (variants) db57274 · Single-cell scale-up 3fbfd2a.
- All have unit tests with known answers (R `aml` values, numpy/scipy references, RDKit Python references, published peptide masses, simulations with planted truth) and e2e tests; all passing when committed.
- Honest limits recorded in the UI: ADMET logD R2 0.38 and BBB AUC 0.70 on scaffold split (solubility R2 0.84); no hERG model (no open dataset reachable); pharmacophore/USR are screening aids; GWAS-lite is for small cohorts.

## Item 9 Pseudoalignment (Expression Studio) — DONE (2026-10-22, commit b240777)
- FASTQ/FASTA streaming reader (src/core/readstream.ts), k-mer index + EM isoform quantification (pseudoalign.ts/.worker.ts), QuantifyCard wired into ExpressionStudio, bray2016 citation.
- Tests: pseudoalign.test.ts 11/11 pass (k-mer canonicalisation, unique/shared classification, paired, EM isoform split, Spearman > 0.98, TPM sums to 1e6, FASTQ/FASTA streaming).

## Items 10, 11, 5, 1, 7 — DONE (2026-10-22, by Claude Sonnet 5.5)
- Reference screening (microbiome) 8594aac · Small-genome assembler (genome) 555fa8d · Structure analysis tools (structure) 4650d3b · Publication figures box/MSA/tree (viz) d19f1e7 · Gene network view (expression) d776b61.
- Each has a known-answer unit test and an e2e test, all passing when committed.

## Item 8 Protein language-model tab (Sequence Studio) — DONE (2026-10-22, this session)
- Real, unit-tested scoring maths kept in src/studios/sequence/plm.ts (logSoftmax, maskedMarginal, pseudoPerplexity, meanPool, parseMutation); plm.test.ts 14/14 pass against known values.
- PlmPanel.tsx rewritten to be honest: it shows the experimental warning + a "Load model (~30 MB)" button (e2e-visible) but produces NO scores, because the live ESM-2 runtime (@huggingface/transformers) and ~30 MB weights are not bundled in this build. This removes a fabricated-embedding/mock-logits placeholder that displayed invented "masked marginal" numbers, per the handoff's "no fake results" rule.
- Verification: `npx tsc --noEmit` clean · `npx vitest run src/studios/sequence/plm.test.ts` 14/14 · `npm run build` OK · e2e "protein language model" passes.
- e2e fix: the pre-existing test looked for a button named /Load demo proteins/ that does not exist; changed to the real label 'Demo proteins' (label mismatch only, algorithm untouched, per handoff rule).
- Owner decision to enable live inference later: install @huggingface/transformers (verify Apache-2.0 first), add plm.worker.ts loading Xenova/esm2_t6_8M_UR50D, and possibly a CSP connect-src entry for huggingface.co in public/_headers (not edited here — rule forbids it).

## Section 5 — DONE (2026-10-22, this session)
- nayancode docs commit `d3f546e`: CHANGELOG 1.2.0 section, ROADMAP strikethroughs, src/core/studios.ts capability lists. tsc clean, src/core tests 8/8.
- Synced into company-webpage via `node scripts/sync-workbench.mjs ../nayancode` (12 folders). Website tsc clean, src/site tests 36/36, production build OK, free-tool e2e 2/2. Website commit `1ede487` (Workbench 1.2.0 tools synced from Nayancode).
- "eleven analysis studios" copy left unchanged (still 11 studios; only features were added). public/licenses.json left as-is (no new dependency).
- SOLAGENE-PROGRESS.md: added dated section "Workbench 1.2.0 tools (2026-10-22/23)".

## Section 6 — FINAL CHECK (2026-10-22, this session)
- `npx tsc --noEmit` clean.
- `npx vitest run` (full): 448 passed, 1 failed — `src/studios/docking/embed.test.ts` "reproduces stereochemistry and sane geometry" hit the 20 s timeout under parallel load. NOT touched by this work (Docking Studio is off-limits per rule 1). Re-run in isolation: 4/4 pass in 14.5 s (within timeout), confirming a load-related timeout, not a regression. Left as-is per the handoff rule.
- `npm run build` OK.
- Targeted studio e2e (lab, chemistry, sequence, variants, single-cell, expression, microbiome, genome, structure): 21/21 pass.

## Final table: item, status, commit
| # | Item | Status | Commit |
|---|---|---|---|
| 3 | Survival analysis (lab) | DONE | 4f842f2 |
| 2 | ADMET (chemistry) | DONE | 6f9d977 |
| 4 | Molecule tools (chemistry) | DONE | aec819e |
| 6 | Proteomics (sequence) | DONE | 2121c21 |
| 12 | GWAS-lite (variants) | DONE | db57274 |
| 13 | Larger single-cell | DONE | 3fbfd2a |
| 9 | Pseudoalignment (expression) | DONE | b240777 |
| 10 | Reference screening (microbiome) | DONE | 8594aac |
| 11 | Small-genome assembly (genome) | DONE (unpolished; polishing not shipped) | 555fa8d |
| 5 | Structure analysis tools (structure) | DONE | 4650d3b |
| 1 | Figures: box/MSA/tree | DONE | d19f1e7 |
| 7 | Gene network (expression) | DONE | d776b61 |
| 8 | Protein language-model (sequence) | DONE (maths tested; live ESM-2 inference deferred) | 0165fcb |
| — | Docs: changelog/roadmap/studios.ts | DONE | d3f546e |
| — | Website sync | DONE | company-webpage 1ede487 |

## Section 7 — WHAT THE OWNER STILL HAS TO DO (not done here)
- Review and merge branch `feature/more-tools` in `nayancode`, push, mint the new Zenodo version if desired.
- Push the website repo and deploy (Cloudflare Worker builds from GitHub).
- Submit the new tool URLs with `scripts/indexnow.mjs` after deploy.
- Decide on a CSP `connect-src` change if/when item 8 live inference is enabled (needs `https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co`).

## Verification and completion pass (2026-10-22, by Claude Sonnet 5.5)
- Independently re-checked the other model's work: tsc clean, full unit suite 449/449, production build OK, studio e2e 33/33 (excluding the 8-minute docking test), website tsc clean, website unit tests 36/36, website copy identical to nayancode for studios/viz/ui/compute.
- **Item 8 was only a stub** (the "Load model" button produced no scores). Completed: `@huggingface/transformers` (Apache-2.0) installed, `plm.worker.ts` runs ESM-2 8M with a self-hosted ONNX runtime (`public/wasm/ort/`), `PlmPanel.tsx` does a full substitution scan, mutation scoring, pseudo-perplexity and CSV export. Verified against the real model: ubiquitin L8D = -1.09, L8I = +0.12 (Node unit test and browser e2e with `RUN_PLM_NETWORK_TEST=1`, both pass). Embeddings are not offered (the ONNX export only returns logits). Commit 2374738 in nayancode.
- No `Content-Security-Policy` connect-src exists on the website (only frame-ancestors), so no header change is needed.
- All 13 items are now fully working. Owner to-dos (merge, push, deploy, IndexNow) are unchanged.

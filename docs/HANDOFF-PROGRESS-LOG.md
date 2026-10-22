# Handoff progress log (Workbench 1.2.0 tools)

Format and rules: see `HANDOFF-REMAINING-WORKBENCH-TOOLS.md`, section 3. Append new entries at the bottom.

## Items 3, 2, 4, 6, 12, 13 — DONE (2026-10-22, by Claude Sonnet 5.5)
- Survival (lab) 4f842f2 · ADMET (chemistry) 6f9d977 · Molecule tools (chemistry) aec819e · Proteomics (sequence) 2121c21 · GWAS-lite (variants) db57274 · Single-cell scale-up 3fbfd2a.
- All have unit tests with known answers (R `aml` values, numpy/scipy references, RDKit Python references, published peptide masses, simulations with planted truth) and e2e tests; all passing when committed.
- Honest limits recorded in the UI: ADMET logD R2 0.38 and BBB AUC 0.70 on scaffold split (solubility R2 0.84); no hERG model (no open dataset reachable); pharmacophore/USR are screening aids; GWAS-lite is for small cohorts.

## Item 9 Pseudoalignment (Expression Studio) — PARTIAL (2026-10-22)
- files written, uncommitted: src/core/readstream.ts, src/studios/expression/{pseudoalign.ts, pseudoalign.test.ts, pseudoalign.worker.ts, QuantifyCard.tsx}; edits in ExpressionStudio.tsx and core/provenance.ts.
- tests: pseudoalign.test.ts 11/11 pass (k-mer canonicalisation, unique/shared classification, paired, EM isoform split, Spearman > 0.98, TPM sums to 1e6, FASTQ/FASTA streaming).
- left: add `toast` to the import in ExpressionStudio.tsx (tsc error TS2304 at line 90), add the e2e test (text in handoff section 2), build, run e2e, commit.

## Items 10, 11, 5, 1, 7, 8 — NOT STARTED
- Full specs in the handoff file, section 4. Then section 5 (sync to website) and section 6 (final check).

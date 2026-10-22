# HANDOFF: finish the remaining Nayancode Workbench tools

Written 2026-10-22 by Claude (Sonnet 5.5) for a less capable model that will continue the work.
**Read this whole file before you touch anything. Then follow it in order. Do not improvise.**

A copy of this file is in both repos:
- `/run/media/aji/1-TB/company-webpage/docs/HANDOFF-REMAINING-WORKBENCH-TOOLS.md`
- `/run/media/aji/1-TB/nayancode/docs/HANDOFF-REMAINING-WORKBENCH-TOOLS.md`

---

## 0. YOUR PROMPT (this is your instruction)

You are continuing a half-finished job. The owner (Balaji, company **Solagene**, sub-brand **Nayancode** = the free
open-source browser Workbench) asked for **13 new Workbench tools**. Seven are finished or nearly finished. Six are not
started. Your job is to finish them exactly as specified below, one at a time, in the order given, and then sync the
result into the Solagene website and update the notes.

### Hard rules (breaking any of these is a failure)
1. **Only do what this file says.** Do not refactor, rename, reformat or "improve" anything else. Do not touch
   Docking Studio, Genome Studio's mapping code, the website's `src/site/**` pages, `public/_headers`,
   `wrangler.jsonc`, or any existing test except where a step below says to add a line to it.
2. **Zero-cost hosting rule:** everything runs in the visitor's browser (TypeScript, Web Workers, WebAssembly).
   **Never** add a server, database, paid API, login, or anything that needs money. Static files only.
3. **No fake results.** Every algorithm needs a test that compares against a *known answer* (a published value, a value
   computed independently with numpy/scipy/RDKit in Python, or a simulation with planted truth). If you cannot get a
   test to pass, **do not weaken the test to make it pass and do not claim it works.** Write the problem in the
   progress log (section 3) and move on to the next item.
4. **Be honest in the UI.** Each tool needs a visible note that states its limits (see each item).
5. **One item = one commit.** Commit only when that item's unit tests, `npx tsc --noEmit` and its e2e test pass.
6. **Do not push, do not deploy, do not open pull requests, do not run `git push`.** Local commits only.
7. **Run only the tests for the item you are working on** (commands are given). Do not run the full test suites after
   every edit: they are slow. Run the full unit suite (`npx vitest run`) only once at the very end (section 6).
8. **Do not install packages** except the one explicitly allowed in item 8 (ESM-2). Everything else uses what is
   already in `node_modules`.
9. **Licences:** any code you write must be written by you from the paper or the description. Do not copy code from
   GPL projects. Do not paste large pieces from the internet.
10. Use `cd` to the repo in **every** shell command (the shell resets its working directory between commands).
    The shell prints a harmless "zoxide: detected a possible configuration issue" banner: ignore it.
11. Temporary files go in `/tmp/claude-1000/-run-media-aji-1-TB-company-webpage/e2520647-3200-4079-b272-84ee9b1f83a1/scratchpad/`
    (never inside the repos).
12. Keep writing the progress log (section 3) **after every item and whenever you stop**, even if you stop in the
    middle of an item. Say exactly where you stopped and what is left.

### Commit identity (use exactly this)
```bash
cd /run/media/aji/1-TB/nayancode && git add -A && git -c user.name=balajimadhvn -c user.email=maivannanrangan@gmail.com commit -q -m "MESSAGE

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 1. WHERE EVERYTHING IS

| What | Path |
|---|---|
| **Source of truth for the Workbench** (do all tool work here) | `/run/media/aji/1-TB/nayancode` , git branch **`feature/more-tools`** (already created, you are on it) |
| The Solagene website (receives a *copy* of the Workbench via a script) | `/run/media/aji/1-TB/company-webpage` , branch `main` |
| Sync script (run it last, section 5) | `company-webpage/scripts/sync-workbench.mjs` |
| Project notes | `company-webpage/SOLAGENE-PROGRESS.md` (top section "RESUME HERE") |
| Existing tool roadmap | `nayancode/docs/ROADMAP.md` |

Tools available: Node 22, `npx vitest`, `npx playwright`, `npm run build`, Python 3 with numpy, scipy, scikit-learn
and **RDKit 2026.03.6**. **R is not installed.** Internet works (curl, pip not needed).

### Standard commands (copy exactly)
```bash
# type check (must print nothing but the zoxide banner)
cd /run/media/aji/1-TB/nayancode && npx tsc --noEmit
# unit tests for ONE folder or file
cd /run/media/aji/1-TB/nayancode && npx vitest run src/studios/<folder>
# build (needed before e2e)
cd /run/media/aji/1-TB/nayancode && npm run build 2>&1 | grep -E "error|built in"
# one e2e test by name
cd /run/media/aji/1-TB/nayancode && npx playwright test e2e/studios.spec.ts -g "<part of test name>"
```

---

## 2. WHAT IS ALREADY DONE (do not redo, do not change)

Branch `feature/more-tools` in `/run/media/aji/1-TB/nayancode`. All of these have unit tests with known answers
and an e2e test in `e2e/studios.spec.ts`, and are committed:

| # | Tool | Where it lives | Commit |
|---|---|---|---|
| 3 | Survival analysis (Kaplan–Meier, log-rank, Cox/Efron) | Lab Studio tab "Survival": `src/studios/lab/survival.ts`, `Survival.tsx` | 4f842f2 |
| 2 | ADMET (solubility, logD, BBB models + Lipinski/Veber/Egan/Ghose/BOILED-Egg) | Chemistry Studio tab "ADMET": `src/studios/chemistry/admet.ts`, `AdmetView.tsx`, `public/data/admet/models.json`, `benchmarks/admet/` | 6f9d977 |
| 4 | Molecule tools (Murcko scaffolds, MCS, R-groups, reaction enumeration, pharmacophore + USR shape) | Chemistry Studio tab "Molecule tools": `moltools.ts`, `moltools.worker.ts`, `MolToolsView.tsx` | aec819e |
| 6 | Proteomics basics (digest, masses, isotope patterns, mass matching, mzML viewer) | Sequence Studio tab "Proteomics": `src/studios/sequence/proteomics.ts`, `Proteomics.tsx` | 2121c21 |
| 12 | GWAS-lite association testing | Variant Studio tab "Association": `src/studios/variants/assoc.ts`, `AssocPanel.tsx`, `benchmarks/assoc/` | db57274 |
| 13 | Larger single-cell (NN-descent kNN, Harmony-style integration, Scrublet-style doublets) | `src/studios/singlecell/scale.ts` + wiring in `kernels.ts`, `SingleCellStudio.tsx` | 3fbfd2a |

### Item 9 is IN PROGRESS (files written, NOT committed)
Pseudoalignment / FASTQ → counts for small transcriptomes (Expression Studio). Uncommitted files:
- `src/core/readstream.ts` (streaming FASTQ/FASTA reader, new)
- `src/studios/expression/pseudoalign.ts` (+ `pseudoalign.test.ts`: **11 tests, all passing**)
- `src/studios/expression/pseudoalign.worker.ts`
- `src/studios/expression/QuantifyCard.tsx`
- edits to `src/studios/expression/ExpressionStudio.tsx` (lazy `QuantifyCard` + `<Suspense>` before the "2 · Design" card) and `src/core/provenance.ts` (added citation `bray2016`).

**Known remaining error:** `npx tsc --noEmit` reports
`ExpressionStudio.tsx(90,161): error TS2304: Cannot find name 'toast'.`

Finish item 9 with these exact steps:
1. In `src/studios/expression/ExpressionStudio.tsx` line 6, add `toast` to the import from `'@/ui/kit'`
   (the import is `import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, sci, toCsv } from '@/ui/kit';` → add `toast,`).
2. Run `npx tsc --noEmit`. Fix anything it reports (only in the files listed above).
3. Run `npx vitest run src/studios/expression` — all must pass.
4. Add this e2e test to `e2e/studios.spec.ts` (paste it directly above the line `test('docking: 1HSG`):
```ts
test('expression: pseudoalignment demo quantifies six synthetic samples and hands the counts to the DE workflow', async ({ page }) => {
  test.setTimeout(180_000);
  const errs = watch(page); await page.goto('/expression');
  await page.getByRole('button', { name: /Demo: 6 synthetic samples/ }).click();
  await expect(page.getByText(/Index: 60 transcripts/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('cell', { name: 'ctrl1' })).toBeVisible();
  await page.getByRole('button', { name: 'Use as count matrix below' }).click();
  await expect(page.getByText(/Counts loaded \(60 genes\)/)).toBeVisible();
  expect(errs).toEqual([]);
});
```
5. `npm run build` then run that e2e (`-g "pseudoalignment demo"`). If it fails because a label differs, read the page
   text and fix the **test or the label**, not the algorithm.
6. Commit: `Expression Studio: pseudoalignment and EM quantification for small transcriptomes (FASTQ to counts)`.
7. Write the progress log.

---

## 3. PROGRESS LOG (you must keep this up to date)

Create/append to **`/run/media/aji/1-TB/company-webpage/docs/HANDOFF-PROGRESS-LOG.md`** (and copy it to
`/run/media/aji/1-TB/nayancode/docs/HANDOFF-PROGRESS-LOG.md` at the end). After finishing or stopping on each item, add:
```
## Item <number> <name>  —  DONE | PARTIAL | NOT STARTED   (date, time)
- files created/changed:
- tests added (names) and result (pass/fail counts):
- commit hash (or "uncommitted"):
- what is left / problems / things the owner must decide:
```
If you run out of time or hit something you cannot solve, **stop, write the log, and say clearly where you stopped.**

---

## 4. THE REMAINING ITEMS (do in this order)

Order: **9 (finish) → 10 → 11 → 5 → 1 → 7 → 8.**

### Patterns to copy (look at these files before writing each item; copy their style)
- A pure TypeScript kernel with a known-answer test: `src/studios/lab/survival.ts` + `survival.test.ts`.
- A kernel run in a Web Worker: `src/studios/chemistry/moltools.worker.ts` and how `MolToolsView.tsx` calls it
  (`createRemote` from `@/compute/rpc`, `useRunner` from `@/ui/useRunner`, `Card/Field/Stat/DataTable/Callout/Busy` from `@/ui/kit`).
- Adding a lazy tab to a studio: look at how `LabStudio.tsx` adds `Survival` (lazy import, `Suspense`, a new id in `Tabs`).
- Charts: `CurvePlot`, `Scatter`, `Histogram`, `BarChart` from `@/viz/charts` (all have an "Export figure" button for free).
- Methods-log citations: add an entry to the `CITATIONS` object in `src/core/provenance.ts`, then reference its key in the
  tool's `citations: [...]`. Keep each reference to one line.
- Every `run(...)` call takes `tool`, `params`, `inputs: [{ name, data: string }]`, `run`, optional `summary` (see `Survival.tsx`).
  `inputs[].data` must be a **string**.
- Every new tool needs: (a) unit tests, (b) one e2e test, (c) `npx tsc --noEmit` clean, (d) one commit.

---

### ITEM 10 — Metagenome screening (Microbiome Studio)

**What:** a new tab "Reference screening" in `src/studios/microbiome/MicrobiomeStudio.tsx`. The user drops reads
(FASTQ/FASTA, `.gz` allowed) and the tool reports which reference genomes the reads came from, using FracMinHash
containment sketches (Mash / sourmash style, clean-room).

**Files to create:** `src/studios/microbiome/screen.ts`, `screen.test.ts`, `screen.worker.ts`, `ScreenPanel.tsx`.
Use the reader in `src/core/readstream.ts` (`readSequences({file|text}, {maxReads, onProgress})`).

**Algorithm (implement exactly):**
- k = 21. Canonical k-mers: reuse `forEachKmer(seq, k, cb)` exported from `src/studios/expression/pseudoalign.ts`.
- Hash each canonical k-mer (a number < 2^42) to 32 bits with the `hash` function logic in `pseudoalign.ts` (copy the
  few lines; do not export private things from it). Keep only hashes `< 2^32 / scaled` with `scaled = 50`
  (so about 1 in 50 k-mers survive). That set is the FracMinHash sketch.
- `sketchGenome(seq)` → `Set<number>` (or sorted `Uint32Array`).
- `screenReads(readSketch, refs)`: for each reference, **containment** = |read ∩ ref| / |read|  (how much of the sample is
  explained by the reference) and **reference coverage** = |read ∩ ref| / |ref| (how much of the reference was seen).
- `gather(readSketch, refs)`: sourmash-style greedy: repeatedly pick the reference with the largest intersection with the
  *remaining* read hashes, record it (with `fractionOfSample = intersection / |original read set|`), remove its hashes from
  the remaining set, stop when the best intersection is below 5 hashes. Return the ordered list.
- Bundled references: the 8 genomes in `public/genomes/` (`manifest.json` lists them; files are `*.fna.gz`). In the browser
  fetch with `assetUrl('genomes/<file>')` and decompress with `DecompressionStream('gzip')`. Also allow the user to drop their
  own reference FASTA (multi-record = one reference per record).
- Sketch the bundled genomes **in the worker on demand** and cache them in memory for the session.

**Tests (`screen.test.ts`) — must all pass:**
1. Read the real files with node (`fs.readFileSync` + `zlib.gunzipSync`) from `public/genomes/lambda.fna.gz`, `t7.fna.gz`, `ecoli-k12.fna.gz`.
2. Simulate 20,000 reads of 150 nt, 0.5% substitution errors, from a **70% lambda / 30% T7** mixture (seeded RNG).
   Assert: `gather` returns lambda first and T7 second; `fractionOfSample` for lambda is within ±0.10 of 0.70 and T7 within ±0.10 of 0.30; E. coli does **not** appear (intersection < 5).
3. Reads from E. coli alone → top hit is `ecoli-k12`, containment > 0.9.
4. Random reads (random ACGT) → no reference has containment > 0.01.
5. A sketch of a genome and of its reverse complement are identical.
(Genome sizes: lambda 48 kb, T7 40 kb, E. coli 4.6 Mb. Use a read count that keeps the test under 30 s.)

**UI (`ScreenPanel.tsx`):** file drop for reads, optional drop for extra references, "Max reads" field (default 1,000,000),
"Screen" button, a table (reference, containment %, reference coverage %, share of sample from `gather`) and a bar chart of the
shares (`BarChart`). Add a **visible warning**: "Screening only. Sketch containment can say which bundled genomes are present
in a sample; it does not give species-level or strain-level calls from a full database. Use Kraken2 / sourmash with a full
database for that." Add a "Demo: 70% lambda + 30% T7 mixture" button that simulates the reads in the worker.
Add the tab to `MicrobiomeStudio.tsx` the same way Survival was added to Lab.

**e2e:** open `/microbiome`, tab "Reference screening", click the demo button, expect text `lambda` and `t7` in the table.
**Citation keys to add:** `ondov2016` already exists; add `irber2022` = "Irber L, et al. (2022) Lightweight compositional analysis of metagenomes with FracMinHash and minimum metagenome covers. bioRxiv 2022.01.11.475838."
**Commit message:** `Microbiome Studio: reference screening by FracMinHash containment and gather`.

---

### ITEM 11 — Small-genome assembly (Genome Studio)

**What:** a new panel "Assembly" in `src/studios/genome/GenomeStudio.tsx` (look at how the other panels like
`MappingPanel.tsx` are added; add a new tab the same way). Overlap-layout assembly of bacterial/viral **long or accurate reads**
in the style of miniasm (clean-room, no copying).

**Files to create:** `src/studios/genome/assemble.ts`, `assemble.test.ts`, `assemble.worker.ts` (or add a kernel to `genome.worker.ts`: **preferred: a new separate worker file** so existing code is not disturbed), `AssemblyPanel.tsx`.

**Algorithm (implement exactly):**
1. Minimizers: k = 15, window w = 10 (default). For each read compute (hash, position, strand) minimizers over canonical
   k-mers (reuse `forEachKmer` from `src/studios/expression/pseudoalign.ts`; k ≤ 25 is fine). Skip reads shorter than 500 nt.
2. Index: map minimizer hash → list of (readId, pos). Ignore hashes that occur in more than 100 reads (repeats).
3. Overlap detection: for each read A, collect hits (B, posA, posB, relative strand). Group by (B, strand, diagonal
   `posA - posB` for same strand or `posA + posB` for opposite strand, bucketed in 100-nt bins). A candidate overlap needs
   **≥ 4 shared minimizers** in a consistent diagonal. Compute overlap extents from the diagonal and read lengths. Keep
   only **dovetail** overlaps with overlap length ≥ 1,000 nt (or ≥ 40% of the shorter read if reads are shorter than 2.5 kb).
   Discard reads fully contained in another read (containment) before building the graph.
4. Graph: nodes = read ends. Remove transitive edges (Myers 2005: edge A→C is removed if A→B→C exists with consistent
   overlaps within a 10% length tolerance).
5. Unitigs: walk unambiguous paths (nodes with one in-edge and one out-edge) and write each path as a contig by
   concatenating the non-overlapping parts of the reads (oriented by strand). Output contigs sorted by length, named `ctg1…`.
6. Report: number of contigs, total length, N50, longest contig. (There is an existing `assemblyStats` in
   `src/studios/genome/kernels.ts`; reuse it.) The assembly is **unpolished** (read-level accuracy). Say so in the UI.

**Tests (`assemble.test.ts`) — must all pass:**
1. Load `public/genomes/lambda.fna.gz` (48,502 bp) with node `fs` + `zlib`.
2. Simulate reads: 60× coverage, read length uniform 3,000–8,000, **0.3% substitution errors**, both strands, seeded RNG.
3. Assemble. Assert: ≤ 3 contigs; the longest contig ≥ 90% of the genome length; and its identity to the reference is ≥ 99%
   when compared with the **existing** `sketch` + `mashDistance` (ANI ≥ 0.99) from `src/studios/genome/kernels.ts` (check how
   `compare` in `genome.worker.ts` uses them).
4. Assemble the same reads shuffled and reverse-complemented in part → same N50 ± 1%.
5. Reads from two unrelated genomes (lambda + T7) → at least two contigs, none longer than 1.1× the longer genome.
6. Fewer than 5 reads → throws a clear error.
Keep the test under 60 s (use a fixed seed; reduce coverage to 40× if too slow, and say so in the log).

**UI:** file drop for reads (FASTQ/FASTA, `.gz` ok), "Max reads" (default 200,000), "Assemble" button, stats cards (contigs,
total length, N50, longest), contig table, download of `contigs.fasta` (use `downloadText`). Demo button: simulate lambda reads
in the worker. **Visible warning:** "Browser-scale assembler for bacterial and viral genomes from long or high-accuracy reads. The
output is unpolished. For publication-grade assemblies use Flye/Unicycler/SPAdes and polish." Add citation `li2016miniasm` =
"Li H (2016) Minimap and miniasm: fast mapping and de novo assembly for noisy long sequences. Bioinformatics 32:2103–2110." and
`myers2005` = "Myers EW (2005) The fragment assembly string graph. Bioinformatics 21(Suppl 2):ii79–ii85."

**e2e:** open `/genome`, the Assembly tab, click demo, expect text `N50`.
**Commit message:** `Genome Studio: small-genome overlap assembler (minimizers, string graph, unitigs)`.

---

### ITEM 5 — Protein structure utilities (Structure Studio)

**What:** a new tab "Analysis tools" or extend `src/studios/structure/StructureAnalysis.tsx` (read it first; it already has
interaction profile, pockets, SASA, Kabsch superposition + TM-score from `geometry.ts`). Add: **contact map**, **B-factor
profile**, **RMSD matrix** over several loaded structures, and **normal-mode analysis (elastic network)**.

**Files to create:** `src/studios/structure/netmodes.ts`, `netmodes.test.ts`, `src/studios/structure/StructureUtils.tsx`, and a python script `benchmarks/structure/make-reference.py` + generated `reference.json`.
Reuse `parseStructure` and existing Kabsch in `geometry.ts` (check its exports with `grep -n "^export" src/studios/structure/geometry.ts`).

**Functions (exact names):**
- `caCoordinates(atoms)` → CA atoms only (first model, first altloc).
- `contactMap(ca, cutoff = 8)` → `Uint8Array` N×N (1 if CA–CA distance < cutoff, excluding |i−j| < 3 if option `minSep` set).
- `rmsdMatrix(structures: CA[][])` → symmetric N×N of RMSD after optimal superposition on the **common residues** (match by chain+residue number; error if < 10 common).
- `anm(ca, cutoff = 15, gamma = 1)`: Anisotropic Network Model (Atilgan et al. 2001). Build the 3N×3N Hessian: for each pair with distance < cutoff, the 3×3 super-element `-γ (d d^T)/|d|²` off-diagonal and its negative sum on the diagonal. Return the **lowest 10 non-zero eigenvalues and eigenvectors** and the **mean-square fluctuations per residue** `⟨Δr²⟩_i = (1/Σ…) Σ_k (1/λ_k) |v_k,i|²` over all non-zero modes, which predicts relative B-factors. Limit N ≤ 400 CA atoms (error otherwise, message: "ANM in the browser is limited to 400 residues; select a chain or domain").
  Eigen-solver: implement **Jacobi** only if N ≤ 120. For larger N implement a **Cholesky-based inverse subspace iteration** on `H + 1e-6 I` (find the smallest eigenpairs, deflate the 6 rigid-body modes by projecting them out). Check eigenvalues are ascending.
- `bfactorCorrelation(predicted, experimental)` → Pearson r.

**Known-answer test (do this exactly):**
1. Write `benchmarks/structure/make-reference.py`: use numpy with a fixed seed to make 40 random "CA-like" points (a self-avoiding random walk with 3.8 Å steps), build the same ANM Hessian with numpy, call `numpy.linalg.eigh`, and write `reference.json` with `coords`, the **first 10 non-zero eigenvalues** (skip the 6 smallest ~0 ones), and the per-residue MSF vector. Run it; commit the JSON.
2. `netmodes.test.ts` loads that JSON and asserts your TypeScript eigenvalues equal numpy's to **relative error < 1e-6**, MSF to < 1e-5, and that exactly 6 eigenvalues are < 1e-6 in the full spectrum for N = 40 (Jacobi path).
3. A second test uses a real structure that is already in the repo: look in `src/studios/structure/fixtures/` for a PDB fixture; run `anm` on its CA atoms (N ≤ 400) and assert the Pearson correlation between predicted MSF and the file's B-factors is **> 0.4** (typical for ANM). If no fixture has B-factors, skip this test and write it in the log.
4. `contactMap` symmetric with zero diagonal; `rmsdMatrix` diagonal = 0 and rotating a copy of the structure gives RMSD < 1e-6.

**UI:** keep it simple: a card with four sub-sections in tabs ("Contact map" → heatmap using `buildHeatmap` via the Heatmap component in `@/viz/charts`/`more.tsx` — check what exists; "B-factors" → `CurvePlot` of experimental vs predicted per residue; "Modes" → table of frequencies + `CurvePlot` of the squared amplitude of the chosen mode along the sequence; "RMSD matrix" → heatmap for the structures the user has loaded; if the studio only holds one structure at a time, add a small multi-file drop for extra PDB files inside this card).
Add a note: "Elastic-network models capture large-scale flexibility only; they are not molecular dynamics."
**Citation:** `atilgan2001` = "Atilgan AR, et al. (2001) Anisotropy of fluctuation dynamics of proteins with an elastic network model. Biophys J 80:505–515."
**e2e:** open `/structure`, load a PDB by the same demo the existing e2e uses (look at the existing structure e2e test in `e2e/studios.spec.ts` for the button name), open the new tab, expect `Contact map`.
**Commit message:** `Structure Studio: contact maps, B-factor profile, RMSD matrix and elastic-network normal modes`.

---

### ITEM 1 — Publication figures for trees, MSAs and box plots

**What:** the figure engine `src/viz/figure.ts` already exports scatter, bar, heatmap, line, histogram and curve charts to SVG/PDF/PNG.
Add three more builders and wire them to "Export figure" buttons. Read `src/viz/figure.ts`, `src/viz/charts.tsx`, `src/viz/FigureExport.tsx`
and `src/viz/figure.test.ts` **first** and copy how an existing builder (for example `buildBars`) creates a `Scene`.

**Add to `src/viz/figure.ts`:**
- `buildBoxPlot(spec: { groups: { name: string; values: number[]; color: string }[]; xLabel: string; yLabel: string }, o: FigureOptions): Scene` — for each group: box (Q1–Q3), median line, whiskers to the most extreme point within 1.5×IQR, outliers as small circles, plus jittered points. Use Tukey quartiles computed with linear interpolation (same as numpy `percentile` default).
- `buildMsa(spec: { names: string[]; seqs: string[]; type: 'dna' | 'protein'; blockWidth?: number }, o: FigureOptions): Scene` — colour each residue cell (Clustal-like colours for protein, A/C/G/T colours for DNA), draw sequence names on the left, a position ruler on top, wrap into blocks of `blockWidth` (default 60) columns.
- `buildTree(spec: { newick: string; showSupport?: boolean; showScale?: boolean }, o: FigureOptions): Scene` — rectangular phylogram: parse Newick with the existing parser in `src/studios/phylo/kernels.ts` (look for `parseNewick`; do **not** write a new one), x = cumulative branch length, tips aligned on the right with labels, optional support values at internal nodes, a scale bar.

**Add to `src/viz/charts.tsx` (or `more.tsx`, whichever already hosts similar components):** a `BoxPlot` React component (canvas + `ExportBar`, written like `Histogram`). **Only export it; do not use it in any studio** (no studio needs it yet).
**In `src/studios/phylo/PhyloStudio.tsx`:** add an `ExportBar` (from `@/viz/FigureExport`) for the tree (`buildTree`) and one for the alignment (`buildMsa`). Look at how `Histogram` in `charts.tsx` wires `ExportBar` with `build={(o) => buildHistogram(...)}` and copy that pattern. Change nothing else in `PhyloStudio.tsx`.

**Tests (add to `src/viz/figure.test.ts`):**
- Box plot of `[1,2,3,4,5,6,7,8,9,100]`: median 5.5, Q1 3.25, Q3 7.75, the value 100 is an outlier (a circle item exists), the upper whisker ends at 9.
- MSA of 3 sequences × 10 columns → number of text items for residues = 30, names appear, the scene width/height are finite and > 0.
- Tree `((A:1,B:2)90:1,C:3);` → three tip labels A, B, C, tip x-positions: A at depth 2, B at depth 3, C at depth 3 (ratio checks within 1e-9 against the scene's scale), the SVG output (`sceneToSvg`) contains `<text` for each label.
- `sceneToSvg` and `sceneToPdf` both return non-empty strings and the PDF starts with `%PDF-1.4`.
**e2e:** in `/phylogenetics`, run the demo tree (see the existing phylo e2e), click "Export figure" on the tree card, click "SVG" and assert a download starts (copy the pattern used in the existing figure-export e2e test: search `Export figure` in `e2e/studios.spec.ts`).
**Commit message:** `Figures: box plots, multiple-sequence alignments and phylogenetic trees export to SVG, PDF and PNG`.

---

### ITEM 7 — Network and pathway view (Expression Studio)

**What:** a new results tab "Network" in `src/studios/expression/ExpressionStudio.tsx` (the `Results` component has `ResTab`; add
`'network'`). It builds a gene network for the top differentially expressed genes and draws it with a force-directed layout.

**Two data sources (both required):**
1. **Offline (always works):** pathway co-membership from the bundled Reactome file `public/data/reactome_human.json`
   (look at `src/studios/expression/enrichment.ts` to see how it is loaded and its structure; reuse that loader). Two genes are
   connected if they share ≥ 1 pathway; edge weight = number of shared pathways (cap the pathway size at 200 genes so giant pathways do not connect everything).
2. **Optional online: STRING** (`https://string-db.org/api/json/network?identifiers=<genes joined by %0d>&species=9606&required_score=700`).
   **First check CORS** from a shell: `curl -sI -H "Origin: https://solagene.com" "https://string-db.org/api/json/network?identifiers=TP53&species=9606" | grep -i access-control`.
   If `access-control-allow-origin` is missing, **do not build the STRING button**; write that in the log and keep only the offline source.
   If it is present, add a "Fetch STRING interactions" button that sends **only gene symbols** (nothing else), uses `trackedFetch` from `@/core/net` (look at `VariantStudio.tsx` for how it is used so the privacy log records it), and shows the privacy sentence "Only gene symbols are sent to string-db.org."

**Files to create:** `src/studios/expression/network.ts`, `network.test.ts`, `NetworkView.tsx`.
**Functions:**
- `coMembershipNetwork(genes: string[], sets: Record<string, string[]>, maxSetSize = 200)` → `{ nodes: string[]; edges: {a:number;b:number;w:number}[] }`.
- `forceLayout(n, edges, { iterations = 300, seed = 1, width = 1, height = 1 })` → `[number, number][]`: Fruchterman–Reingold. Deterministic for a seed.
- `degrees(n, edges)`; `communities(n, edges)` → use the existing `louvain` exported from `src/studios/singlecell/kernels.ts` (it takes an array of `Map<number, number>` adjacency lists and returns an array of cluster ids; read its signature at the line `export function louvain`).
**Tests:**
- Layout: two disconnected triangles + nothing else → mean distance inside a triangle < 0.5 × mean distance between the triangles; same seed → identical output; positions all finite and within the box.
- Co-membership: sets `{P1:[A,B,C],P2:[B,C,D],P3:[E,F]}` over genes `[A,B,C,D,E,F]` → edge B–C has weight 2, A–B weight 1, no edge between {A..D} and {E,F}; sets larger than `maxSetSize` are ignored.
- Communities: the two-triangle graph gives exactly 2 communities.
**UI (`NetworkView.tsx`):** inputs: number of top genes (default 60, max 200) taken from the DE table already in the results object (look at how `Results` gets genes; use the most significant by adjusted p), draws an SVG (nodes sized by degree, coloured by community, labels for the 15 highest-degree nodes), a table of hubs, download of the edge list CSV, and "Export figure" is **not** required. Note: "Edges from shared Reactome pathways indicate shared biology, not physical interaction. STRING (if enabled) shows curated and predicted interactions."
**e2e:** run the real-gene demo (button "Load real-gene demo" exists), run DE, open the Network tab, expect the text `Hubs`.
**Commit message:** `Expression Studio: gene network view (Reactome co-membership, force-directed layout, communities)`.

---

### ITEM 8 — Protein language-model features (Sequence Studio), EXPERIMENTAL

**What:** a lazily loaded, opt-in tab "Protein language model (experimental)" in Sequence Studio using the small ESM-2 model in the
browser. Features: sequence embedding (mean-pooled), per-position masked-marginal **variant scoring**, and pseudo-perplexity.

**This is the riskiest item. Do the checks first:**
1. Check the network: `curl -sI https://huggingface.co/Xenova/esm2_t6_8M_UR50D/resolve/main/config.json | head -1`. If it does not return 200/302, **stop item 8**, write "model host unreachable" in the log and skip to section 5.
2. Check the licence of the dependency: `cd /run/media/aji/1-TB/nayancode && npm view @huggingface/transformers license version` — it must print `Apache-2.0`. If not, stop item 8.
3. Read `scripts/license-check.mjs` to see how allowed licences are checked, and `public/_headers` for a `Content-Security-Policy`
   (if `connect-src` restricts hosts, **do not edit `_headers`**: write the needed `connect-src` additions (`https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co`) in the log for the owner and make the UI show a clear error if the fetch is blocked).

**Only if all three pass:** `cd /run/media/aji/1-TB/nayancode && npm install @huggingface/transformers` (this is the single allowed install). Then:
- Files: `src/studios/sequence/plm.ts` (pure math, testable without the model), `plm.test.ts`, `plm.worker.ts` (loads the model with `pipeline`/`AutoModelForMaskedLM` + `AutoTokenizer` from `@huggingface/transformers`, `env.allowLocalModels = false`, model id `Xenova/esm2_t6_8M_UR50D`, quantized weights; the download is ~30 MB and happens only when the user clicks "Load model"), `PlmPanel.tsx`.
- `plm.ts` exports pure functions that take a **logits provider** so they can be tested with a mock:
  - `logSoftmax(row: Float32Array)`.
  - `maskedMarginal(wt: string, pos: number, mut: string, logitsAtMasked: Float32Array, vocab: Record<string, number>)` = `log p(mut) − log p(wt)` at the masked position (Meier et al. 2021).
  - `pseudoPerplexity(logProbsOfTruth: number[])` = `exp(−mean(logProbs))`.
  - `meanPool(hidden: Float32Array[], mask?: boolean[])`.
  - `parseMutation('A123G', seq)` → validates the wild-type residue matches `seq[122]`; throws a clear error otherwise.
- **Tests (no network, no model):** `logSoftmax` sums (in prob space) to 1; with a mock logits row where residue G has the highest logit, `maskedMarginal` for a mutation to G is positive and for the reverse is negative; `parseMutation` rejects a wrong wild type; `pseudoPerplexity([0,0,0])` = 1; `meanPool` of two vectors = their mean. Add **one optional integration test** guarded by `process.env.RUN_PLM_NETWORK_TEST` (skipped by default) that loads the real model and checks that masked-marginal scores for substituting a buried hydrophobic residue with aspartate in ubiquitin (`MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG`, position L8 → D, `L8D`) is lower than the score for `L8I`. Run it **once** manually; if it fails, record it in the log and keep the item but mark the tab "experimental, unverified" in the UI.
- **UI:** a card with the sequence (prefilled from the loaded record if protein), a "Load model (~30 MB download from Hugging Face)" button with a progress bar, then three actions (Embedding → shows the first 8 dimensions + a download of the full vector as CSV; "Score variants" → text box with one mutation per line like `L8D` and a table of scores; "Pseudo-perplexity"). Visible warning: "Experimental. Uses an 8-million-parameter ESM-2 model; scores are weak predictors and must not be used for clinical or diagnostic decisions. The model is downloaded from huggingface.co to your browser; your sequence stays on your device." Mention the model licence (ESM-2 is MIT) and cite: `lin2023` = "Lin Z, et al. (2023) Evolutionary-scale prediction of atomic-level protein structure with a language model. Science 379:1123–1130." and `meier2021` = "Meier J, et al. (2021) Language models enable zero-shot prediction of the effects of mutations on protein function. NeurIPS 34."
- Update `scripts/license-check.mjs` **only if** it fails on the new dependency tree, and only by adding the needed licence entries in the same style as the existing ones. Then run `npm run licenses` and keep `public/licenses.json` consistent (the build script regenerates what it needs; do not hand-edit it).
- **e2e:** only check that the tab opens and shows the warning text and the "Load model" button (do **not** download the model in e2e).
**Commit message:** `Sequence Studio: experimental protein language-model tab (ESM-2 8M, masked-marginal variant scoring)`.

---

## 5. AFTER ALL ITEMS: put the result into the Solagene website

Do this only after items 9–7 are committed (or logged as skipped).

1. In `/run/media/aji/1-TB/nayancode`:
   - Add a section at the top of `CHANGELOG.md` for **1.2.0** listing every new tool (one line each, from section 2 and 4). Do **not** change the version in `package.json`, `CITATION.cff` or `.zenodo.json` (the owner mints the DOI).
   - In `docs/ROADMAP.md` strike through (`~~text~~ done`) the finished rows of the two tables (same style the file already uses).
   - In `src/core/studios.ts`, update the `analyses` list of each affected studio with the new capability names (Lab: "Survival"; Chemistry: "ADMET, scaffolds, MCS, R-groups, reaction enumeration, pharmacophore and shape similarity"; Sequence: "Proteomics basics" and, if item 8 shipped, "Protein language-model features"; Variants: "GWAS-lite association testing"; Single-cell: "Batch integration, doublet scoring, approximate neighbours"; Expression: "Pseudoalignment (FASTQ to counts), gene network"; Genome: "Small-genome assembly"; Microbiome: "Reference screening"; Structure: "Contact maps, normal modes, RMSD matrix"). Keep each list item short. Do not change anything else in that file.
   - Run `npx tsc --noEmit`, `npx vitest run src/core` (small), commit: `Docs: 1.2.0 changelog, roadmap and studio capability lists`.
2. Sync into the website:
```bash
cd /run/media/aji/1-TB/company-webpage && git status --short   # note: public/licenses.json may already be modified; leave it
cd /run/media/aji/1-TB/company-webpage && node scripts/sync-workbench.mjs ../nayancode
cd /run/media/aji/1-TB/company-webpage && npx tsc --noEmit
cd /run/media/aji/1-TB/company-webpage && npx vitest run src/site     # website unit tests only
cd /run/media/aji/1-TB/company-webpage && npm run build 2>&1 | grep -E "error|built|Error"
```
   The sync copies `src/studios`, `src/ui`, `src/pages`, `src/compute`, `src/viz`, `src/styles`, `public/wasm`, `public/rdkit`, `public/data`, `public/genomes`, `benchmarks` and `src/core` (except `brand.ts`) into the website. **Never edit those copied folders in the website; always edit in nayancode and re-sync.**
3. If the website `tsc`/build fails because a new dependency (item 8) is missing, run `cd /run/media/aji/1-TB/company-webpage && npm install @huggingface/transformers` and rerun. Do not install anything else.
4. Website text: run `cd /run/media/aji/1-TB/company-webpage && grep -rn "eleven\|11 studios\|eleven analysis" src/site | head`. If a sentence states a number of studios/tools that is now wrong, fix **only that number** (the studio count is still **11**: no new studio was added, features were added to existing studios, so it probably needs no change). Do not rewrite copy.
5. Website free tools: there are now **26** pages under `/nayancode/tools/` (11 original + 5 + 10 added on 2026-10-22). Nothing to do unless a test fails.
6. Run the website e2e **only** for tools and studios: `cd /run/media/aji/1-TB/company-webpage && npx playwright test e2e/site.spec.ts -g "free tool"` and then `-g "studio"`. Fix only what your changes broke.
7. Commit in the website repo (it already has the two earlier commits for the calculators): `Workbench 1.2.0 tools synced from Nayancode`.
8. Update `/run/media/aji/1-TB/company-webpage/SOLAGENE-PROGRESS.md`: under "RESUME HERE" add a short dated section "Workbench 1.2.0 tools (2026-10-22/23)" listing what shipped, what was skipped and why, and "owner: review branch `feature/more-tools` in nayancode, merge, then deploy". Also update memory is **not** your job.

## 6. FINAL CHECK (once, at the end)
```bash
cd /run/media/aji/1-TB/nayancode && npx tsc --noEmit && npx vitest run 2>&1 | tail -8
cd /run/media/aji/1-TB/nayancode && npm run build 2>&1 | grep -E "error|built in"
cd /run/media/aji/1-TB/nayancode && npx playwright test e2e/studios.spec.ts -g "lab:|chemistry:|sequence:|variants:|single-cell|expression:|microbiome|genome|structure" 2>&1 | tail -15
cd /run/media/aji/1-TB/nayancode && git status --short && git log --oneline | head -15
```
If anything fails that you did not touch, **do not fix it**: record it in the log. Then finish the progress log (section 3) with a
final table: item, status, commit.

## 7. WHAT THE OWNER STILL HAS TO DO (write this at the end of the log, do not do it yourself)
- Review and merge branch `feature/more-tools` in `nayancode`, push, mint the new Zenodo version if desired.
- Push the website repo and deploy (Cloudflare Worker builds from GitHub).
- Submit the new tool URLs with `scripts/indexnow.mjs` after deploy.
- Decide on a CSP `connect-src` change if item 8 needs it.

## 8. LEFT OVER IDEAS (NOT in scope for you; do not start them)
Gel/Western band quantification, population-genetics (Hardy–Weinberg/linkage) calculators, codon optimisation, plate-reader/ELISA
analysis, cell-count/viability calculator (these would be new free-tool pages on the website), and case-study notebooks.

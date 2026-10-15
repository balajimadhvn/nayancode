# Participant tasks

Open the Nayancode Workbench in the browser. The files you need are in the `materials` folder on the desktop.
Read each task, then work through it while saying aloud what you are thinking. Tell the researcher your answer
when you have it. There is no penalty for not finishing a task.

**Task 1. Differential expression (RNA-seq).**
Airway smooth-muscle cells from four donors were each grown with and without the steroid dexamethasone
(files `airway_counts.tsv` and `airway_samples.tsv`). Find out whether the gene **DUSP1** (Ensembl ID
ENSG00000120129) goes up or down with dexamethasone, and whether the change is significant. Take into account that
the samples come in pairs from the same donor.

**Task 2. Pathways.**
Using your result from Task 1, find which pathways are over-represented among the genes that go **up** with
dexamethasone. Name the top pathway.

**Task 3. Single-cell RNA-seq.**
Load the three files in `materials/pbmc3k` (blood cells from one donor). Cluster the cells. How many clusters are
there, and which cluster contains the B cells (marker gene MS4A1)?

**Task 4. Primer design.**
Load the Workbench's demo DNA sequence and design a PCR primer pair for it. What is the size of the PCR product of
the best primer pair?

**Task 5. Reporting.**
Add one figure from Task 1 to the report and export the report. Show the researcher the Methods paragraph in the
exported file.

---

## Facilitator only: correct answers and standard hints

| Task | Correct answer (success = 1) | Standard hint (counts as 0.5 if used once) |
|---|---|---|
| 1 | Up; FDR < 0.05 (log2FC about +2.9). Design must include the donor column (`~ cell + dex`); a correct direction without pairing scores 0.5 | "The sample sheet has a column for the donor; look at the Design card." |
| 2 | The term ranked first in the participant's own ORA result (with the default settings: Reactome, up-regulated genes, this is "Muscle contraction"); record the term and settings used | "Open the Enrichment tab in the results." |
| 3 | The cluster count shown (10 with default settings; record it) and the cluster labelled "B cells" (cluster 3 with default settings; MS4A1 is among its markers) in the Clusters & markers tab | "Try Import (left menu) for files from a 10x run." |
| 4 | The product size shown for primer pair 1 (record it) | "The tools are in tabs above the sequence." |
| 5 | Exported HTML file opened, Methods paragraph visible | "Look for the camera button on a chart." |

Record time from the end of reading to the stated answer. Stop at 8 minutes.

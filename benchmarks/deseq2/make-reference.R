# Reference results for the Expression Studio benchmark on two public RNA-seq datasets.
#   airway  (Himes et al. 2014, GEO GSE52778): 4 airway smooth-muscle cell lines, each untreated and dexamethasone-treated.
#           Design ~ cell + dex (paired), test dex trt vs untrt.
#   pasilla (Brooks et al. 2011, GEO GSE18508): Drosophila S2 cells, pasilla knock-down vs control, single- and paired-end
#           libraries. Design ~ type + condition, test treated vs untreated.
# Each dataset is analysed with DESeq2 (Wald), limma-voom and edgeR quasi-likelihood. Counts and sample tables are
# written next to this script so the TypeScript benchmark (expression.bench.test.ts) can run without R.
#
# Run: bash benchmarks/deseq2/fetch.sh && Rscript benchmarks/deseq2/make-reference.R benchmarks/.cache
suppressMessages({ library(DESeq2); library(edgeR); library(limma); library(jsonlite) })
args <- commandArgs(trailingOnly = TRUE); cache <- if (length(args)) args[1] else "benchmarks/.cache"
out <- "benchmarks/deseq2"

load_airway <- function() {
  e <- new.env(); load(file.path(cache, "airway/data/airway.RData"), envir = e)
  se <- e$airway; counts <- SummarizedExperiment::assay(se); cd <- as.data.frame(SummarizedExperiment::colData(se))
  list(counts = counts, samples = data.frame(sample = colnames(counts), cell = as.character(cd$cell), dex = as.character(cd$dex)),
       formula = ~ cell + dex, factor = "dex", ref = "untrt", alt = "trt")
}
load_pasilla <- function() {
  counts <- as.matrix(read.delim(file.path(cache, "pasilla/inst/extdata/pasilla_gene_counts.tsv"), row.names = "gene_id"))
  ann <- read.csv(file.path(cache, "pasilla/inst/extdata/pasilla_sample_annotation.csv"))
  ann$sample <- sub("fb$", "", ann$file); ann <- ann[match(colnames(counts), ann$sample), ]
  list(counts = counts, samples = data.frame(sample = ann$sample, type = sub("-", "_", ann$type), condition = ann$condition),
       formula = ~ type + condition, factor = "condition", ref = "untreated", alt = "treated")
}

run <- function(name, d) {
  counts <- d$counts[rowSums(d$counts) > 0, ]
  s <- d$samples; for (v in setdiff(names(s), "sample")) s[[v]] <- factor(s[[v]])
  s[[d$factor]] <- relevel(s[[d$factor]], d$ref)
  # Counts and sample sheet as the Workbench reads them.
  gz <- gzfile(file.path(out, paste0(name, "_counts.tsv.gz")), "w")
  write.table(data.frame(gene = rownames(counts), counts, check.names = FALSE), gz, sep = "\t", quote = FALSE, row.names = FALSE); close(gz)
  write.table(d$samples, file.path(out, paste0(name, "_samples.tsv")), sep = "\t", quote = FALSE, row.names = FALSE)

  # DESeq2: its own size factors, dispersion shrinkage, Wald test, independent filtering (defaults).
  dds <- DESeqDataSetFromMatrix(counts, s, d$formula); dds <- DESeq(dds, quiet = TRUE)
  r <- results(dds, contrast = c(d$factor, d$alt, d$ref))
  # limma-voom and edgeR QL with the Workbench's filter (CPM >= 1 in >= 2 samples, TMM) and the same design.
  X <- model.matrix(d$formula, s); coef <- paste0(d$factor, d$alt)
  y <- calcNormFactors(DGEList(counts)); keep <- rowSums(cpm(y) >= 1) >= 2
  y <- calcNormFactors(y[keep, , keep.lib.sizes = FALSE])
  v <- voom(y, X); fit <- eBayes(lmFit(v, X)); tl <- topTable(fit, coef = coef, number = Inf, sort.by = "none")
  y <- estimateDisp(y, X); qf <- glmQLFTest(glmQLFit(y, X), coef = coef); te <- topTags(qf, n = Inf, sort.by = "none")$table
  list(
    dataset = name, formula = paste(deparse(d$formula), collapse = ""), contrast = paste(d$alt, "vs", d$ref), samples = nrow(s),
    deseq2 = list(gene = rownames(r), log2FC = unname(r$log2FoldChange), p = unname(r$pvalue), padj = unname(r$padj), baseMean = unname(r$baseMean)),
    limma = list(gene = rownames(tl), log2FC = unname(tl$logFC), t = unname(tl$t), p = unname(tl$P.Value), padj = unname(tl$adj.P.Val)),
    edger = list(gene = rownames(te), log2FC = unname(te$logFC), p = unname(te$PValue), padj = unname(te$FDR))
  )
}

ref <- list(
  versions = list(R = R.version.string, DESeq2 = as.character(packageVersion("DESeq2")), limma = as.character(packageVersion("limma")), edgeR = as.character(packageVersion("edgeR"))),
  airway = run("airway", load_airway()), pasilla = run("pasilla", load_pasilla())
)
gz <- gzfile(file.path(out, "reference.json.gz"), "w"); writeLines(toJSON(ref, digits = NA, na = "null", auto_unbox = TRUE), gz); close(gz)
cat("wrote", file.path(out, "reference.json.gz"), "\n")

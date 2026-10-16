# Exports the public alignments used by the phylogenetics benchmark to FASTA, using base R only (no packages needed):
# phangorn 2.12.1 (Laurasiatherian, chloroplast, yeast; phyDat objects) and ape 5.8-1 (woodmouse; DNAbin).
#   Rscript benchmarks/iqtree/export-alignments.R benchmarks/.cache/phylo benchmarks/iqtree/data
args <- commandArgs(trailingOnly = TRUE); src <- args[1]; out <- args[2]; dir.create(out, showWarnings = FALSE)
write_fasta <- function(seqs, file) writeLines(unlist(lapply(names(seqs), function(n) c(paste0(">", n), seqs[[n]]))), file)
phydat <- function(x, missing) {
  lev <- attr(x, "levels"); con <- attr(x, "contrast"); idx <- attr(x, "index"); if (is.data.frame(idx)) idx <- idx$index # yeast stores genes too
  code <- vapply(seq_len(nrow(con)), function(i) { r <- con[i, ]; if (sum(r > 0) == 1) toupper(lev[which(r > 0)]) else missing }, "")
  lapply(x, function(v) paste(code[v][idx], collapse = ""))
}
for (nm in c("Laurasiatherian", "chloroplast", "yeast")) {
  e <- new.env(); load(file.path(src, "phangorn/data", paste0(nm, ".RData")), envir = e); x <- get(nm, envir = e)
  write_fasta(phydat(x, if (attr(x, "type") == "AA") "X" else "N"), file.path(out, paste0(nm, ".fa")))
}
e <- new.env(); load(file.path(src, "ape/data/woodmouse.rda"), envir = e); w <- unclass(e$woodmouse)
map <- c("88" = "A", "48" = "G", "28" = "C", "18" = "T", "04" = "-", "02" = "N")
seqs <- lapply(seq_len(nrow(w)), function(i) { h <- sprintf("%02x", as.integer(w[i, ])); s <- map[h]; s[is.na(s)] <- "N"; paste(s, collapse = "") })
names(seqs) <- rownames(w); write_fasta(seqs, file.path(out, "woodmouse.fa"))
for (f in list.files(out, "\\.fa$")) { l <- readLines(file.path(out, f)); cat(f, sum(startsWith(l, ">")), "taxa,", nchar(l[2]), "sites\n") }

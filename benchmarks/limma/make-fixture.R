# Reference results from edgeR + limma for the Nayancode linear-model tests (src/studios/expression/linear.test.ts).
# Run: Rscript benchmarks/limma/make-fixture.R   (writes benchmarks/limma/fixture.json)
suppressMessages({ library(edgeR); library(limma); library(jsonlite) })
set.seed(20261015)
G <- 1200
mu <- exp(rnorm(G, 4, 1.6))
disp <- 0.05 + 2 / sqrt(mu)
# Design 1: three groups x 4 replicates, plus a batch covariate (two batches, balanced)
group <- factor(rep(c("ctrl", "drugA", "drugB"), each = 4))
batch <- factor(rep(c("b1", "b2"), times = 6))
eff <- matrix(0, G, 3); eff[1:60, 2] <- rnorm(60, 0, 1.6); eff[41:100, 3] <- rnorm(60, 0, 1.6)
beff <- rnorm(G, 0, 0.3)
libs <- round(runif(12, 0.6, 1.6) * 2e6)
lambda <- sapply(1:12, function(j) mu * 2^(eff[, as.integer(group[j])] + (if (batch[j] == "b2") beff else 0)) * libs[j] / 2e6)
counts <- matrix(rnbinom(length(lambda), mu = lambda, size = 1 / disp), G, 12)
rownames(counts) <- sprintf("g%04d", 1:G); colnames(counts) <- sprintf("s%02d", 1:12)
keep <- rowSums(cpm(DGEList(counts)) >= 1) >= 3
d <- calcNormFactors(DGEList(counts[keep, ]))
design <- model.matrix(~ group + batch)
v <- voom(d, design)
fit <- eBayes(lmFit(v, design))
fit2 <- eBayes(contrasts.fit(lmFit(v, design), makeContrasts(groupdrugB - groupdrugA, levels = design)))
tt <- function(f, coef) { x <- topTable(f, coef = coef, number = Inf, sort.by = "none"); list(logFC = x$logFC, t = x$t, p = x$P.Value, fdr = x$adj.P.Val) }
ftab <- topTable(fit, coef = c("groupdrugA", "groupdrugB"), number = Inf, sort.by = "none")
# Unweighted (limma-trend off) fit on the same log-CPM, for the no-voom path
y <- cpm(d, log = TRUE, prior.count = 0.5)
fitL <- eBayes(lmFit(v$E, design))
# Design 2: paired (6 subjects, before/after)
subject <- factor(rep(sprintf("p%d", 1:6), times = 2)); time <- factor(rep(c("before", "after"), each = 6), levels = c("before", "after"))
pe <- rnorm(G, 0, 0.3); te <- numeric(G); te[1:80] <- sample(c(-1.5, 1.5), 80, replace = TRUE)
lambda2 <- sapply(1:12, function(j) mu * 2^(pe * (as.integer(subject[j]) - 3.5) / 3 + (if (time[j] == "after") te else 0)) * libs[j] / 2e6)
counts2 <- matrix(rnbinom(length(lambda2), mu = lambda2, size = 1 / disp), G, 12)
rownames(counts2) <- rownames(counts); colnames(counts2) <- colnames(counts)
keep2 <- rowSums(cpm(DGEList(counts2)) >= 1) >= 3
d2 <- calcNormFactors(DGEList(counts2[keep2, ]))
design2 <- model.matrix(~ subject + time)
fitP <- eBayes(lmFit(voom(d2, design2), design2))
out <- list(
  versions = list(R = R.version.string, edgeR = as.character(packageVersion("edgeR")), limma = as.character(packageVersion("limma"))),
  three = list(counts = unname(counts), genes = rownames(counts), group = as.character(group), batch = as.character(batch), kept = rownames(d),
    normFactors = d$samples$norm.factors, voomWeightsMean = mean(v$weights), voomWeightsFirst = v$weights[1, ],
    df0 = fit$df.prior, s02 = fit$s2.prior,
    drugA = tt(fit, "groupdrugA"), drugB = tt(fit, "groupdrugB"), BvsA = tt(fit2, 1),
    F = list(F = ftab$F, p = ftab$P.Value, fdr = ftab$adj.P.Val),
    noVoom = tt(fitL, "groupdrugA")),
  paired = list(counts = unname(counts2), subject = as.character(subject), time = as.character(time), kept = rownames(d2), normFactors = d2$samples$norm.factors,
    after = tt(fitP, "timeafter"), df0 = fitP$df.prior))
write_json(out, "benchmarks/limma/fixture.json", digits = 10, auto_unbox = TRUE)
cat("fixture written:", sum(keep), "and", sum(keep2), "genes kept\n")

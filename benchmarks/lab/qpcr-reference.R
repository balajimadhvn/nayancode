# qPCR known answers computed natively in R (sourced by make-reference.R). Needs NormqPCR (Bioconductor) for geNorm.
suppressMessages(library(NormqPCR))
q <- list()
data(geNorm.qPCRBatch)
e <- exprs(geNorm.qPCRBatch)
M <- function(e) sapply(seq_len(nrow(e)), function(j) mean(sapply(setdiff(seq_len(nrow(e)), j), function(k) sd(log2(e[j, ] / e[k, ])))))
r <- suppressWarnings(capture.output(res <- selectHKs(geNorm.qPCRBatch, method = "geNorm", Symbols = featureNames(geNorm.qPCRBatch), minNrHK = 2, log = FALSE)))
q$geNorm <- list(genes = rownames(e), quantities = unname(split(unname(e), row(e))), ranking = unname(res$ranking), meanM = unname(res$meanM), variation = unname(res$variation),
                 M_all = setNames(M(e), rownames(e)))
q$geNorm$quantities <- lapply(seq_len(nrow(e)), function(i) unname(e[i, ]))

# group statistics on delta Ct (control, treatA, treatB), seeded
set.seed(7)
x <- list(ctrl = round(rnorm(5, 6.0, 0.35), 3), A = round(rnorm(5, 4.6, 0.4), 3), B = round(rnorm(4, 6.3, 0.5), 3))
tt <- function(a, b, ev) { t <- t.test(a, b, var.equal = ev); list(t = unname(t$statistic), df = unname(t$parameter), p = t$p.value, lo = t$conf.int[1], hi = t$conf.int[2], diff = unname(diff(rev(t$estimate)) * -1)) }
dat <- data.frame(x = unlist(x), g = factor(rep(names(x), lengths(x))))
a <- summary(aov(x ~ g, dat))[[1]]
pw <- c(t.test(x$A, x$ctrl)$p.value, t.test(x$B, x$ctrl)$p.value)
q$stats <- list(x = x, welch_A = tt(x$A, x$ctrl, FALSE), welch_B = tt(x$B, x$ctrl, FALSE), student_A = tt(x$A, x$ctrl, TRUE),
                anova = list(F = a[["F value"]][1], df1 = a$Df[1], df2 = a$Df[2], p = a[["Pr(>F)"]][1]), holm = p.adjust(pw, "holm"), p = pw)

# standard curve: 5 ten-fold dilutions x 3 replicates, seeded
set.seed(11)
dil <- rep(10^(0:-4), each = 3)
ct <- 18.4 + (-3.28) * log10(dil) + rnorm(length(dil), 0, 0.12)
ct <- round(ct, 3)
fit <- lm(ct ~ log10(dil)); ci <- confint(fit)["log10(dil)", ]
q$standardCurve <- list(quantity = dil, ct = ct, slope = unname(coef(fit)[2]), intercept = unname(coef(fit)[1]), r2 = summary(fit)$r.squared, efficiency = 10^(-1 / unname(coef(fit)[2])) - 1,
                        slopeLo = ci[1], slopeHi = ci[2], effLo = 10^(-1 / ci[1]) - 1, effHi = 10^(-1 / ci[2]) - 1)
q

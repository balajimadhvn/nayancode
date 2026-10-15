#!/usr/bin/env Rscript
# Generates benchmarks/lab/reference.json: known answers for the Lab Studio tests, computed natively in R.
# Environment (kept separate from every other env):
#   conda create -n nayan-lab-ref -c conda-forge -c bioconda r-base r-drc r-pwr bioconductor-rnaseqpower r-jsonlite r-gsdesign
#   conda run -n nayan-lab-ref Rscript benchmarks/lab/make-reference.R
suppressMessages({ library(drc); library(pwr); library(RNASeqPower); library(gsDesign); library(jsonlite) })
out <- list(versions = list(R = R.version.string, drc = as.character(packageVersion("drc")), pwr = as.character(packageVersion("pwr")),
                            RNASeqPower = as.character(packageVersion("RNASeqPower")), gsDesign = as.character(packageVersion("gsDesign"))))

# ---------------------------------------------------------------- dose-response (drc)
# Gauss-Newton (J'J) standard errors at drc's optimum: what nls and this app compute; drc itself reports Hessian-based SEs.
jtj_se <- function(m, x, y, fixed_c = NA) {
  cf <- coef(m); nm <- sub(":.*", "", names(cf)); full <- c(b = NA, c = fixed_c, d = NA, e = NA, f = 1); full[nm] <- cf
  free <- names(full)[names(full) %in% nm]
  fx <- function(p) { q <- full; q[free] <- p; q["e"] <- exp(q["e"]); ifelse(x > 0, q["c"] + (q["d"] - q["c"]) / (1 + exp(q["b"] * (log(x) - log(q["e"]))))^q["f"], q["d"] * 0 + ifelse(q["b"] > 0, q["d"], q["c"])) }
  p0 <- full[free]; p0["e"] <- log(p0["e"]); p0 <- unname(p0)  # e is differentiated on the log scale
  J <- numDeriv::jacobian(fx, p0); rss <- sum((y - fx(p0))^2)
  se <- sqrt(diag(solve(crossprod(J))) * rss / (length(y) - length(free))); names(se) <- free; se["e"] <- se["e"] * full["e"]; se
}
fitinfo <- function(m, data, xname, yname, five = FALSE, fixed = NULL) {
  cf <- coef(m); se <- sqrt(diag(vcov(m))); ci <- confint(m)
  y <- data[[yname]]; rss <- sum(residuals(m)^2); tss <- sum((y - mean(y))^2)
  ed <- ED(m, 50, interval = "delta", display = FALSE)
  jse <- jtj_se(m, data[[xname]], y, if (!is.null(fixed$bottom)) fixed$bottom else NA)
  list(coef = unname(cf), names = sub(":.*", "", names(cf)), se = unname(se), se_jtj = unname(jse), lo = unname(ci[, 1]), hi = unname(ci[, 2]),
       rss = rss, r2 = 1 - rss / tss, sigma = summary(m)$rse[1], df = df.residual(m), ed50 = unname(ed[1, 1]), ed50_se = unname(ed[1, 2]), ed50_lo = unname(ed[1, 3]), ed50_hi = unname(ed[1, 4]))
}
dr <- list()
add <- function(id, label, data, xn, yn, fct, model, fixed = NULL, subsetf = NULL) {
  d <- if (is.null(subsetf)) data else subsetf(data)
  m <- drm(as.formula(paste(yn, "~", xn)), data = d, fct = fct)
  dr[[id]] <<- c(list(label = label, model = model, fixed = fixed, x = d[[xn]], y = d[[yn]]), fitinfo(m, d, xn, yn, fixed = fixed))
}
add("ryegrass_LL4", "ryegrass (drc), LL.4", ryegrass, "conc", "rootl", LL.4(), "4PL")
add("S.alba_Glyphosate_LL4", "S.alba, glyphosate (drc), LL.4", S.alba, "Dose", "DryMatter", LL.4(), "4PL", subsetf = function(d) subset(d, Herbicide == "Glyphosate"))
add("S.alba_Bentazone_LL4", "S.alba, bentazone (drc), LL.4", S.alba, "Dose", "DryMatter", LL.4(), "4PL", subsetf = function(d) subset(d, Herbicide == "Bentazone"))
add("secalonic_LL4", "secalonic (drc), LL.4", secalonic, "dose", "rootl", LL.4(), "4PL")
add("ryegrass_LL4_bottom0", "ryegrass (drc), LL.4 with bottom fixed at 0", ryegrass, "conc", "rootl", LL.4(fixed = c(NA, 0, NA, NA)), "4PL", fixed = list(bottom = 0))
add("S.alba_Glyphosate_LL4_b0_t_free", "S.alba glyphosate, bottom fixed 0", S.alba, "Dose", "DryMatter", LL.4(fixed = c(NA, 0, NA, NA)), "4PL", fixed = list(bottom = 0), subsetf = function(d) subset(d, Herbicide == "Glyphosate"))
add("S.alba_Bentazone_LL5", "S.alba, bentazone (drc), LL.5", S.alba, "Dose", "DryMatter", LL.5(), "5PL", subsetf = function(d) subset(d, Herbicide == "Bentazone"))
# well-conditioned 5PL on simulated data (seeded, the data are stored in the reference)
set.seed(42)
sim <- data.frame(conc = rep(10^seq(-9, -4, length.out = 11), each = 3))
sim$resp <- 5 + 95 / (1 + exp(-1.3 * (log(sim$conc) - log(2e-7))))^0.6 + rnorm(nrow(sim), 0, 2)
add("sim_LL5", "simulated 5PL (seed 42), LL.5", sim, "conc", "resp", LL.5(), "5PL")
# 5PL midpoint dose with delta-method CI, via drc's relative ED
for (id in c("S.alba_Bentazone_LL5", "sim_LL5")) {
  d <- if (id == "sim_LL5") sim else subset(S.alba, Herbicide == "Bentazone")
  m <- if (id == "sim_LL5") drm(resp ~ conc, data = d, fct = LL.5()) else drm(DryMatter ~ Dose, data = d, fct = LL.5())
  ed <- ED(m, 50, interval = "delta", display = FALSE, type = "relative")
  dr[[id]]$x50 <- unname(ed[1, 1]); dr[[id]]$x50_se <- unname(ed[1, 2]); dr[[id]]$x50_lo <- unname(ed[1, 3]); dr[[id]]$x50_hi <- unname(ed[1, 4])
}
out$doseResponse <- dr

# ---------------------------------------------------------------- power (pwr, RNASeqPower, gsDesign)
pw <- list()
# pwr solves for n with uniroot's default tolerance (~1e-5), so n is re-solved on pwr's exact power function with tol = 1e-12
root <- function(f, lo, hi) uniroot(f, c(lo, hi), tol = 1e-13, extendInt = "yes")$root
t_rows <- list()
for (type in c("two.sample", "paired", "one.sample")) for (alt in c("two.sided", "greater")) for (d in c(0.2, 0.5, 0.8, 1.2)) for (a in c(0.05, 0.01)) {
  n <- root(function(n) pwr.t.test(n = n, d = d, sig.level = a, type = type, alternative = alt)$power - 0.8, 2 + 1e-10, 1e6)
  t_rows[[length(t_rows) + 1]] <- list(type = type, alt = alt, d = d, alpha = a, n = n,
    power20 = pwr.t.test(n = 20, d = d, sig.level = a, type = type, alternative = alt)$power)
}
pw$t <- t_rows
pw$tEffect <- list(n = 25, d = root(function(d) pwr.t.test(n = 25, d = d, sig.level = 0.05)$power - 0.9, 1e-6, 5))
a_rows <- list()
for (k in c(3, 4, 6)) for (f in c(0.1, 0.25, 0.4)) for (a in c(0.05, 0.01))
  a_rows[[length(a_rows) + 1]] <- list(k = k, f = f, alpha = a, n = root(function(n) pwr.anova.test(k = k, f = f, sig.level = a, n = n)$power - 0.8, 2 + 1e-10, 1e6), power15 = pwr.anova.test(k = k, f = f, sig.level = a, n = 15)$power)
pw$anova <- a_rows
p_rows <- list()
for (pr in list(c(0.5, 0.3), c(0.2, 0.1), c(0.9, 0.8), c(0.65, 0.5))) for (a in c(0.05, 0.01)) {
  h <- ES.h(pr[1], pr[2])
  p_rows[[length(p_rows) + 1]] <- list(p1 = pr[1], p2 = pr[2], alpha = a, h = h, n = root(function(n) pwr.2p.test(h = h, sig.level = a, n = n)$power - 0.8, 2, 1e7), power50 = pwr.2p.test(h = h, n = 50, sig.level = a)$power, nGreater = root(function(n) pwr.2p.test(h = h, sig.level = a, n = n, alternative = "greater")$power - 0.8, 2, 1e7))
}
pw$prop <- p_rows
r_rows <- list()
for (depth in c(5, 20, 100)) for (cv in c(0.2, 0.4, 0.8)) for (eff in c(1.5, 2)) {
  r_rows[[length(r_rows) + 1]] <- list(depth = depth, cv = cv, effect = eff, n = rnapower(depth = depth, cv = cv, effect = eff, alpha = 0.05, power = 0.8),
    power6 = rnapower(depth = depth, n = 6, cv = cv, effect = eff, alpha = 0.05), effect6 = rnapower(depth = depth, n = 6, cv = cv, alpha = 0.05, power = 0.8),
    cv6 = rnapower(depth = depth, n = 6, effect = eff, alpha = 0.05, power = 0.8))
}
pw$rnaseq <- r_rows
l_rows <- list()
for (hr in c(0.5, 0.67, 0.75)) for (pwr_ in c(0.8, 0.9)) {
  l_rows[[length(l_rows) + 1]] <- list(hr = hr, power = pwr_, events = nEvents(hr = hr, alpha = 0.025, beta = 1 - pwr_, ratio = 1, sided = 1),
    closed = 4 * (qnorm(0.975) + qnorm(pwr_))^2 / log(hr)^2, eventsRatio2 = nEvents(hr = hr, alpha = 0.025, beta = 1 - pwr_, ratio = 2, sided = 1))
}
pw$logrank <- l_rows
out$power <- pw

# ---------------------------------------------------------------- qPCR is generated by qpcr-reference.R (kept separate so a missing package does not block this file)
if (file.exists("benchmarks/lab/qpcr-reference.R")) out$qpcr <- source("benchmarks/lab/qpcr-reference.R", local = TRUE)$value
write_json(out, "benchmarks/lab/reference.json", auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null")
cat("wrote benchmarks/lab/reference.json\n")

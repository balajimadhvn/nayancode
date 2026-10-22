"""Independent reference values for the Statistics Studio tests.

Everything here comes from scipy.stats on fixed, seeded data sets so the
TypeScript implementations can be compared against a trusted library.
Run: python3 benchmarks/stats/make-reference.py
"""
import json
import os

import numpy as np
from scipy import stats

rng = np.random.default_rng(11)

# Two independent samples, different variances.
a1 = rng.normal(10.0, 2.0, 12)
b1 = rng.normal(12.5, 4.0, 15)

# Paired sample.
p1 = rng.normal(5.0, 1.0, 10)
p2 = p1 + rng.normal(0.8, 1.2, 10)

# Three groups of sizes 8, 9, 10.
g1 = rng.normal(4.0, 1.0, 8)
g2 = rng.normal(5.0, 1.5, 9)
g3 = rng.normal(6.5, 2.0, 10)

# Regression pair.
x = np.linspace(0.0, 10.0, 20)
y = 2.0 + 0.7 * x + rng.normal(0, 0.5, 20)

table3 = np.array([[12, 5, 7], [8, 9, 15]])
table2 = np.array([[7, 3], [2, 9]])

out = {
    "note": "numpy seed 11; scipy.stats",
    "a": a1.tolist(),
    "b": b1.tolist(),
    "paired1": p1.tolist(),
    "paired2": p2.tolist(),
    "g1": g1.tolist(),
    "g2": g2.tolist(),
    "g3": g3.tolist(),
    "x": x.tolist(),
    "y": y.tolist(),
    "table3": table3.tolist(),
    "table2": table2.tolist(),
}

w = stats.ttest_ind(a1, b1, equal_var=False)
s = stats.ttest_ind(a1, b1, equal_var=True)
pt = stats.ttest_rel(p1, p2)
one = stats.ttest_1samp(a1, 10.0)
fa = stats.f_oneway(g1, g2, g3)
lev = stats.levene(g1, g2, g3, center="median")
mw = stats.mannwhitneyu(a1, b1, alternative="two-sided", method="asymptotic", use_continuity=True)
wx = stats.wilcoxon(p1, p2, zero_method="wilcox", correction=True, method="approx")
kw = stats.kruskal(g1, g2, g3, nan_policy="raise")
chi3 = stats.chi2_contingency(table3, correction=False)
chi2 = stats.chi2_contingency(table2, correction=True)
chi2_nc = stats.chi2_contingency(table2, correction=False)
fis = stats.fisher_exact(table2.tolist())
fis_31 = stats.fisher_exact([[3, 1], [1, 3]])
pr = stats.pearsonr(x, y)
sp = stats.spearmanr(x, y)
lr = stats.linregress(x, y)

out.update({
    "welch": {"t": float(w.statistic), "df": float(w.df), "p": float(w.pvalue)},
    "student": {"t": float(s.statistic), "df": float(s.df), "p": float(s.pvalue)},
    "paired": {"t": float(pt.statistic), "df": float(pt.df), "p": float(pt.pvalue)},
    "oneSample": {"t": float(one.statistic), "df": float(one.df), "p": float(one.pvalue)},
    "anova": {"F": float(fa.statistic), "df1": 2.0, "df2": float(g1.size + g2.size + g3.size - 3), "p": float(fa.pvalue)},
    "levene": {"W": float(lev.statistic), "p": float(lev.pvalue)},
    "mannWhitney": {"U": float(mw.statistic), "p": float(mw.pvalue)},
    "wilcoxon": {"W": float(wx.statistic), "p": float(wx.pvalue)},
    "kruskal": {"H": float(kw.statistic), "p": float(kw.pvalue)},
    "chi3": {"chi2": float(chi3.statistic), "df": int(chi3.dof), "p": float(chi3.pvalue)},
    "chi2_yates": {"chi2": float(chi2.statistic), "df": int(chi2.dof), "p": float(chi2.pvalue)},
    "chi2_pearson": {"chi2": float(chi2_nc.statistic), "df": int(chi2_nc.dof), "p": float(chi2_nc.pvalue)},
    "fisher": {"or": float(fis.statistic), "p": float(fis.pvalue)},
    "fisher31": {"or": float(fis_31.statistic), "p": float(fis_31.pvalue)},
    "pearson": {"r": float(pr.statistic), "p": float(pr.pvalue)},
    "spearman": {"rho": float(sp.statistic), "p": float(sp.pvalue)},
    "linreg": {"slope": float(lr.slope), "intercept": float(lr.intercept), "se_slope": float(lr.stderr),
               "r2": float(lr.rvalue ** 2), "t": float(lr.rvalue * np.sqrt((x.size - 2) / (1 - lr.rvalue ** 2))),
               "p": float(lr.pvalue), "se_intercept": float(lr.intercept_stderr)},
})

# Multiple-testing adjustments written by hand.
pvals = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
m = len(pvals)
bonf = [min(1.0, p * m) for p in pvals]
order = sorted(range(m), key=lambda i: pvals[i])
holm = [0.0] * m
running = 0.0
for rank, i in enumerate(order):
    val = min(1.0, pvals[i] * (m - rank))
    running = max(running, val)
    holm[i] = running
bh = [0.0] * m
running = 1.0
for rank in range(m - 1, -1, -1):
    i = order[rank]
    running = min(running, pvals[i] * m / (rank + 1))
    bh[i] = min(1.0, running)
out["pvalues"] = pvals
out["bonferroni"] = bonf
out["holm"] = holm
out["bh"] = bh

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "reference.json"), "w") as fh:
    json.dump(out, fh, indent=2)
    fh.write("\n")
print(json.dumps({k: v for k, v in out.items() if k not in ("a", "b", "paired1", "paired2", "g1", "g2", "g3", "x", "y")}, indent=2))

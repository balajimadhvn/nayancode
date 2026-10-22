"""Known answers for src/studios/variants/assoc.test.ts, computed with numpy/scipy (independent of the TypeScript code).
Run: python3 make-reference.py > reference.json"""
import json, numpy as np
from math import lgamma, exp, log
from scipy import stats, optimize

def hwe_ref(nAA, nAB, nBB):
    n = nAA + nAB + nBB; nA = 2 * nAA + nAB; nB = 2 * nBB + nAB
    lp = lambda h: lgamma(n + 1) - lgamma((nA - h) // 2 + 1) - lgamma(h + 1) - lgamma((nB - h) // 2 + 1) + h * log(2) + lgamma(nA + 1) + lgamma(nB + 1) - lgamma(2 * n + 1)
    ps = {h: exp(lp(h)) for h in range(min(nA, nB) + 1) if (nA - h) % 2 == 0}; tot = sum(ps.values()); p0 = ps[nAB]
    return sum(v for v in ps.values() if v <= p0 * (1 + 1e-9)) / tot

rng = np.random.default_rng(3); n = 80
g = rng.integers(0, 3, n).astype(float); age = rng.normal(50, 10, n).round(1); y = (0.5 * g + 0.03 * age + rng.normal(0, 1, n)).round(3)
X = np.column_stack([np.ones(n), g, age]); b = np.linalg.lstsq(X, y, rcond=None)[0]; res = y - X @ b; df = n - 3
cov = (res @ res / df) * np.linalg.inv(X.T @ X); t = b[1] / np.sqrt(cov[1, 1])
yb = (y > np.median(y)).astype(float)
nll = lambda bb: np.sum(np.log1p(np.exp(X @ bb)) - yb * (X @ bb))
bb = optimize.minimize(nll, np.zeros(3), method='BFGS', options={'gtol': 1e-10}).x
mu = 1 / (1 + np.exp(-X @ bb)); H = X.T @ (X * (mu * (1 - mu))[:, None]); se = np.sqrt(np.linalg.inv(H)[1, 1])
cases = np.array([30, 40, 20]); ctrl = np.array([50, 35, 10]); R, S = cases.sum(), ctrl.sum(); N = R + S; nk = cases + ctrl; tt = np.array([0, 1, 2])
chi = N * (N * (tt @ cases) - R * (tt @ nk)) ** 2 / (R * S * (N * (tt ** 2 @ nk) - (tt @ nk) ** 2))
print(json.dumps({
    'hwe': [[list(t_), hwe_ref(*t_)] for t_ in [(50, 40, 10), (10, 80, 10), (98, 2, 0), (30, 40, 30), (0, 20, 80)]],
    'linear': {'g': g.tolist(), 'age': age.tolist(), 'y': y.tolist(), 'beta': b[1], 'se': float(np.sqrt(cov[1, 1])), 'p': float(2 * stats.t.sf(abs(t), df))},
    'logistic': {'y': yb.tolist(), 'beta': bb[1], 'se': float(se), 'p': float(2 * stats.norm.sf(abs(bb[1] / se)))},
    'trend': {'cases': cases.tolist(), 'controls': ctrl.tolist(), 'chi': float(chi), 'p': float(stats.chi2.sf(chi, 1))},
}))

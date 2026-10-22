"""Independent reference values for the Lab Studio enzyme-kinetics tests.

Michaelis–Menten data are generated here and fitted with scipy.optimize.curve_fit;
the JSON written next to this script is what `src/studios/lab/kinetics.test.ts`
compares against (relative tolerance 1e-4 on the parameters, 1e-3 on the SEs).

Run: python3 benchmarks/lab/make-kinetics-reference.py
"""
import json
import os

import numpy as np
from scipy.optimize import curve_fit

rng = np.random.default_rng(7)

S = np.array([0.3, 0.6, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0])
VMAX, KM = 50.0, 3.0
clean = VMAX * S / (KM + S)
v = clean * (1.0 + 0.05 * rng.standard_normal(len(S)))


def mm(s, vmax, km):
    return vmax * s / (km + s)


popt, pcov = curve_fit(mm, S, v, p0=[40.0, 2.0])
perr = np.sqrt(np.diag(pcov))

out = {
    "note": "scipy.optimize.curve_fit, numpy seed 7, 5% multiplicative noise",
    "S": S.tolist(),
    "v": v.tolist(),
    "Vmax": float(popt[0]),
    "Km": float(popt[1]),
    "VmaxSE": float(perr[0]),
    "KmSE": float(perr[1]),
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "kinetics-reference.json"), "w") as fh:
    json.dump(out, fh, indent=2)
    fh.write("\n")

# --- shared NLS fitter test: a noisy exponential, a = 3, b = 0.5, sigma = 0.05 ---
rng2 = np.random.default_rng(42)
x = np.arange(0.0, 10.5, 0.5)
y = 3.0 * np.exp(-0.5 * x) + 0.05 * rng2.standard_normal(len(x))


def expp(v, a, b):
    return a * np.exp(-b * v)


popt2, pcov2 = curve_fit(expp, x, y, p0=[1.0, 0.1])
perr2 = np.sqrt(np.diag(pcov2))
nls = {
    "note": "scipy.optimize.curve_fit, numpy seed 42, additive noise sigma 0.05",
    "x": [[float(v)] for v in x],
    "y": y.tolist(),
    "a": float(popt2[0]),
    "b": float(popt2[1]),
    "aSE": float(perr2[0]),
    "bSE": float(perr2[1]),
}
nls["x"] = [float(v) for v in x]
with open(os.path.join(here, "nls-reference.json"), "w") as fh:
    json.dump(nls, fh, indent=2)
    fh.write("\n")
print(json.dumps(out, indent=2))
print(json.dumps({k: v for k, v in nls.items() if k not in ("x", "y")}, indent=2))

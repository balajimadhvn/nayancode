"""Reference values for the browser ANM (anisotropic network model) kernel.

Builds 40 random "Cα-like" points from a self-avoiding random walk with 3.8 Å steps, assembles the ANM Hessian with
numpy exactly as src/studios/structure/netmodes.ts does, diagonalises it with numpy.linalg.eigh and writes the
coordinates, the first ten non-zero eigenvalues and the per-residue mean-square fluctuations to reference.json.

Usage:  python3 benchmarks/structure/make-reference.py
"""
import json
import os

import numpy as np

N = 40
STEP = 3.8
MIN_SEP = 3.0
CUTOFF = 15.0
GAMMA = 1.0
SEED = 20261022


def random_walk(n=N, step=STEP, seed=SEED):
    rng = np.random.default_rng(seed)
    pts = np.zeros((n, 3))
    for i in range(1, n):
        for _ in range(10000):
            v = rng.normal(size=3)
            v /= np.linalg.norm(v)
            p = pts[i - 1] + step * v
            if np.all(np.linalg.norm(pts[:i] - p, axis=1) > MIN_SEP):
                pts[i] = p
                break
        else:  # pragma: no cover - the walk never gets stuck with these parameters
            raise RuntimeError("random walk could not extend")
    return pts


def hessian(pts, cutoff=CUTOFF, gamma=GAMMA):
    n = len(pts)
    H = np.zeros((3 * n, 3 * n))
    for i in range(n):
        for j in range(i + 1, n):
            d = pts[j] - pts[i]
            r = float(np.linalg.norm(d))
            if r < cutoff:
                block = gamma * np.outer(d, d) / (r * r)
                H[3 * i:3 * i + 3, 3 * j:3 * j + 3] = -block
                H[3 * j:3 * j + 3, 3 * i:3 * i + 3] = -block
                H[3 * i:3 * i + 3, 3 * i:3 * i + 3] += block
                H[3 * j:3 * j + 3, 3 * j:3 * j + 3] += block
    return H


def main():
    pts = random_walk()
    H = hessian(pts)
    w, v = np.linalg.eigh(H)
    order = np.argsort(w)
    w, v = w[order], v[:, order]
    nonzero = np.where(w > 1e-6)[0]
    lam10 = w[nonzero[:10]]
    msf = (v[:, nonzero] ** 2 / w[nonzero]).sum(axis=1).reshape(len(pts), 3).sum(axis=1)
    out = {
        "what": "Anisotropic network model reference (numpy.linalg.eigh)",
        "generated_by": "benchmarks/structure/make-reference.py",
        "parameters": {"n": N, "step": STEP, "minSeparation": MIN_SEP, "cutoff": CUTOFF, "gamma": GAMMA, "seed": SEED},
        "coords": pts.round(6).tolist(),
        "eigenvaluesNonzeroFirst10": lam10.tolist(),
        "msf": msf.tolist(),
        "zeroModeCount": int((w < 1e-6).sum()),
        "spectrumSmallest": w[:12].tolist(),
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {path}: {len(lam10)} eigenvalues, {len(msf)} MSF values, {out['zeroModeCount']} zero modes")
    print("first eigenvalues:", np.array2string(lam10[:4], precision=6))


if __name__ == "__main__":
    main()

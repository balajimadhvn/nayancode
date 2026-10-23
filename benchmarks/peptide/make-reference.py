"""Independent reference values for the Peptide Studio tests.

The values are computed here with plain Python (no project code, no numpy) and
written next to this script; `src/studios/peptide/props.test.ts` and
`ms.test.ts` compare against them.

Run: python3 benchmarks/peptide/make-reference.py
"""
import json
import math
import os

# Eisenberg consensus hydrophobicity scale (Eisenberg et al. 1984).
EISENBERG = {
    "A": 0.62, "R": -2.53, "N": -0.78, "D": -0.90, "C": 0.29, "Q": -0.85,
    "E": -0.74, "G": 0.48, "H": -0.40, "I": 1.38, "L": 1.06, "K": -1.50,
    "M": 0.64, "F": 1.19, "P": 0.12, "S": -0.18, "T": -0.05, "W": 0.81,
    "Y": 0.26, "V": 1.08,
}

# Monoisotopic residue masses (same NIST table as the studio).
MONO = {
    "G": 57.02146372, "A": 71.03711379, "S": 87.03202841, "P": 97.05276385,
    "V": 99.06841391, "T": 101.04767847, "C": 103.00918478, "L": 113.08406398,
    "I": 113.08406398, "N": 114.04292744, "D": 115.02694303, "Q": 128.05857751,
    "K": 128.09496302, "E": 129.04259309, "M": 131.04048491, "H": 137.05891186,
    "F": 147.06841391, "R": 156.10111103, "Y": 163.06332853, "W": 186.07931295,
}
WATER = 18.0105646863
PROTON = 1.00727646688


def hydrophobic_moment(seq, delta_deg=100.0):
    """<muH> = |sum H_n exp(i n delta)| / N, with n starting at 1."""
    re = sum(EISENBERG[a] * math.cos(math.radians(delta_deg * (i + 1))) for i, a in enumerate(seq))
    im = sum(EISENBERG[a] * math.sin(math.radians(delta_deg * (i + 1))) for i, a in enumerate(seq))
    return math.hypot(re, im) / len(seq)


def neutral_mass(seq):
    return sum(MONO[a] for a in seq) + WATER


def b_ion(seq, i):
    return sum(MONO[a] for a in seq[:i]) + PROTON


def y_ion(seq, i):
    return sum(MONO[a] for a in seq[-i:]) + WATER + PROTON


SEQ = "LKKLLKLLKKLLKLLKKL"
PEPTIDE = "PEPTIDE"

out = {
    "note": "plain Python (math only), Eisenberg 1984 scale, delta = 100 deg, n starts at 1",
    "hydrophobicMoment": {
        "seq": SEQ,
        "delta": 100.0,
        "value": hydrophobic_moment(SEQ, 100.0),
        "beta": hydrophobic_moment(SEQ, 160.0),
    },
    "LLLLLLLL": {
        "value": hydrophobic_moment("LLLLLLLL", 100.0),
        "rawSumRe": sum(1.06 * math.cos(math.radians(100.0 * n)) for n in range(1, 9)),
        "rawSumIm": sum(1.06 * math.sin(math.radians(100.0 * n)) for n in range(1, 9)),
    },
    "peptide": {
        "seq": PEPTIDE,
        "neutralMass": neutral_mass(PEPTIDE),
        "b": [b_ion(PEPTIDE, i) for i in range(1, len(PEPTIDE))],
        "y": [y_ion(PEPTIDE, i) for i in range(1, len(PEPTIDE))],
        "cyclicMass": neutral_mass(PEPTIDE) - WATER,
        "oneDisulfideMass": neutral_mass(PEPTIDE) - 2 * 1.00782503,
    },
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "reference.json"), "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")

print(json.dumps(out, indent=2))

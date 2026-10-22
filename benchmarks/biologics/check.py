"""Independent check of the Biologics Studio charge and motif values.

Run: python3 benchmarks/biologics/check.py
The pKa set is the one documented in liabilities.ts (and used by proteinProps).
"""
PKA = {"n": 9.69, "c": 2.34, "K": 10.5, "R": 12.4, "H": 6.0, "D": 3.86, "E": 4.25, "C": 8.3, "Y": 10.07}


def charge(seq, pH):
    q = 1 / (1 + 10 ** (pH - PKA["n"])) - 1 / (1 + 10 ** (PKA["c"] - pH))
    for aa in seq:
        if aa in "KRH":
            q += 1 / (1 + 10 ** (pH - PKA[aa]))
        elif aa in "DECY":
            q -= 1 / (1 + 10 ** (PKA[aa] - pH))
    return q


def pI(seq):
    lo, hi = 0.0, 14.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if charge(seq, mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


print("charge(KKKKK, 7.4) =", charge("KKKKK", 7.4))
print("charge(EEEEE, 7.4) =", charge("EEEEE", 7.4))
print("pI(KKKKK) =", pI("KKKKK"))
print("pI(DDDDD) =", pI("DDDDD"))
print("residues: A1 N2 G3 S4 D5 G6 N7 T8 K9")
print("N-glycosylation N[^P][ST] at:", [i + 1 for i in range(len("ANGSDGNTK") - 2) if "ANGSDGNTK"[i] == "N" and "ANGSDGNTK"[i + 1] != "P" and "ANGSDGNTK"[i + 2] in "ST"])
print("isomerisation D[GSTHD] at:", [i + 1 for i in range(len("ANGSDGNTK") - 1) if "ANGSDGNTK"[i] == "D" and "ANGSDGNTK"[i + 1] in "GSTHD"])
print("deamidation N[GSTN] in ANGSDGNTK at:", [i + 1 for i in range(len("ANGSDGNTK") - 1) if "ANGSDGNTK"[i] == "N" and "ANGSDGNTK"[i + 1] in "GSTN"])

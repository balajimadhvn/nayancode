"""Collects IQ-TREE outputs into benchmarks/iqtree/ref/*.json (small, committed)."""
import json, os, re, sys

work, out, mode, version = sys.argv[1:5]
num = lambda pat, text: float(re.search(pat, text).group(1)) if re.search(pat, text) else None
for ds in ["woodmouse", "Laurasiatherian", "chloroplast", "yeast"]:
    rd = lambda suf: open(os.path.join(work, f"{ds}.{suf}")).read() if os.path.exists(os.path.join(work, f"{ds}.{suf}")) else ""
    if mode == "eval":
        rep = rd("eval.iqtree")
        if rep: json.dump({"logL": num(r"Log-likelihood of the tree: (-?[\d.]+)", rep)}, open(os.path.join(out, f"{ds}.eval.json"), "w"), indent=1)
        continue
    ml, mf, boot = rd("ml.iqtree"), rd("mf.iqtree"), rd("boot.iqtree")
    r = {
        "iqtree": version.strip(),
        "model": re.search(r"Model of substitution: (\S+)", ml).group(1),
        "logL": num(r"Log-likelihood of the tree: (-?[\d.]+)", ml),
        "kappa": num(r"Transition/transversion rate ratio: ([\d.]+)", ml) or num(r"A-G: ([\d.]+)", ml),
        "alpha": num(r"Gamma shape alpha: ([\d.]+)", ml),
        "runtimeSeconds": num(r"Total wall-clock time used: ([\d.]+) sec", ml),
        "tree": rd("ml.treefile").strip(),
        "modelSelectionBIC": re.search(r"Best-fit model according to BIC: (\S+)", mf).group(1) if mf else None,
        "bootstrapTree": rd("boot.treefile").strip() or None,
        "bootstrapRuntimeSeconds": num(r"Total wall-clock time used: ([\d.]+) sec", boot) if boot else None,
    }
    json.dump(r, open(os.path.join(out, f"{ds}.json"), "w"), indent=1)
    print(ds, r["model"], r["logL"], "alpha", r["alpha"], "kappa", r["kappa"], "BIC best", r["modelSelectionBIC"], f'{r["runtimeSeconds"]} s')

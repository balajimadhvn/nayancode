"""Trains the small gradient-boosted models shipped in public/data/admet/models.json.

Inputs are the RDKit MinimalLib descriptor tables written by features.mjs (identical to what the browser computes).
Evaluation: Bemis–Murcko scaffold split (80/10/10 train/valid/test, whole scaffolds kept together), the harder and
more honest split used by MoleculeNet. The shipped model is then refit on all rows.
Usage: python3 train.py <dir-with-esol.json,lipo.json,bbbp.json> <out-dir>
"""
import json, sys, numpy as np
from collections import defaultdict
from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold
from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier
from sklearn.metrics import mean_squared_error, r2_score, roc_auc_score

src, out = sys.argv[1], sys.argv[2]
SETS = {
    'solubility': dict(file='esol.json', col='measured log solubility in mols per litre', task='regression', unit='log10(mol/L)', label='Aqueous solubility (logS)', source='Delaney (2004) ESOL set, 1,128 compounds (MoleculeNet)'),
    'lipophilicity': dict(file='lipo.json', col='exp', task='regression', unit='logD 7.4', label='Lipophilicity (logD at pH 7.4)', source='AstraZeneca ChEMBL deposition, 4,200 compounds (CC BY-SA 3.0; MoleculeNet)'),
    'bbb': dict(file='bbbp.json', col='p_np', task='classification', unit='probability', label='Blood–brain barrier penetration', source='Martins et al. (2012), 2,039 compounds (MoleculeNet BBBP)'),
}

def scaffold_split(smiles, seed=0):
    groups = defaultdict(list)
    for i, s in enumerate(smiles):
        m = Chem.MolFromSmiles(s)
        try: sc = MurckoScaffold.MurckoScaffoldSmiles(mol=m) if m else ''
        except Exception: sc = ''
        groups[sc].append(i)
    sets = sorted(groups.values(), key=lambda g: (len(g), g[0]), reverse=True)
    n = len(smiles); tr, va, te = [], [], []
    for g in sets:
        if len(tr) + len(g) <= 0.8 * n: tr += g
        elif len(va) + len(g) <= 0.1 * n: va += g
        else: te += g
    return np.array(tr), np.array(va), np.array(te)

def export(est, task):
    trees = []
    for row in est.estimators_:
        t = row[0].tree_
        trees.append(dict(f=t.feature.tolist(), t=[float(v) for v in t.threshold], l=t.children_left.tolist(), r=t.children_right.tolist(), v=[round(float(v[0][0]), 9) for v in t.value]))
    return trees

models = {}; report = {}
for key, cfg in SETS.items():
    d = json.load(open(f"{src}/{cfg['file']}")); names = d['names']; ci = d['head'].index(cfg['col'])
    X = np.array([r['x'] for r in d['rows']], dtype=float); y = np.array([float(r['row'][ci]) for r in d['rows']]); smi = [r['smiles'] for r in d['rows']]
    tr, va, te = scaffold_split(smi)
    mk = lambda: (GradientBoostingRegressor if cfg['task'] == 'regression' else GradientBoostingClassifier)(n_estimators=250, max_depth=4, learning_rate=0.05, subsample=0.8, min_samples_leaf=5, random_state=0)
    est = mk().fit(X[tr], y[tr])
    if cfg['task'] == 'regression':
        p = est.predict(X[te]); rep = dict(rmse=float(mean_squared_error(y[te], p) ** 0.5), r2=float(r2_score(y[te], p)), base_rmse=float(np.std(y[te])))
    else:
        p = est.predict_proba(X[te])[:, 1]; rep = dict(auc=float(roc_auc_score(y[te], p)), base_rate=float(y[te].mean()))
    rep.update(n=len(y), n_train=int(len(tr)), n_test=int(len(te)), split='Bemis–Murcko scaffold, 80/10/10'); report[key] = rep
    final = mk().fit(X, y)
    lo, hi = np.percentile(X, 1, axis=0), np.percentile(X, 99, axis=0)
    init = float(np.log(y.mean() / (1 - y.mean()))) if cfg['task'] == 'classification' else float(final.init_.constant_.ravel()[0])
    models[key] = dict(label=cfg['label'], task=cfg['task'], unit=cfg['unit'], source=cfg['source'], lr=final.learning_rate, init=init, trees=export(final, cfg['task']), lo=[round(float(v), 4) for v in lo], hi=[round(float(v), 4) for v in hi], names=names, metrics=rep)
    idx = np.arange(0, len(y), max(1, len(y) // 12))[:12]
    ref = final.predict(X[idx]) if cfg['task'] == 'regression' else final.predict_proba(X[idx])[:, 1]
    models[key]['reference'] = dict(x=X[idx].tolist(), y=[float(v) for v in ref])
    print(key, rep)
json.dump(models, open(f'{out}/models.json', 'w'), separators=(',', ':'))
json.dump(report, open(f'{out}/report.json', 'w'), indent=1)

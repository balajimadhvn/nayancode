import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alignFeatures, boiledEgg, outOfDomain, predict, rules, type ModelSet } from './admet';
import { loadRdkitNode } from '../docking/rdkitNode';

const models = JSON.parse(readFileSync(new URL('../../../public/data/admet/models.json', import.meta.url), 'utf8')) as ModelSet;

describe('boosted-tree inference', () => {
  it('reproduces scikit-learn predictions to 1e-5 for every model', () => {
    for (const [k, m] of Object.entries(models)) {
      const ref = (m as unknown as { reference: { x: number[][]; y: number[] } }).reference;
      ref.x.forEach((x, i) => expect(Math.abs(predict(m, x) - ref.y[i]), `${k} row ${i}`).toBeLessThan(1e-5));
    }
  });
  it('reports held-out scaffold-split performance well above the null model', () => {
    expect(models.solubility.metrics.r2).toBeGreaterThan(0.75); expect(models.lipophilicity.metrics.r2).toBeGreaterThan(0.3); expect(models.bbb.metrics.auc).toBeGreaterThan(0.65);
  });
});

describe('chemistry end to end (RDKit WebAssembly under Node)', () => {
  const feats = async (smi: string) => {
    const RD = await loadRdkitNode(); const mol = RD.get_mol(smi)!; const d = JSON.parse((mol as unknown as { get_descriptors(): string }).get_descriptors()); mol.delete();
    const names = Object.keys(d).filter((k) => typeof d[k] === 'number').sort(); return { names, desc: names.map((k) => d[k] as number), d };
  };
  it('predicts sensible values for known drugs', async () => {
    const asp = await feats('CC(=O)Oc1ccccc1C(=O)O'), ben = await feats('c1ccccc1');
    const xs = alignFeatures(models.solubility, asp.names, asp.desc)!;
    expect(predict(models.solubility, xs)).toBeGreaterThan(-3); // aspirin logS ≈ −1.7
    const xb = alignFeatures(models.solubility, ben.names, ben.desc)!;
    expect(predict(models.solubility, xb)).toBeGreaterThan(-4); expect(predict(models.solubility, xb)).toBeLessThan(0.5);
    const caff = await feats('Cn1cnc2c1c(=O)n(C)c(=O)n2C'); // caffeine crosses the BBB
    expect(predict(models.bbb, alignFeatures(models.bbb, caff.names, caff.desc)!)).toBeGreaterThan(0.5);
    expect(outOfDomain(models.solubility, xs)).toBeLessThan(0.3);
  });
});

describe('rules', () => {
  it('flags Lipinski and Veber violations', () => {
    const r = rules({ mw: 650, logp: 6, tpsa: 160, hbd: 2, hba: 8, rotb: 12 });
    expect(r.find((x) => x.id === 'lipinski')!.violations).toEqual(['MW > 500', 'logP > 5']);
    expect(r.find((x) => x.id === 'veber')!.pass).toBe(false);
    expect(rules({ mw: 180, logp: 1.2, tpsa: 63, hbd: 1, hba: 4, rotb: 3 }).every((x) => x.pass)).toBe(true);
  });
  it('places small lipophilic molecules in the BOILED-Egg yolk', () => {
    expect(boiledEgg(30, 3)).toEqual({ gi: true, bbb: true }); expect(boiledEgg(120, 0)).toEqual({ gi: true, bbb: false }); expect(boiledEgg(200, 1).gi).toBe(false);
  });
});

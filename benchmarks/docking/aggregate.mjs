// Merges per-complex results (benchmarks/.cache/docking/results/*.json) into benchmarks/results/docking.json.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../.cache/docking/results/', import.meta.url);
const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id));
const ok = all.filter((r) => r.ok), failed = all.filter((r) => !r.ok);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const both = ok.filter((r) => r.native);
const topW = ok.map((r) => r.wasm.rmsd[0]), bestW = ok.map((r) => Math.min(...r.wasm.rmsd));
const topN = both.map((r) => r.native.rmsd[0]), bestN = both.map((r) => Math.min(...r.native.rmsd));
const frac = (a, t) => a.filter((v) => v < t).length / a.length;
const dScore = both.map((r) => r.wasm.scores[0] - r.native.scores[0]);
const sW = both.map((r) => r.wasm.scores[0]), sN = both.map((r) => r.native.scores[0]);
const poseAgree = both.map((r) => r.wasmVsNativeTop);
const summary = {
  generated: new Date().toISOString().slice(0, 10), exhaustiveness: all[0]?.exhaustiveness, attempted: all.length, docked: ok.length,
  excluded: failed.map((r) => ({ id: r.id, ligand: r.ligand, reason: r.error })),
  wasm: { top1Under2A: r3(frac(topW, 2)), top1Under2ACount: topW.filter((v) => v < 2).length, bestOf9Under2A: r3(frac(bestW, 2)), top1Under3A: r3(frac(topW, 3)), medianTopRmsd: r2(med(topW)), meanTopRmsd: r2(mean(topW)), medianSeconds: r2(med(ok.map((r) => r.wasm.seconds))) },
  native: both.length ? { n: both.length, top1Under2A: r3(frac(topN, 2)), top1Under2ACount: topN.filter((v) => v < 2).length, bestOf9Under2A: r3(frac(bestN, 2)), top1Under3A: r3(frac(topN, 3)), medianTopRmsd: r2(med(topN)), meanTopRmsd: r2(mean(topN)), medianSeconds: r2(med(both.map((r) => r.native.seconds))) } : null,
  agreement: both.length ? {
    n: both.length, topScorePearson: r3(pearson(sW, sN)), meanAbsScoreDiff: r3(mean(dScore.map(Math.abs))), maxAbsScoreDiff: r3(Math.max(...dScore.map(Math.abs))), within0_3kcal: r3(dScore.filter((d) => Math.abs(d) <= 0.3).length / dScore.length), within0_1kcal: r3(dScore.filter((d) => Math.abs(d) <= 0.1).length / dScore.length),
    topPoseRmsdWasmVsNativeMedian: r2(med(poseAgree)), topPoseWithin2A: r3(frac(poseAgree, 2)), topPoseWithin1A: r3(frac(poseAgree, 1)),
    sameSuccessCall: r3(both.filter((r) => (r.wasm.rmsd[0] < 2) === (r.native.rmsd[0] < 2)).length / both.length),
    wasmSlowdownMedian: r2(med(both.map((r) => r.wasm.seconds / r.native.seconds))),
  } : null,
  prep: { medianHeavyAtoms: med(ok.map((r) => r.heavyAtoms)), medianRotatable: med(ok.map((r) => r.rotatable)), embedChiralOk: ok.filter((r) => r.embed?.chiralOk !== false).length },
};
const per = ok.map((r) => ({ id: r.id, ligand: r.ligand, heavy: r.heavyAtoms, rot: r.rotatable, wasmScore: r.wasm.scores[0], wasmRmsd: r2(r.wasm.rmsd[0]), wasmBestRmsd: r2(Math.min(...r.wasm.rmsd)), nativeScore: r.native?.scores[0], nativeRmsd: r.native && r2(r.native.rmsd[0]), nativeBestRmsd: r.native && r2(Math.min(...r.native.rmsd)), wasmVsNative: r.wasmVsNativeTop != null ? r2(r.wasmVsNativeTop) : undefined, wasmSeconds: Math.round(r.wasm.seconds), nativeSeconds: r.native && Math.round(r.native.seconds) }));
writeFileSync(new URL('../results/docking.json', import.meta.url), JSON.stringify({ summary, complexes: per }, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));

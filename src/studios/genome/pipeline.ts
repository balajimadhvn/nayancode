/** Read mapping and variant calling with the vendored WebAssembly tools. The same function runs in the browser
 *  (tool-runner.js worker) and in Node for the benchmarks (benchmarks/lib/wasm-node.ts). */
import { callSnvs, parseBcftoolsVcf, parseFlagstat, snvsToVcf, summariseDepth, type CallerOpts, type Coverage, type Flagstat, type SnvCall } from './mapping';

export interface ToolResult { code: number; stdout: string; stderr: string; out: Record<string, Uint8Array> }
export type RunTool = (tool: 'minimap2' | 'samtools' | 'bcftools', args: string[], files: Record<string, Uint8Array | string>, outputs?: string[], opts?: { onLog?(l: string): void; signal?: AbortSignal }) => Promise<ToolResult>;
export interface PipelineInput { refText: string; contigs: { id: string; length: number }[]; reads: Uint8Array; preset: string; caller: 'bcftools' | 'builtin'; ploidy: 1 | 2; opt: CallerOpts }
export interface PipelineResult { flag: Flagstat; cov: Coverage[]; calls: SnvCall[]; vcf: string; bam: Uint8Array; bai: Uint8Array; consensus: string | null; log: string }

/** minimap2 -a (preset) → samtools sort/index/flagstat/depth/mpileup → bcftools mpileup + call -mv, or the built-in SNV caller. */
export async function mapAndCall(runTool: RunTool, inp: PipelineInput, h: { onProgress(f: number, note?: string): void; signal?: AbortSignal }): Promise<PipelineResult> {
  const { refText, preset, caller, ploidy, opt } = inp, readsData = inp.reads;
  const sig = { signal: h.signal }, log: string[] = [];
  h.onProgress(0.05, 'minimap2: aligning'); const m = await runTool('minimap2', ['-a', '-x', preset, '--secondary=no', '/ref.fa', '/reads.fq', '-o', '/aln.sam'], { 'ref.fa': refText, 'reads.fq': readsData }, ['aln.sam'], { ...sig, onLog: (l) => log.push(l) });
  if (m.code !== 0 || !m.out['aln.sam']) throw new Error(`minimap2 failed (exit ${m.code}): ${m.stderr.split('\n').filter(Boolean).slice(-2).join(' ')}`);
  h.onProgress(0.4, 'samtools: sort + index'); const so = await runTool('samtools', ['sort', '-o', '/sorted.bam', '/aln.sam'], { 'aln.sam': m.out['aln.sam'] }, ['sorted.bam'], sig); if (!so.out['sorted.bam']) throw new Error('samtools sort failed: ' + so.stderr.slice(-200));
  const ix = await runTool('samtools', ['index', '/sorted.bam'], { 'sorted.bam': so.out['sorted.bam'] }, ['sorted.bam.bai'], sig); if (!ix.out['sorted.bam.bai']) throw new Error('samtools index failed: ' + ix.stderr.slice(-200));
  h.onProgress(0.55, 'samtools: flagstat + depth'); const files = { 'sorted.bam': so.out['sorted.bam'], 'sorted.bam.bai': ix.out['sorted.bam.bai'] };
  const fs = await runTool('samtools', ['flagstat', '/sorted.bam'], files, [], sig), dp = await runTool('samtools', ['depth', '-a', '/sorted.bam', '-o', '/depth.txt'], files, ['depth.txt'], sig);
  const fai = await runTool('samtools', ['faidx', '/ref.fa'], { 'ref.fa': refText }, ['ref.fa.fai'], sig);
  let calls: SnvCall[], bcfVcf = '';
  if (caller === 'bcftools') {
    h.onProgress(0.8, 'bcftools: mpileup + call'); const refFiles = { ...files, 'ref.fa': refText, 'ref.fa.fai': fai.out['ref.fa.fai'] };
    const mp = await runTool('bcftools', ['mpileup', '-f', '/ref.fa', '-q', '20', '-Q', String(opt.minBaseQ), '-d', '10000', '-a', 'AD,DP', '-Ob', '-o', '/pile.bcf', '/sorted.bam'], refFiles, ['pile.bcf'], sig);
    if (!mp.out['pile.bcf']) throw new Error('bcftools mpileup failed: ' + mp.stderr.slice(-200));
    const cl = await runTool('bcftools', ['call', '-mv', ...(ploidy === 1 ? ['--ploidy', '1'] : []), '-Ov', '-o', '/calls.vcf', '/pile.bcf'] /* diploid is bcftools' default */, { 'pile.bcf': mp.out['pile.bcf'] }, ['calls.vcf'], sig);
    if (!cl.out['calls.vcf']) throw new Error('bcftools call failed: ' + cl.stderr.slice(-200));
    bcfVcf = new TextDecoder().decode(cl.out['calls.vcf']); calls = parseBcftoolsVcf(bcfVcf);
  } else {
    // The built-in caller reads a samtools text pileup (only needed on this path).
    h.onProgress(0.7, 'samtools: pileup');
    const pu = await runTool('samtools', ['mpileup', '-f', '/ref.fa', '-Q', String(opt.minBaseQ), '-q', '20', '-d', '100000', '/sorted.bam', '-o', '/pile.txt'], { ...files, 'ref.fa': refText, 'ref.fa.fai': fai.out['ref.fa.fai'] }, ['pile.txt'], sig);
    if (!pu.out['pile.txt']) throw new Error('samtools mpileup failed: ' + pu.stderr.slice(-200));
    calls = callSnvs(new TextDecoder().decode(pu.out['pile.txt']), opt);
  }
  h.onProgress(0.9, 'summarising'); const flag = parseFlagstat(fs.stdout || fs.stderr), cov = summariseDepth(new TextDecoder().decode(dp.out['depth.txt'] ?? new Uint8Array()));
  let consensus: string | null = null; try { const cs = await runTool('samtools', ['consensus', '-f', 'fasta', '-a', '--min-depth', '3', '-o', '/cons.fa', '/sorted.bam'], files, ['cons.fa'], sig); if (cs.out['cons.fa']?.length) consensus = new TextDecoder().decode(cs.out['cons.fa']); } catch { /* optional */ }
  const vcf = bcfVcf || snvsToVcf(calls, inp.contigs, 'reads');
  return { flag, cov, calls, vcf, bam: so.out['sorted.bam'], bai: ix.out['sorted.bam.bai'], consensus, log: log.join('\n') };
}

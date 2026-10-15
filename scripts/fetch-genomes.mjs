// Downloads the small reference genomes bundled with the Workbench from NCBI RefSeq into public/genomes/ and writes
// public/genomes/manifest.json (accession, assembly, licence, sequences, sizes, SHA-256).
//
//   node scripts/fetch-genomes.mjs            download what is missing, verify NCBI's MD5 sums, rewrite the manifest
//   node scripts/fetch-genomes.mjs --check    verify the files in public/genomes against the manifest (no network)
//
// Files are NCBI's own gzip files, shipped unchanged so their checksums can be compared with the NCBI FTP site.
// Every file must stay under 25 MiB (Cloudflare Workers static-asset limit); the script fails otherwise.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first'); // the NCBI FTP host advertises IPv6, which many networks cannot reach

const OUT = fileURLToPath(new URL('../public/genomes/', import.meta.url));
const LIMIT = 25 * 1024 * 1024;
// id, display name, RefSeq assembly accession with its NCBI assembly name, NCBI taxonomy id.
const GENOMES = [
  ['lambda', 'Escherichia phage lambda', 'GCF_000840245.1_ViralProj14204', 10710],
  ['t7', 'Escherichia phage T7', 'GCF_000844825.1_ViralProj14460', 10760],
  ['sars-cov-2', 'SARS-CoV-2 Wuhan-Hu-1', 'GCF_009858895.2_ASM985889v3', 2697049],
  ['ecoli-k12', 'Escherichia coli K-12 MG1655', 'GCF_000005845.2_ASM584v2', 511145],
  ['saureus-8325', 'Staphylococcus aureus NCTC 8325', 'GCF_000013425.1_ASM1342v1', 93061],
  ['bsubtilis-168', 'Bacillus subtilis 168', 'GCF_000009045.1_ASM904v1', 224308],
  ['mtb-h37rv', 'Mycobacterium tuberculosis H37Rv', 'GCF_000195955.2_ASM19595v2', 83332],
  ['scer-s288c', 'Saccharomyces cerevisiae S288C (R64)', 'GCF_000146045.2_R64', 559292],
];
const LICENCE = 'NCBI RefSeq data: public domain in the United States (works of the US Government, 17 U.S.C. § 105); NCBI places no restrictions on use or distribution. Cite the original submitters and RefSeq (O\'Leary et al. 2016).';
const check = process.argv.includes('--check');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const ftp = (asm) => { const [, a, b, c] = asm.match(/^GCF_(\d{3})(\d{3})(\d{3})/); return `https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/${a}/${b}/${c}/${asm}/`; };
async function get(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); }

if (check) {
  const m = JSON.parse(readFileSync(OUT + 'manifest.json', 'utf8')); let bad = 0;
  for (const g of m.genomes) for (const f of [g.fasta, g.gff].filter(Boolean)) {
    const b = readFileSync(OUT + f.file), ok = sha(b) === f.sha256 && b.length === f.bytes && b.length < LIMIT;
    if (!ok) bad++; console.log(`${ok ? 'ok ' : 'BAD'} ${f.file}`);
  }
  process.exit(bad ? 1 : 0);
}

mkdirSync(OUT, { recursive: true });
const genomes = [];
for (const [id, name, asm, taxid] of GENOMES) {
  const base = ftp(asm), sums = new Map((await get(base + 'md5checksums.txt')).toString().trim().split('\n').map((l) => { const [h, f] = l.trim().split(/\s+/); return [f.replace(/^\.\//, ''), h]; }));
  const files = {};
  for (const [kind, suffix] of [['fasta', '_genomic.fna.gz'], ['gff', '_genomic.gff.gz']]) {
    const remote = asm + suffix, local = `${id}${kind === 'fasta' ? '.fna.gz' : '.gff3.gz'}`;
    let buf = existsSync(OUT + local) ? readFileSync(OUT + local) : null;
    if (!buf || md5(buf) !== sums.get(remote)) { console.log(`downloading ${remote}`); buf = await get(base + remote); writeFileSync(OUT + local, buf); }
    if (md5(buf) !== sums.get(remote)) throw new Error(`${remote}: MD5 does not match NCBI md5checksums.txt`);
    if (buf.length >= LIMIT) throw new Error(`${local} is ${buf.length} bytes, over the 25 MiB per-file limit`);
    files[kind] = { file: local, url: base + remote, bytes: statSync(OUT + local).size, sha256: sha(buf), md5: sums.get(remote), buf };
  }
  const fa = gunzipSync(files.fasta.buf).toString(), gff = gunzipSync(files.gff.buf).toString();
  const seqs = [], circular = new Set();
  for (const l of gff.split('\n')) { if (l[0] === '#') continue; const f = l.split('\t'); if (f[2] === 'region' && /Is_circular=true/.test(f[8] ?? '')) circular.add(f[0]); }
  for (const block of fa.split('>').slice(1)) { const nl = block.indexOf('\n'), head = block.slice(0, nl), len = block.slice(nl).replace(/\s+/g, '').length; const sid = head.split(/\s/)[0]; seqs.push({ id: sid, description: head.slice(sid.length + 1), length: len, circular: circular.has(sid) }); }
  const genes = gff.split('\n').filter((l) => l.split('\t')[2] === 'gene').length;
  const totalLength = seqs.reduce((a, s) => a + s.length, 0);
  genomes.push({
    id, name, taxid, accession: asm.split('_').slice(0, 2).join('_'), assemblyName: asm.split('_').slice(2).join('_'), source: 'NCBI RefSeq', totalLength, genes,
    sequences: seqs, fasta: strip(files.fasta), gff: strip(files.gff),
  });
  console.log(`${id}: ${seqs.length} sequence(s), ${totalLength.toLocaleString()} bp, ${genes} genes, ${(files.fasta.bytes / 1048576).toFixed(2)} + ${(files.gff.bytes / 1048576).toFixed(2)} MiB`);
}
function strip(f) { const { buf, ...rest } = f; void buf; return rest; }
const manifest = { generated: new Date().toISOString().slice(0, 10), licence: LICENCE, citation: 'O\'Leary NA, et al. (2016) Reference sequence (RefSeq) database at NCBI. Nucleic Acids Res 44:D733–D745.', genomes };
writeFileSync(OUT + 'manifest.json', JSON.stringify(manifest, null, 1) + '\n');
console.log(`manifest: ${genomes.length} genomes, ${(genomes.reduce((a, g) => a + g.fasta.bytes + g.gff.bytes, 0) / 1048576).toFixed(1)} MiB in total`);

// Fails the build if any production dependency (direct or transitive) has a licence outside the allow-list.
// Also writes public/licenses.json, shown on the in-app /licenses page.
import fs from 'node:fs';
import path from 'node:path';

const ALLOW = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'OFL-1.1', 'Python-2.0', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0'];
const WARN = ['MPL-2.0', 'LGPL-2.1', 'LGPL-3.0']; // weak copyleft: needs manual review
const root = process.cwd();
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function findPkgDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const cand = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
const seen = new Map();
function visit(name, fromDir) {
  const dir = findPkgDir(name, fromDir);
  if (!dir) return;
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const key = `${p.name}@${p.version}`;
  if (seen.has(key)) return;
  const license = typeof p.license === 'string' ? p.license : p.license?.type ?? p.licenses?.map((l) => l.type).join(' OR ') ?? 'UNKNOWN';
  seen.set(key, { name: p.name, version: p.version, license, repo: typeof p.repository === 'string' ? p.repository : p.repository?.url ?? '', homepage: p.homepage ?? '' });
  for (const d of Object.keys(p.dependencies ?? {})) visit(d, dir);
}
for (const d of Object.keys(rootPkg.dependencies ?? {})) visit(d, root);

const okLicense = (l) => l.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+|\//i).some((x) => ALLOW.includes(x.trim()));
const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const bad = packages.filter((p) => !okLicense(p.license));
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'public', 'licenses.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), allow: ALLOW, packages }, null, 1));
console.log(`licence check: ${packages.length} production packages, ${bad.length} outside allow-list`);
for (const b of bad) console.error(`  ✗ ${b.name}@${b.version}: ${b.license}${WARN.includes(b.license) ? ' (weak copyleft: review)' : ''}`);
if (bad.length) process.exit(1);

// Minimal static server for dist/ that behaves like GitHub Pages: /path/ → path/index.html; /path (a folder) →
// 301 /path/; /file.ext served as is; unknown paths → 404.html with status 404. _headers rules are also applied
// (Cloudflare Pages / Netlify) so either host can be previewed. Used by `npm run preview` and the e2e tests.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.xml': 'application/xml', '.txt': 'text/plain', '.data': 'application/octet-stream' };

const rules = [];
// GH_PAGES=1 ignores _headers, exactly like GitHub Pages (which cannot set custom headers).
if (!process.env.GH_PAGES && existsSync(join(dist, '_headers'))) {
  let cur = null;
  for (const line of readFileSync(join(dist, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { pat: line.trim(), h: [] }; rules.push(cur); }
    else if (cur) { const i = line.indexOf(':'); cur.h.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
}
const headersFor = (p) => rules.filter((r) => (r.pat.endsWith('*') ? p.startsWith(r.pat.slice(0, -1)) : p === r.pat || `${p}/` === r.pat || p === `${r.pat}/`)).flatMap((r) => r.h);

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  let file = normalize(join(dist, p));
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  let status = 200;
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: `${p}/${url.search}` }); return res.end(); }
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) { file = join(dist, '404.html'); status = 404; }
  const h = Object.fromEntries(headersFor(p));
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...h });
  createReadStream(file).pipe(res);
});
let tryPort = port;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tryPort < port + 20) { console.warn(`port ${tryPort} is in use, trying ${tryPort + 1}…`); server.listen(++tryPort); }
  else throw e;
});
server.on('listening', () => console.log(`serving dist/ on http://localhost:${tryPort} (GitHub Pages behaviour)`));
server.listen(tryPort);

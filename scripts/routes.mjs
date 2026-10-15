// After `vite build`: give every Workbench route its own folder with index.html so deep links and page refreshes work
// on static hosts (GitHub Pages serves /route/ from route/index.html); 404.html also boots the app.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dist = new URL('../dist/', import.meta.url).pathname;
const src = readFileSync(new URL('../src/core/studios.ts', import.meta.url), 'utf8');
const studioPaths = [...src.matchAll(/path: '(\/[a-z-]+)'/g)].map((m) => m[1]);
const routes = ['/licenses', '/report', '/atlas', '/import', '/workbench', ...studioPaths];
for (const r of routes) { mkdirSync(join(dist, r), { recursive: true }); copyFileSync(join(dist, 'index.html'), join(dist, r, 'index.html')); }
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
console.log(`routes: ${routes.length} route folders + 404.html`);

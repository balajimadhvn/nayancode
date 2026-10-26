#!/usr/bin/env node
/*
 * MIT License
 *
 * Copyright (c) 2026 Solagene
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Nayancode Bridge: a token-protected helper that runs allow-listed native tools on the visitor's own computer.
 * It listens on loopback only by default, never uses a shell, and never uploads anything to Solagene.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';
const DEFAULT_ORIGINS = ['https://solagene.com', 'https://www.solagene.com', 'http://localhost:4173', 'http://localhost:5173'];
const DEFAULT_TOOLS = ['gmx', 'gmx_mpi', 'samtools', 'bcftools', 'minimap2', 'bwa', 'bwa-mem2', 'STAR', 'fastp', 'seqtk', 'nvidia-smi'];
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ACTIVE_RUNS = 2;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID_RE = /^[a-f0-9]{12}$/;
const json = (res, status, body, extra = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra });
  res.end(text);
};
const fail = (res, status, message) => json(res, status, { error: message });
/** Minimal environment for child programs: only the variables named in RULES.md section 8. */
export function minimalEnv(source = process.env) {
  const out = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'LD_LIBRARY_PATH', 'GMXLIB', 'GMXDATA', 'CUDA_VISIBLE_DEVICES', 'OMP_NUM_THREADS']) {
    if (source[k] !== undefined) out[k] = source[k];
  }
  return out;
}
/** Resolve an allow-listed tool name through PATH. The request never supplies a path. */
export function whichTool(name, envPath = process.env.PATH || '', platform = process.platform) {
  if (!name || name.includes('/') || name.includes('\\') || name === '..' || name === '.') return null;
  const exts = platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        }
      } catch { /* keep looking */ }
    }
  }
  return null;
}
function parseArgs(argv) {
  const o = { port: 8787, host: '127.0.0.1', origins: [...DEFAULT_ORIGINS], allow: [...DEFAULT_TOOLS], root: path.join(os.tmpdir(), 'nayancode-bridge'), maxUploadMb: 500, allowHosts: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--port') o.port = Number(next());
    else if (a === '--host') o.host = next();
    else if (a === '--origin') o.origins.push(next());
    else if (a === '--allow') o.allow = (next() || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--root') o.root = path.resolve(next());
    else if (a === '--max-upload-mb') o.maxUploadMb = Number(next());
    else if (a === '--allow-host') o.allowHosts.push(String(next()).toLowerCase());
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!Number.isFinite(o.port) || o.port < 0 || o.port > 65535) throw new Error('--port must be 0-65535');
  if (!Number.isFinite(o.maxUploadMb) || o.maxUploadMb <= 0) throw new Error('--max-upload-mb must be positive');
  return o;
}
const asNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  const m = s.match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits */
export function parseNvidiaSmi(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(',').map((s) => s.trim());
    const driver = parts.length >= 2 ? parts.pop() : null;
    const memoryMb = parts.length >= 1 ? asNumber(parts.pop()) : null;
    const name = parts.join(', ').trim();
    if (!name) return null;
    return { name, vendor: 'nvidia', kind: 'unknown', memoryMb, driver, backends: ['cuda'] };
  }).filter(Boolean);
}
/** rocm-smi --showproductname --showmeminfo vram --json */
export function parseRocmSmi(text) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const out = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (!value || typeof value !== 'object') continue;
    const name = value['Card Series'] || value['Card series'] || value['Card SKU'] || value['Card model'] || '';
    if (!/^card/i.test(key) && !name) continue;
    const bytes = asNumber(value['VRAM Total Memory (B)'] ?? value['VRAM Total Used Memory (B)']);
    if (!name) continue;
    out.push({ name: String(name), vendor: 'amd', kind: 'unknown', memoryMb: bytes ? Math.round(bytes / (1024 * 1024)) : null, driver: value['Driver version'] ? String(value['Driver version']) : null, backends: ['rocm'] });
  }
  return out;
}
/** rocminfo text, fallback when rocm-smi is absent. */
export function parseRocminfo(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.match(/Marketing Name:\s*(.+)$/i)).filter(Boolean)
    .map((m) => ({ name: m[1].trim(), vendor: 'amd', kind: 'unknown', memoryMb: null, driver: null, backends: ['rocm'] }));
}
function vendorFor(text, id) {
  const s = `${text || ''}`.toLowerCase();
  if (s.includes('nvidia') || id === 0x10de) return 'nvidia';
  if (s.includes('advanced micro devices') || s.includes('amd') || s.includes('radeon') || id === 0x1002) return 'amd';
  if (s.includes('intel') || id === 0x8086) return 'intel';
  if (s.includes('apple') || id === 0x106b) return 'apple';
  return 'other';
}
/** clinfo text: Platform Name / Device Name / Device Vendor / Global memory size (bytes). */
export function parseClinfo(text) {
  const blocks = String(text || '').split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    const get = (re) => (block.match(re) || [])[1]?.trim();
    const name = get(/Device Name\s+(.+)$/im);
    if (!name) continue;
    const vendorText = get(/Device Vendor\s+(.+)$/im) || '';
    const bytes = asNumber(get(/Global memory size\s+([^\n]+)$/im));
    out.push({ name, vendor: vendorFor(`${name} ${vendorText}`), kind: /cpu/i.test(name) ? 'unknown' : 'unknown', memoryMb: bytes ? Math.round(bytes / (1024 * 1024)) : null, driver: get(/Driver Version\s+(.+)$/im) || null, backends: ['opencl'] });
  }
  return out;
}
/** vulkaninfo --summary: deviceName / vendorID / deviceType. */
export function parseVulkanInfo(text) {
  const blocks = String(text || '').split(/Device Properties and Extensions|GPU\d+:/);
  const out = [];
  for (const block of blocks) {
    const get = (re) => (block.match(re) || [])[1]?.trim();
    const name = get(/deviceName\s*=\s*(.+)$/im);
    if (!name) continue;
    const id = asNumber(get(/vendorID\s*=\s*(0x[0-9a-f]+|\d+)/im));
    const typeText = get(/deviceType\s*=\s*(.+)$/im) || '';
    const kind = /DISCRETE_GPU/.test(typeText) ? 'discrete' : /INTEGRATED_GPU/.test(typeText) ? 'integrated' : /CPU/.test(typeText) ? 'unknown' : 'unknown';
    out.push({ name, vendor: vendorFor(name, id), kind, memoryMb: null, driver: get(/driverVersion\s*=\s*(.+)$/im) || null, backends: ['vulkan'] });
  }
  return out;
}
/** Linux lspci lines for VGA / 3D / Display controllers. */
export function parseLspci(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/(VGA compatible controller|3D controller|Display controller)/i.test(line)) continue;
    const after = line.split(/controller[^:]*:\s*/i)[1] || line;
    const name = after.replace(/\s*\(rev [^)]+\)\s*$/i, '').trim();
    if (!name) continue;
    out.push({ name, vendor: vendorFor(name), kind: 'unknown', memoryMb: null, driver: null, backends: [] });
  }
  return out;
}
/** macOS system_profiler SPDisplaysDataType -detailLevel mini. */
export function parseMacProfiler(text) {
  const out = [];
  for (const block of String(text || '').split(/\n(?=\s*[A-Za-z].*:\s*$)/)) {
    const get = (re) => (block.match(re) || [])[1]?.trim();
    const name = get(/Chipset Model:\s*(.+)$/im);
    if (!name) continue;
    const vram = get(/(?:VRAM|Total Number of Cores)[^:]*:\s*(.+)$/im);
    const mem = vram && /GB/i.test(vram) ? Math.round(asNumber(vram) * 1024) : vram && /MB/i.test(vram) ? Math.round(asNumber(vram)) : null;
    out.push({ name, vendor: vendorFor(get(/Vendor:\s*(.+)$/im) || name), kind: /Apple M/i.test(name) ? 'integrated' : 'unknown', memoryMb: mem, driver: get(/Metal Support:\s*(.+)$/im) || null, backends: /Metal/i.test(block) ? ['metal'] : [] });
  }
  return out;
}
/** PowerShell Get-CimInstance Win32_VideoController | Select Name,AdapterRAM,DriverVersion | ConvertTo-Json */
export function parseWindowsVideo(text) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((d) => {
    const name = String(d.Name || '').trim();
    if (!name) return null;
    const bytes = asNumber(d.AdapterRAM);
    const kind = /UHD|Iris|Radeon\(TM\) Graphics|Integrated/i.test(name) ? 'integrated' : /NVIDIA|GeForce|RTX|GTX|Radeon RX|Arc\(TM\)/i.test(name) ? 'discrete' : 'unknown';
    return { name, vendor: vendorFor(name), kind, memoryMb: bytes ? Math.round(bytes / (1024 * 1024)) : null, driver: d.DriverVersion ? String(d.DriverVersion) : null, backends: ['d3d12'] };
  }).filter(Boolean);
}
/** Merge device reports by name, unioning the backends that actually reported each device. */
export function mergeGpus(lists) {
  const by = new Map();
  for (const list of lists) for (const g of list || []) {
    const key = g.name.trim().toLowerCase();
    const prev = by.get(key);
    if (!prev) { by.set(key, { ...g, backends: [...new Set(g.backends || [])] }); continue; }
    prev.vendor = prev.vendor === 'other' ? g.vendor : prev.vendor;
    prev.kind = prev.kind === 'unknown' ? g.kind : prev.kind;
    prev.memoryMb = prev.memoryMb ?? g.memoryMb;
    prev.driver = prev.driver ?? g.driver;
    prev.backends = [...new Set([...prev.backends, ...(g.backends || [])])];
  }
  return [...by.values()];
}
/** GROMACS --version text. */
export function parseGmxVersion(text) {
  const s = String(text || '');
  const line = (re) => (s.match(re) || [])[1]?.trim() || null;
  const rawGpu = line(/GPU support:\s*(.+)$/im) || '';
  const gpu = /CUDA/i.test(rawGpu) ? 'CUDA' : /OpenCL/i.test(rawGpu) ? 'OpenCL' : /SYCL/i.test(rawGpu) ? 'SYCL' : /HIP/i.test(rawGpu) ? 'HIP' : /disabled|none/i.test(rawGpu) ? 'disabled' : 'unknown';
  const mpi = line(/MPI library:\s*(.+)$/im);
  const threading = mpi ? (/thread_mpi/i.test(mpi) ? 'thread_mpi' : `MPI (${mpi})`) : /OpenMP/i.test(s) ? 'OpenMP' : 'unknown';
  return { version: line(/GROMACS version:\s*(.+)$/im), precision: line(/Precision:\s*(.+)$/im), gpu, simd: line(/SIMD instructions:\s*(.+)$/im), threading };
}
const vendorNote = (gpus) => {
  if (gpus.some((g) => g.vendor === 'nvidia')) return 'NVIDIA: install a CUDA build of GROMACS.';
  if (gpus.some((g) => g.vendor === 'amd')) return 'AMD: install a HIP build (Linux) or a SYCL build of GROMACS.';
  if (gpus.some((g) => g.vendor === 'intel')) return 'Intel: install a SYCL (oneAPI) build of GROMACS.';
  if (gpus.some((g) => g.vendor === 'apple')) return 'GROMACS uses the CPU on Apple Silicon (fast for small systems).';
  return 'No GPU was detected; use a CPU build.';
};
/** Choose mdrun flags from the build's real backend and the devices that are present. */
export function pickGmxGpuMode(gpus, build) {
  const has = (v) => (gpus || []).some((g) => g.vendor === v);
  const apple = has('apple');
  const gpuMode = (flags, note = '') => ({ mode: 'gpu', flags, note });
  const cpuMode = (note) => ({ mode: 'cpu', flags: [], note, howToGetGpu: vendorNote(gpus || []) });
  if (apple && !has('nvidia') && !has('amd')) return cpuMode('GROMACS uses the CPU on Apple Silicon (fast for small systems).');
  const gpu = build?.gpu;
  if (gpu === 'CUDA' && has('nvidia')) return gpuMode(['-nb', 'gpu', '-pme', 'gpu', '-bonded', 'gpu']);
  if (gpu === 'HIP' && has('amd')) return gpuMode(['-nb', 'gpu', '-pme', 'gpu']);
  if (gpu === 'SYCL' && (has('intel') || has('amd') || has('nvidia'))) return gpuMode(['-nb', 'gpu'], 'SYCL build: GPU offload of nonbonded forces only');
  if (gpu === 'OpenCL' && (has('amd') || has('intel'))) return gpuMode(['-nb', 'gpu'], 'OpenCL build: slower than CUDA/HIP; verify performance');
  return cpuMode(gpu === 'CUDA' || gpu === 'HIP' ? 'This GROMACS build has no GPU support for your hardware; running on the CPU.' : 'This GROMACS build has no GPU support for your hardware; running on the CPU.');
}
/** Run a helper command with no shell, a hard timeout, and no failure propagation. */
function capture(cmd, args = [], timeoutMs = 5000, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve) => {
    let out = '', done = false;
    let child;
    const finish = (text) => { if (done) return; done = true; resolve(text); };
    try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true }); } catch { return finish(''); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(out); }, timeoutMs);
    const add = (b) => { if (out.length < maxBytes) out += b.toString('utf8'); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    child.on('error', () => { clearTimeout(timer); finish(''); });
    child.on('close', () => { clearTimeout(timer); finish(out); });
  });
}
/** Detect the GPUs visible to this machine through whichever vendor tools are installed. */
export async function detectGpus(platform = process.platform, has = (n) => !!whichTool(n)) {
  const lists = [];
  const run = async (name, args, parser) => {
    if (!has(name)) return;
    const p = whichTool(name);
    if (!p) return;
    const text = await capture(p, args);
    if (text) lists.push(parser(text));
  };
  if (platform === 'linux') {
    await run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], parseNvidiaSmi);
    await run('rocm-smi', ['--showproductname', '--showmeminfo', 'vram', '--json'], parseRocmSmi);
    await run('rocminfo', [], parseRocminfo);
    await run('clinfo', [], parseClinfo);
    await run('vulkaninfo', ['--summary'], parseVulkanInfo);
    await run('lspci', [], parseLspci);
  } else if (platform === 'darwin') {
    await run('system_profiler', ['SPDisplaysDataType', '-detailLevel', 'mini'], parseMacProfiler);
  } else if (platform === 'win32') {
    const ps = has('powershell') ? 'powershell' : has('pwsh') ? 'pwsh' : null;
    if (ps) {
      const script = 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json';
      const text = await capture(whichTool(ps), ['-NoProfile', '-Command', script]);
      if (text) lists.push(parseWindowsVideo(text));
    }
  }
  return mergeGpus(lists);
}
/** One version probe per tool, cached for the life of the Bridge. */
function makeToolProbe() {
  const cache = new Map();
  return async function probe(name) {
    if (cache.has(name)) return cache.get(name);
    const p = whichTool(name);
    if (!p) { cache.set(name, null); return null; }
    const text = await capture(p, [name === 'nvidia-smi' ? '-L' : '--version']);
    const version = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || 'unknown';
    const entry = { path: p, version, text };
    cache.set(name, entry);
    return entry;
  };
}
function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (b) => { size += b.length; if (size <= limit) chunks.push(b); });
    req.on('end', () => {
      if (size > limit) return resolve({ error: 'Request body too large', status: 413 });
      try { resolve({ value: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} }); } catch { resolve({ error: 'Body must be JSON', status: 400 }); }
    });
    req.on('error', () => resolve({ error: 'Could not read the request body', status: 400 }));
  });
}
function safeArg(arg, jobDir) {
  if (typeof arg !== 'string' || arg.includes('\0')) return false;
  let value = arg;
  if (arg.startsWith('-')) {
    const eq = arg.indexOf('=');
    value = eq >= 0 ? arg.slice(eq + 1) : arg.slice(1);
    if (!value || !/[/\\]/.test(value) && value !== '..' && !value.startsWith('..')) return true;
  }
  const looksPath = value === '..' || value.startsWith('..') || value.startsWith('/') || value.startsWith('\\') || /[/\\]/.test(value);
  if (!looksPath) return true;
  const resolved = path.resolve(jobDir, value);
  return resolved === jobDir || resolved.startsWith(jobDir + path.sep);
}
function jobIdFrom(p) { return p.split('/')[2] || ''; }
export async function startServer(options = {}) {
  const cfg = {
    port: 8787, host: '127.0.0.1', origins: [...DEFAULT_ORIGINS], allow: [...DEFAULT_TOOLS],
    root: path.join(os.tmpdir(), 'nayancode-bridge'), maxUploadMb: 500, allowHosts: [], silent: false,
    ...options,
  };
  cfg.origins = [...new Set(cfg.origins)];
  cfg.allow = [...new Set(cfg.allow)];
  const token = cfg.token || crypto.randomBytes(16).toString('hex');
  const root = path.resolve(cfg.root);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(root, 0o700); } catch { /* best effort on exotic filesystems */ }
  const probe = makeToolProbe();
  const runs = new Map();
  const lastUsed = new Map();
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      try { lastUsed.set(e.name, fs.statSync(path.join(root, e.name)).mtimeMs); } catch { /* vanished */ }
    }
  } catch { /* empty root */ }
  let gpuCache = null;
  const uploadLimit = Math.floor(cfg.maxUploadMb * 1024 * 1024);
  const loopback = !cfg.host || cfg.host === '127.0.0.1' || cfg.host === 'localhost' || cfg.host === '::1';
  let port = cfg.port;
  const touch = (id) => lastUsed.set(id, Date.now());
  const jobDir = (id) => path.join(root, id);
  const jobExists = (id) => ID_RE.test(id) && fs.existsSync(jobDir(id));
  const hostOk = (host) => {
    if (!loopback) return true;
    if (!host) return false;
    const h = String(host).toLowerCase();
    if (cfg.allowHosts.some((a) => h === a || h === `${a}:${port}` || h === `${a}:${cfg.port}`)) return true;
    const m = h.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    if (!m) return false;
    const name = m[1];
    const p = m[2];
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(name)) return false;
    return p === undefined || Number(p) === port;
  };
  const activeCount = () => [...runs.values()].filter((r) => r.state === 'running').length;
  const killRun = (r) => {
    if (!r || r.state !== 'running') return;
    r.killed = true;
    try { r.child.kill('SIGTERM'); } catch { /* gone */ }
    const t = setTimeout(() => { try { r.child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
    t.unref?.();
  };
  const killJobRuns = (id) => { for (const r of runs.values()) if (r.job === id) killRun(r); };
  const health = async () => {
    const tools = {};
    for (const name of cfg.allow) {
      const found = await probe(name);
      if (!found) continue;
      const entry = { path: found.path, version: found.version };
      if (name === 'gmx' || name === 'gmx_mpi') {
        entry.build = parseGmxVersion(found.text);
        entry.recommendation = pickGmxGpuMode(gpuCache || [], entry.build);
      }
      tools[name] = entry;
    }
    if (!gpuCache) gpuCache = await detectGpus();
    for (const name of ['gmx', 'gmx_mpi']) if (tools[name]) tools[name].recommendation = pickGmxGpuMode(gpuCache, tools[name].build);
    return { name: 'nayancode-bridge', version: VERSION, tools, gpus: gpuCache, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1e9 * 10) / 10, platform: process.platform, runsActive: activeCount() };
  };
  const handler = async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (!hostOk(req.headers.host)) return fail(res, 403, 'Host header is not allowed');
      if (origin && !cfg.origins.includes(origin)) return fail(res, 403, 'Origin is not allowed');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin || '',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        });
        return res.end();
      }
      const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const a = Buffer.from(given), b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 401, 'Missing or wrong token');
      const url = new URL(req.url || '/', 'http://bridge.local');
      const seg = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
      const method = req.method || 'GET';
      const p = url.pathname;
      if (method === 'GET' && p === '/v1/health') return json(res, 200, await health());
      if (method === 'POST' && p === '/v1/jobs') {
        const id = crypto.randomBytes(6).toString('hex');
        fs.mkdirSync(jobDir(id), { recursive: true, mode: 0o700 });
        touch(id);
        return json(res, 200, { id });
      }
      if (seg[0] !== 'v1' || seg[1] !== 'jobs' || !seg[2]) return fail(res, 404, 'Unknown endpoint');
      const id = seg[2];
      if (!jobExists(id)) return fail(res, 404, 'Unknown job');
      touch(id);
      const dir = jobDir(id);
      if (method === 'PUT' && seg[3] === 'files' && !seg[4]) return fail(res, 400, 'Invalid file name');
      if (method === 'PUT' && seg[3] === 'files' && seg[4]) {
        const name = seg[4];
        if (!NAME_RE.test(name)) return fail(res, 400, 'Invalid file name');
        if (Number(req.headers['content-length'] || 0) > uploadLimit) return fail(res, 413, `Upload exceeds ${cfg.maxUploadMb} MB`);
        const tmp = path.join(dir, `.upload-${crypto.randomBytes(6).toString('hex')}.part`);
        const ws = fs.createWriteStream(tmp, { mode: 0o600 });
        let size = 0, rejected = false;
        req.on('data', (chunk) => {
          if (rejected) return;
          size += chunk.length;
          if (size > uploadLimit) {
            rejected = true; ws.destroy();
            fsp.unlink(tmp).catch(() => {});
            fail(res, 413, `Upload exceeds ${cfg.maxUploadMb} MB`);
            return;
          }
          ws.write(chunk);
        });
        req.on('end', () => {
          if (rejected) return;
          ws.end(() => fsp.rename(tmp, path.join(dir, name)).then(() => json(res, 200, { name, bytes: size })).catch((e) => fail(res, 500, e.message)));
        });
        req.on('error', () => { if (!rejected) { rejected = true; ws.destroy(); fsp.unlink(tmp).catch(() => {}); fail(res, 400, 'Upload failed'); } });
        return;
      }
      if (method === 'GET' && seg[3] === 'files' && !seg[4]) {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        const files = [];
        for (const e of entries) {
          if (!e.isFile() || e.name.startsWith('.')) continue;
          const st = await fsp.stat(path.join(dir, e.name));
          files.push({ name: e.name, bytes: st.size, modified: st.mtimeMs });
        }
        return json(res, 200, files);
      }
      if (method === 'GET' && seg[3] === 'files' && seg[4]) {
        const name = seg[4];
        const full = path.join(dir, name);
        if (!NAME_RE.test(name) || !fs.existsSync(full)) return fail(res, 404, 'File not found');
        const st = await fsp.stat(full);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
        return fs.createReadStream(full).pipe(res);
      }
      if (method === 'DELETE' && seg[3] === undefined) {
        killJobRuns(id);
        await fsp.rm(dir, { recursive: true, force: true });
        lastUsed.delete(id);
        return json(res, 200, { removed: id });
      }
      if (method === 'POST' && seg[3] === 'run' && seg[4] === undefined) {
        const body = await readJsonBody(req);
        if (body.error) return fail(res, body.status, body.error);
        const { tool, args, stdin, timeoutSec } = body.value || {};
        if (typeof tool !== 'string' || !cfg.allow.includes(tool)) return fail(res, 403, 'Tool is not allow-listed');
        const toolPath = whichTool(tool);
        if (!toolPath) return fail(res, 404, 'Tool not found on PATH');
        if (!Array.isArray(args) || args.some((x) => typeof x !== 'string') || args.join('').length >= 20000) return fail(res, 400, 'args must be a short array of strings');
        if (args.some((x) => x.includes('\0'))) return fail(res, 400, 'args must not contain NUL');
        if (args.some((x) => !safeArg(x, dir))) return fail(res, 400, 'An argument escapes the job directory');
        if (stdin !== undefined && typeof stdin !== 'string') return fail(res, 400, 'stdin must be a string');
        if (activeCount() >= MAX_ACTIVE_RUNS) return fail(res, 429, 'Two runs are already active; wait for one to finish');
        const cap = Math.min(86400, Math.max(1, Number(timeoutSec) || 21600));
        const runId = crypto.randomBytes(6).toString('hex');
        const runsDir = path.join(dir, '.runs');
        fs.mkdirSync(runsDir, { recursive: true, mode: 0o700 });
        const logPath = path.join(runsDir, `${runId}.log`);
        const log = fs.createWriteStream(logPath, { flags: 'a', mode: 0o600 });
        const r = { runId, job: id, tool, args, state: 'running', code: null, signal: null, startedAt: Date.now(), endedAt: null, logPath, child: null, killed: false, timedOut: false };
        try {
          r.child = spawn(toolPath, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: minimalEnv() });
        } catch (e) {
          r.state = 'error'; r.endedAt = Date.now(); log.end(String(e.message));
          runs.set(`${id}/${runId}`, r);
          return fail(res, 500, 'Could not start the tool');
        }
        runs.set(`${id}/${runId}`, r);
        r.child.stdout.on('data', (b) => log.write(b));
        r.child.stderr.on('data', (b) => log.write(b));
        r.child.on('error', (e) => { r.state = 'error'; r.endedAt = Date.now(); log.end(`\n${e.message}`); });
        r.child.on('close', (code, signal) => {
          r.code = code; r.signal = signal; r.endedAt = Date.now();
          r.state = r.killed ? 'killed' : r.timedOut ? 'timeout' : 'exited';
          log.end();
        });
        if (typeof stdin === 'string') r.child.stdin.end(stdin); else r.child.stdin.end();
        const timer = setTimeout(() => { r.timedOut = true; try { r.child.kill('SIGTERM'); } catch { /* gone */ } const t = setTimeout(() => { try { r.child.kill('SIGKILL'); } catch { /* gone */ } }, 10000); t.unref?.(); }, cap * 1000);
        timer.unref?.();
        return json(res, 200, { runId });
      }
      if (method === 'GET' && seg[3] === 'runs' && seg[4] && seg[5] === undefined) {
        const r = runs.get(`${id}/${seg[4]}`);
        if (!r) return fail(res, 404, 'Unknown run');
        return json(res, 200, { state: r.state, code: r.code, signal: r.signal, startedAt: r.startedAt, endedAt: r.endedAt, tool: r.tool, args: r.args });
      }
      if (method === 'GET' && seg[3] === 'runs' && seg[4] && seg[5] === 'log') {
        const r = runs.get(`${id}/${seg[4]}`);
        if (!r) return fail(res, 404, 'Unknown run');
        let size = 0;
        try { size = (await fsp.stat(r.logPath)).size; } catch { /* not written yet */ }
        const fromRaw = Number(url.searchParams.get('from') || 0);
        const from = Number.isFinite(fromRaw) && fromRaw > 0 ? Math.floor(fromRaw) : 0;
        const start = Math.max(from, Math.max(0, size - MAX_LOG_BYTES));
        let text = '';
        if (start < size) { const fh = await fsp.open(r.logPath, 'r'); const buf = Buffer.alloc(size - start); await fh.read(buf, 0, buf.length, start); await fh.close(); text = buf.toString('utf8'); }
        return json(res, 200, { text, next: size });
      }
      if (method === 'DELETE' && seg[3] === 'runs' && seg[4] && seg[5] === undefined) {
        const r = runs.get(`${id}/${seg[4]}`);
        if (!r) return fail(res, 404, 'Unknown run');
        killRun(r);
        return json(res, 200, { killed: r.runId });
      }
      return fail(res, 404, 'Unknown endpoint');
    } catch (e) {
      if (!res.headersSent) return fail(res, 500, e instanceof Error ? e.message : 'Bridge error');
      try { res.end(); } catch { /* gone */ }
    }
  };
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, cfg.host, resolve); });
  port = server.address().port;
  const housekeeping = setInterval(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const [id, at] of lastUsed) if (at < cutoff) { killJobRuns(id); fsp.rm(jobDir(id), { recursive: true, force: true }).catch(() => {}); lastUsed.delete(id); }
  }, 3600 * 1000);
  housekeeping.unref?.();
  const close = async () => {
    clearInterval(housekeeping);
    for (const r of runs.values()) { try { r.child?.kill('SIGKILL'); } catch { /* gone */ } }
    await new Promise((resolve) => server.close(resolve));
  };
  if (!cfg.silent) {
    const found = cfg.allow.filter((n) => whichTool(n));
    console.log(`Nayancode Bridge ${VERSION}`);
    console.log(`URL: http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${port}`);
    console.log(`Token: ${token}`);
    console.log(`Allowed origins: ${cfg.origins.join(', ')}`);
    if (cfg.allowHosts.length) console.log(`Extra Host names: ${cfg.allowHosts.join(', ')}`);
    console.log(`Allowed tools found on PATH: ${found.length ? found.join(', ') : 'none'}`);
    if (cfg.host === '0.0.0.0') console.log('WARNING: listening on every interface. Prefer an SSH tunnel; anyone who can reach this port could try to use your token.');
    console.log('Keep this token private. Stop with Ctrl+C.');
  }
  return { port, token, url: `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${port}`, close };
}
async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help) {
    console.log('Usage: node nayancode-bridge.mjs [--port 8787] [--host 127.0.0.1] [--origin URL ...] [--allow tool1,tool2] [--root DIR] [--max-upload-mb 500] [--allow-host NAME ...]');
    return;
  }
  const bridge = await startServer(opts);
  const stop = async () => { await bridge.close(); process.exit(0); };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main().catch((e) => { console.error(e); process.exit(1); });

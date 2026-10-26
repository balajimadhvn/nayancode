# Nayancode Bridge

A small, open-source helper that lets the Nayancode Workbench use native tools **already installed on your own
computer** — GROMACS, samtools, bcftools, minimap2, bwa/bwa-mem2, STAR, fastp, seqtk and `nvidia-smi`. Nothing is sent
to Solagene. The Bridge is one file of plain Node.js with no dependencies and an MIT licence.

It is for research use. It does not make clinical or diagnostic claims.

## Why a separate program?

Browsers cannot start a local program or read arbitrary files from your disk. The Bridge is the small, explicit bridge
between the page in your browser and programs you installed yourself. You start it, it prints a one-time token, and you
paste that token into the Workbench. The page can then create a job folder, upload inputs, run allow-listed tools and
download outputs. Everything stays on your machine.

## Start it

Requirements: Node.js 18 or newer. No `npm install` is needed.

Download `nayancode-bridge.mjs`, open a terminal in that folder, and run:

### Linux and macOS

```bash
node ./nayancode-bridge.mjs
```

### Windows (PowerShell)

```powershell
node .\nayancode-bridge.mjs
```

The Bridge prints its URL (`http://127.0.0.1:8787` by default), a random 128-bit token, the allowed origins and the
allow-listed tools it found on your `PATH`. Paste the URL and token into **Nayancode Bridge** on the Workbench overview.
Keep the terminal open. Press Ctrl+C to stop it.

Useful options:

```text
--port 8787            port to listen on (0 chooses a free port)
--host 127.0.0.1       listen address; the default is loopback only
--origin URL           allowed website origin; repeatable
--allow a,b            allow-list of program names; default includes gmx, samtools, bwa, fastp ...
--root DIR             job folder (default: your temporary directory/nayancode-bridge)
--max-upload-mb 500    per-file upload limit
--allow-host NAME      extra Host header name for a private tunnel; repeatable
```

`--host 0.0.0.0` is allowed for advanced users but prints a warning. Do not expose the Bridge directly to the internet.

## Security model

Every request must pass these checks, in order:

1. **Host header** is `127.0.0.1:<port>` or `localhost:<port>` (or an explicitly allowed tunnel hostname). This stops
   DNS-rebinding attacks.
2. **Origin header**, when present, is in the allow-list. CORS never uses `*`.
3. **`OPTIONS` preflight** is answered without a token so the browser can ask permission, including
   `Access-Control-Allow-Private-Network: true` for Chrome's local-network checks.
4. **`Authorization: Bearer <token>`** matches the random token, compared with `crypto.timingSafeEqual`.

The Bridge also:

- runs only allow-listed program names resolved through `PATH`; it never accepts a path from the page;
- uses `spawn` with an argument array and `shell: false` (no `bash`, `sh`, `python`, `node` or `rm`), so shell
  metacharacters are literal text;
- rejects arguments that resolve outside the job folder;
- streams uploads to disk with a size cap;
- keeps logs in a hidden folder, truncates reads to the last 5 MB, and limits runs to 2 at once and 6 hours by default;
- passes only `PATH`, `HOME`, `LANG`, `LD_LIBRARY_PATH`, `GMXLIB`, `GMXDATA`, `CUDA_VISIBLE_DEVICES` and
  `OMP_NUM_THREADS` to child processes;
- creates its root folder with mode 0700 and deletes idle jobs after 24 hours.

The token is kept in browser `sessionStorage` only for this tab; the URL is stored in `localStorage`. **Never paste a
token into a page you do not trust**, and stop the Bridge when you are finished.

## Using a remote machine you control

You can run the Bridge on a lab workstation, a university node or a cloud VM. Do **not** expose it publicly. Use a
private path:

### SSH tunnel (recommended)

On your own computer:

```bash
ssh -L 8787:127.0.0.1:8787 user@server
```

Then start the Bridge on the server and connect the page to `http://127.0.0.1:8787`. The token is still required.

### Private tunnel / cloud notebook

A private tunnel you create yourself (for example Cloudflare Tunnel) can forward the loopback port. Start the Bridge
with the website origin and the tunnel hostname explicitly allowed:

```bash
node nayancode-bridge.mjs \
  --origin https://solagene.com \
  --allow-host your-tunnel.example
```

The token is still required. An unauthenticated public URL is not a supported setup.

## GPUs: any vendor, any operating system

The Bridge does not assume NVIDIA. It builds a hardware report from whichever vendor tools are installed and merges
them by device name:

- **NVIDIA:** `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits` → CUDA.
- **AMD:** `rocm-smi --showproductname --showmeminfo vram --json` or `rocminfo` → ROCm; `clinfo` → OpenCL.
- **Intel:** `clinfo` and `vulkaninfo --summary` → OpenCL/Vulkan; Arc and integrated GPUs are distinguished.
- **Apple:** `system_profiler SPDisplaysDataType -detailLevel mini` → Metal; GROMACS itself uses the CPU on Apple
  Silicon.
- **Windows:** PowerShell `Get-CimInstance Win32_VideoController` → Direct3D 12; `clinfo`/`vulkaninfo` add OpenCL and
  Vulkan when installed.
- **Linux fallback:** `lspci` names VGA/3D/Display controllers even when no compute runtime is installed.

For GROMACS the Bridge parses `gmx --version` (`GROMACS version`, `Precision`, `GPU support`, `SIMD instructions`,
`MPI library`) and recommends `mdrun` flags only when the build's backend matches a device that is present:

| Build | Device present | Recommendation |
|---|---|---|
| CUDA | NVIDIA | `-nb gpu -pme gpu -bonded gpu` |
| HIP | AMD | `-nb gpu -pme gpu` |
| SYCL | Intel, AMD or NVIDIA | `-nb gpu` (nonbonded only) |
| OpenCL | AMD or Intel | `-nb gpu` (slower; verify performance) |
| CUDA/HIP | no matching device | CPU, with a note on the build that would match |
| disabled/unknown | any | CPU |

A mismatch never silently claims GPU support. The health response includes the detected build and the recommendation
so the Workbench can show the real reason.

## Windows and macOS notes

- **Windows:** use PowerShell. Tools installed in WSL2 are reachable only if the Bridge itself runs inside WSL2; the
  forwarded URL is still `http://127.0.0.1:8787`. NVIDIA GPUs work in WSL2 with the normal Windows driver.
- **macOS:** `node` is enough. Apple Silicon runs native tools on the CPU; do not expect CUDA or a Metal GROMACS build.
- **Safari:** may block access to local addresses from a secure page. Chrome, Edge and Firefox are recommended.

## Limits and honest wording

The Bridge is a research tool. Browser memory, laptop speed and each native program's own limits still apply. It does
not turn a laptop into a cluster, and it cannot run a program you have not installed. Outputs are research-grade and
not clinical.

Licence: MIT. The source is this one file; read it before you run it.

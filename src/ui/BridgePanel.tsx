import { useEffect, useMemo, useState } from 'react';
import { Bridge, BridgeError, useBridge, type BridgeHealth } from '@/compute/bridge';
import { Callout, Card, Field, Tabs, toast } from '@/ui/kit';

const URL_KEY = 'nc-bridge-url';
const TOKEN_KEY = 'nc-bridge-token';

function readStored(key: string, storage: 'local' | 'session'): string {
  try { return (storage === 'local' ? localStorage : sessionStorage).getItem(key) ?? ''; } catch { return ''; }
}
function store(key: string, value: string, storage: 'local' | 'session') {
  try { (storage === 'local' ? localStorage : sessionStorage).setItem(key, value); } catch { /* private mode */ }
}
function forget(key: string) { try { sessionStorage.removeItem(key); } catch { /* private mode */ } }

type HelpTab = 'this' | 'ssh' | 'cloud';
function detectOs(): 'windows' | 'mac' | 'linux' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}
const osLabel = { windows: 'Windows', mac: 'macOS', linux: 'Linux', other: 'your system' } as const;

export default function BridgePanel() {
  const connected = useBridge((s) => s.connected);
  const health = useBridge((s) => s.health);
  const setConnected = useBridge((s) => s.setConnected);
  const disconnect = useBridge((s) => s.disconnect);
  const [url, setUrl] = useState(() => readStored(URL_KEY, 'local') || 'http://127.0.0.1:8787');
  const [token, setToken] = useState(() => readStored(TOKEN_KEY, 'session'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState<HelpTab>('this');
  const [showHelp, setShowHelp] = useState(false);
  const os = useMemo(detectOs, []);

  useEffect(() => { setUrl(readStored(URL_KEY, 'local') || 'http://127.0.0.1:8787'); }, []);

  const connect = async () => {
    setBusy(true); setError('');
    try {
      const client = new Bridge(url, token);
      const h = await client.health();
      setConnected(client, h);
      store(URL_KEY, client.baseUrl, 'local');
      store(TOKEN_KEY, client.token, 'session');
      toast('Bridge connected');
    } catch (e) {
      setError(e instanceof BridgeError ? e.message : e instanceof Error ? e.message : 'Could not connect to the Bridge.');
    } finally { setBusy(false); }
  };

  const stop = () => {
    disconnect(); forget(TOKEN_KEY); setToken(''); setError('');
    toast('Bridge disconnected; the token was removed from this tab');
  };

  return (
    <Card title="Nayancode Bridge" sub="run installed tools on your own computer"
      actions={connected ? <span className="row" style={{ gap: 8 }}><span className="badge live" data-testid="bridge-connected"><span className="dot" />Connected</span><button className="btn sm" onClick={stop}>Disconnect</button></span> : undefined}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>
          Runs on your own computer through the Nayancode Bridge, a small open-source program you start yourself. Nothing
          is sent to Solagene. It lets this page run tools that are already installed on your machine, such as GROMACS,
          samtools or bwa; the token proves the page is allowed to talk to your copy of the Bridge.
        </p>
        {!connected && (
          <div className="cols-2" style={{ alignItems: 'end' }}>
            <Field label="Bridge URL"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" data-testid="bridge-url" /></Field>
            <Field label="Token (printed when the Bridge starts)"><input className="input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="128-bit hex token" data-testid="bridge-token" /></Field>
          </div>
        )}
        {!connected && <div className="row"><button className="btn primary" disabled={busy || !url.trim() || !token.trim()} onClick={() => void connect()} data-testid="bridge-connect">{busy ? 'Connecting…' : 'Connect'}</button></div>}
        {error && <Callout kind="err"><span data-testid="bridge-error">{error}</span></Callout>}
        {connected && health && <Health health={health} />}
        <details open={showHelp} onToggle={(e) => setShowHelp((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>How to start the Bridge</summary>
          <div style={{ marginTop: 10 }}>
            <Tabs value={help} onChange={setHelp} items={[{ id: 'this', label: 'This computer' }, { id: 'ssh', label: 'Another computer over SSH' }, { id: 'cloud', label: 'Cloud notebook (Kaggle/Colab)' }]} />
            {help === 'this' && <HelpThis os={os} />}
            {help === 'ssh' && <HelpSsh />}
            {help === 'cloud' && <HelpCloud />}
            <div style={{ marginTop: 10, display: 'grid', gap: 6, fontSize: 12.5, color: 'var(--text-dim)' }}>
              <span>Download <a href="/bridge/nayancode-bridge.mjs" download style={{ color: 'var(--accent)', textDecoration: 'underline' }}>nayancode-bridge.mjs</a> (plain Node, no dependencies), or run it from the Nayancode source tree.</span>
              <span>The Bridge listens on 127.0.0.1 only by default, checks the page origin and Host header, requires the random token, runs only allow-listed programs through PATH with no shell, confines file arguments to the job folder, and limits uploads, run time and concurrency. It never runs bash, sh, python, node or rm.</span>
              <span>Safari may block access to local addresses from a secure page. Chrome, Edge and Firefox are recommended.</span>
              <span>Results are research-grade and not clinical. Only connect a Bridge you started; never paste a token into a page you do not trust.</span>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}

function Health({ health }: { health: BridgeHealth }) {
  const tools = Object.entries(health.tools);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="bridge-health">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <Mini k="CPU" v={`${health.cpus} threads`} />
        <Mini k="Memory" v={`${health.memoryGb} GB`} />
        <Mini k="Platform" v={health.platform} />
        <Mini k="Active runs" v={String(health.runsActive)} />
      </div>
      <div style={{ fontSize: 13 }}>
        <strong>Tools found</strong>
        {tools.length === 0 ? <div className="faint">None of the allow-listed tools were found on PATH. Install one, or start the Bridge with a wider --allow list.</div> : (
          <ul style={{ margin: '5px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }} data-testid="bridge-tools">
            {tools.map(([name, t]) => <li key={name}><span className="mono">{name}</span> · {t.version}{t.build ? ` · GPU ${t.build.gpu}` : ''}{t.recommendation ? ` · mdrun ${t.recommendation.mode}${t.recommendation.flags.length ? ` (${t.recommendation.flags.join(' ')})` : ''}` : ''}</li>)}
          </ul>
        )}
      </div>
      <div style={{ fontSize: 13 }}>
        <strong>Graphics hardware</strong>
        {health.gpus.length === 0 ? <div className="faint">No vendor tool reported a GPU. Native programs will use the CPU; that is normal on servers and virtual machines.</div> : (
          <ul style={{ margin: '5px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
            {health.gpus.map((g) => <li key={g.name}>{g.name} · {g.vendor} {g.kind}{g.memoryMb ? ` · ${g.memoryMb} MiB` : ''}{g.driver ? ` · driver ${g.driver}` : ''}{g.backends.length ? ` · ${g.backends.join(', ')}` : ''}</li>)}
          </ul>
        )}
      </div>
      <div className="faint" style={{ fontSize: 11.5 }}>Bridge {health.version}. Vendor tools are detected on this machine; the Workbench never assumes NVIDIA.</div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div className="card stat"><div className="v" style={{ fontSize: 16 }}>{v}</div><div className="l">{k}</div></div>;
}

function HelpThis({ os }: { os: ReturnType<typeof detectOs> }) {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12.5 }}>
      <p style={{ margin: 0 }}>Detected {osLabel[os]}. Install Node 18 or newer, then in a terminal:</p>
      <code className="mono" style={{ padding: 8, background: 'var(--bg-2)', borderRadius: 6, overflowX: 'auto' }}>
        {os === 'windows' ? 'node .\\nayancode-bridge.mjs' : 'node ./nayancode-bridge.mjs'}
      </code>
      <span className="faint">Copy the URL and the one-time token it prints into the fields above. Keep the terminal open; Ctrl+C stops the Bridge.</span>
      {os === 'windows' && <span className="faint">Use PowerShell. Tools installed inside WSL2 are only reachable if you start the Bridge inside WSL2; NVIDIA GPUs work there with the normal Windows driver.</span>}
      {os === 'mac' && <span className="faint">On Apple Silicon, GROMACS and other native tools run on the CPU. That is a tool limitation, not a Bridge limitation.</span>}
    </div>
  );
}

function HelpSsh() {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12.5 }}>
      <p style={{ margin: 0 }}>Run the Bridge on a machine you control and forward its loopback port. On your own computer:</p>
      <code className="mono" style={{ padding: 8, background: 'var(--bg-2)', borderRadius: 6, overflowX: 'auto' }}>ssh -L 8787:127.0.0.1:8787 user@server</code>
      <p style={{ margin: 0 }}>Start <span className="mono">node nayancode-bridge.mjs</span> on the server, then connect this page to <span className="mono">http://127.0.0.1:8787</span> and paste the token. Do not expose the Bridge directly to the internet.</p>
    </div>
  );
}

function HelpCloud() {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12.5 }}>
      <p style={{ margin: 0 }}>On a Kaggle or Colab notebook, upload and start the Bridge, then use a private tunnel you create (for example Cloudflare Tunnel) to reach its loopback port. Add the tunnel hostname explicitly when you start it:</p>
      <code className="mono" style={{ padding: 8, background: 'var(--bg-2)', borderRadius: 6, overflowX: 'auto' }}>node nayancode-bridge.mjs --origin https://your-site.example --allow-host your-tunnel.example</code>
      <p style={{ margin: 0 }}>The token is still required. A public URL without a private tunnel is not a supported setup.</p>
    </div>
  );
}

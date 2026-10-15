import { AnimatePresence, motion } from 'motion/react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NavLink } from '@/site/Link';
import { BRAND } from '@/core/brand';
import { useJobs, cancelJob } from '@/core/jobs';
import { fmtBytes, useNet } from '@/core/net';
import { buildMethods, useProvenance } from '@/core/provenance';
import { STUDIOS } from '@/core/studios';
import { useUi } from '@/core/ui-store';
import { ErrorBoundary } from './ErrorBoundary';
import { Icon, StudioIcon } from './Icons';
import { downloadText, toast, ToastHost } from './kit';


function Sidebar() {
  const open = useUi((s) => s.sidebar);
  const { set } = useUi();
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <NavLink to="/" className="brand" onClick={() => set({ sidebar: false })} title={`${BRAND.name} home`}><img src={`${import.meta.env.BASE_URL}brand/vivofold-mark.svg`} width={26} height={27} alt="" /><span className="brand-t"><b>{BRAND.name}</b><small>Nayancode Workbench</small></span></NavLink>
      <NavLink to={BRAND.workbenchHome} end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => set({ sidebar: false })}>
        {({ isActive }) => <>{isActive && <motion.i layoutId="nav-bg" className="nav-bg" />}<Icon.Home className="ico" /> Overview</>}
      </NavLink>
      <NavLink to="/report" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => set({ sidebar: false })}>{({ isActive }) => <>{isActive && <motion.i layoutId="nav-bg" className="nav-bg" />}<Icon.Doc className="ico" /> Report</>}</NavLink>
      <NavLink to="/atlas" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => set({ sidebar: false })}>{({ isActive }) => <>{isActive && <motion.i layoutId="nav-bg" className="nav-bg" />}<Icon.Search className="ico" /> Atlas</>}</NavLink>
      <NavLink to="/import" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => set({ sidebar: false })}>{({ isActive }) => <>{isActive && <motion.i layoutId="nav-bg" className="nav-bg" />}<Icon.Upload className="ico" /> Import</>}</NavLink>
      <div className="nav-section">Studios</div>
      {STUDIOS.map((s) => {
        const I = StudioIcon[s.id];
        return (
          <NavLink key={s.id} to={s.path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ ['--h' as string]: s.accent }} onClick={() => set({ sidebar: false })}>
            {({ isActive }) => <>{isActive && <motion.i layoutId="nav-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}<I className="ico" />{s.short}{s.status !== 'live' && <span className="tag">{s.milestone}</span>}</>}
          </NavLink>
        );
      })}
      <div className="sidebar-foot">
        <div className="row" style={{ gap: 6 }}><Icon.Lock width={13} height={13} /> Local-first. Files stay on this device.</div>
        <div>v{BRAND.version} · research use only · <NavLink to="/licenses" style={{ textDecoration: 'underline' }}>licences</NavLink></div>
      </div>
    </aside>
  );
}

function Topbar() {
  const loc = useLocation();
  const { set, theme, toggleTheme } = useUi();
  const net = useNet();
  const running = useJobs((s) => s.jobs.filter((j) => j.status === 'running').length);
  const title = loc.pathname === '/licenses' ? 'Licences' : loc.pathname === '/report' ? 'Report' : loc.pathname === '/atlas' ? 'Atlas' : loc.pathname === '/import' ? 'Import' : STUDIOS.find((s) => loc.pathname.startsWith(s.path))?.name ?? 'Overview';
  const outbound = net.requests > 0;
  return (
    <header className="topbar">
      <button className="btn ghost icon menu-btn" onClick={() => set({ sidebar: !useUi.getState().sidebar })} aria-label="Menu"><Icon.Menu /></button>
      <div className="title">{title}</div>
      <div className="spacer" />
      <button className="search-btn hide-sm" onClick={() => set({ palette: true })}><Icon.Search width={15} height={15} /><span className="lbl">Search studios, actions…</span><span className="kbd">Ctrl K</span></button>
      <button className="btn ghost icon" onClick={() => set({ palette: true })} aria-label="Search" style={{ display: 'none' }} />
      <button className={`netbadge ${outbound ? 'out' : ''}`} onClick={() => set({ methods: true })} title="Network transparency: bytes of your data sent to external services this session">
        <Icon.Shield width={14} height={14} />{outbound ? `${fmtBytes(net.sentBytes)} sent · ${net.requests} req` : '0 B uploaded'}
      </button>
      <button className="btn ghost icon" onClick={() => set({ jobs: true })} aria-label="Jobs" title="Jobs" style={{ position: 'relative' }}>
        <Icon.Jobs />{running > 0 && <span className="spinner" style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderWidth: 1.5 }} />}
      </button>
      <button className="btn ghost icon" onClick={() => set({ methods: true })} aria-label="Methods and provenance" title="Methods & provenance"><Icon.Doc /></button>
      <button className="btn ghost icon" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}</button>
    </header>
  );
}

function Drawer({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: React.ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); if (open) window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && <>
        <motion.div className="overlay" style={{ zIndex: 85, placeItems: 'stretch' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
        <motion.aside className="drawer" role="dialog" aria-label={title} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          <header>{title}<button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon.X /></button></header>
          <div className="body">{children}</div>
        </motion.aside>
      </>}
    </AnimatePresence>
  );
}

function JobsDrawer() {
  const { jobs: open, set } = useUi();
  const jobs = useJobs((s) => s.jobs);
  const clear = useJobs((s) => s.clear);
  return (
    <Drawer open={open} onClose={() => set({ jobs: false })} title="Job Center">
      {jobs.length === 0 && <div className="faint">No jobs yet. Run an analysis in any studio and it appears here.</div>}
      {jobs.map((j) => (
        <div key={j.id} className="card card-pad" style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: 13 }}>{j.label}</b>
            <span className={`badge ${j.status === 'done' ? 'live' : j.status === 'running' ? 'building' : ''}`}>{j.status}</span>
          </div>
          {j.status === 'running' && <><div className="progress"><i style={{ width: `${j.progress * 100}%` }} /></div><div className="row" style={{ justifyContent: 'space-between' }}><span className="faint" style={{ fontSize: 12 }}>{j.note}</span><button className="btn sm" onClick={() => cancelJob(j.id)}>Cancel</button></div></>}
          {j.status === 'failed' && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{j.error}</div>}
          {j.endedAt && <div className="faint mono" style={{ fontSize: 11 }}>{((j.endedAt - j.startedAt) / 1000).toFixed(2)} s</div>}
        </div>
      ))}
      {jobs.length > 0 && <button className="btn" onClick={clear}>Clear finished</button>}
    </Drawer>
  );
}

function MethodsDrawer() {
  const { methods: open, set } = useUi();
  const records = useProvenance((s) => s.records);
  const clear = useProvenance((s) => s.clear);
  const net = useNet();
  const { text, refs } = useMemo(() => buildMethods(records), [records]);
  const full = text ? `${text}\n\nReferences\n${refs.join('\n')}` : '';
  return (
    <Drawer open={open} onClose={() => set({ methods: false })} title="Methods & provenance">
      <div className="callout"><Icon.Shield style={{ flex: 'none', color: 'var(--accent-3)' }} /><div><b style={{ color: 'var(--text)' }}>Network transparency.</b> This session: {net.requests} external request{net.requests === 1 ? '' : 's'}, {fmtBytes(net.sentBytes)} of request payload sent.
        {Object.keys(net.hosts).length > 0 && <div className="mono" style={{ marginTop: 6 }}>{Object.entries(net.hosts).map(([h, n]) => `${h} ×${n}`).join(' · ')}</div>}</div></div>
      <div className="row"><b>Auto-generated Methods</b><span className="faint">· from {records.length} recorded analyses</span></div>
      {text ? (
        <>
          <div className="seqbox" style={{ fontFamily: 'var(--font)', fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 'none' }}>{text}{'\n\n'}{refs.join('\n')}</div>
          <div className="row"><button className="btn primary" onClick={() => { void navigator.clipboard.writeText(full); toast('Methods copied'); }}>Copy</button>
            <button className="btn" onClick={() => downloadText('methods.txt', full)}>Download .txt</button>
            <button className="btn" onClick={() => downloadText('provenance.json', JSON.stringify(records, null, 2), 'application/json')}>Provenance JSON</button>
            <button className="btn ghost" onClick={clear}>Clear log</button></div>
        </>
      ) : <div className="faint">Run an analysis. Every result records tool, version, parameters and input hash here, and the Methods paragraph with citations writes itself.</div>}
      {records.length > 0 && <details><summary className="dim" style={{ cursor: 'pointer' }}>Provenance log</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{[...records].reverse().map((r) => (
          <div key={r.id} className="callout" style={{ display: 'grid', gap: 3 }}><b style={{ color: 'var(--text)' }}>{r.toolName} <span className="faint">v{r.toolVersion}</span></b>
            <span className="mono" style={{ fontSize: 11 }}>{r.startedAt} · {r.durationMs} ms</span>
            <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(r.params)}</span>
            {r.inputs.map((i) => <span key={i.name} className="mono faint" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{i.name}: sha256 {i.sha256.slice(0, 16)}… ({i.bytes} B)</span>)}</div>))}</div></details>}
    </Drawer>
  );
}

function Palette() {
  const { palette: open, set, toggleTheme } = useUi();
  const nav = useNavigate();
  const [q, setQ] = useState(''); const [sel, setSel] = useState(0);
  const items = useMemo(() => [
    ...STUDIOS.map((s) => ({ id: s.id, label: `Open ${s.name}`, grp: s.status === 'live' ? 'Studio' : `Studio · ${s.milestone}`, run: () => nav(s.path) })),
    { id: 'home', label: 'Go to overview', grp: 'Navigate', run: () => nav('/workbench') },
    { id: 'landing', label: 'Go to company home page', grp: 'Company', run: () => nav('/') },
    { id: 'internships', label: 'Internships', grp: 'Company', run: () => nav('/internships') },
    { id: 'courses', label: 'Courses', grp: 'Company', run: () => nav('/courses') },
    { id: 'research', label: 'Research & algorithms', grp: 'Company', run: () => nav('/research') },
    { id: 'platform', label: 'About the Workbench', grp: 'Company', run: () => nav('/platform') },
    { id: 'services', label: 'Analysis services', grp: 'Company', run: () => nav('/services') },
    { id: 'tools', label: 'Free tools', grp: 'Company', run: () => nav('/tools') },
    { id: 'contact', label: 'Contact us', grp: 'Company', run: () => nav('/contact') },
    { id: 'import', label: 'Import nf-core results', grp: 'Navigate', run: () => nav('/import') },
    { id: 'atlas', label: 'Open Atlas (gene knowledge cards)', grp: 'Navigate', run: () => nav('/atlas') },
    { id: 'report', label: 'Open the report builder', grp: 'Navigate', run: () => nav('/report') },
    { id: 'licenses', label: 'Open-source licences & data sources', grp: 'Navigate', run: () => nav('/licenses') },
    { id: 'theme', label: 'Toggle light / dark theme', grp: 'Action', run: toggleTheme },
    { id: 'methods', label: 'Show methods & provenance', grp: 'Action', run: () => set({ methods: true }) },
    { id: 'jobs', label: 'Show job center', grp: 'Action', run: () => set({ jobs: true }) },
  ], [nav, set, toggleTheme]);
  const list = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { setSel(0); }, [q, open]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); set({ palette: !useUi.getState().palette }); setQ(''); } if (e.key === 'Escape') set({ palette: false }); };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [set]);
  const go = (i: number) => { list[i]?.run(); set({ palette: false }); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => set({ palette: false })}>
          <motion.div className="palette" initial={{ y: -14, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Search studios and actions…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } if (e.key === 'Enter') go(sel); }} />
            <div className="palette-list">{list.map((it, i) => <div key={it.id} className="palette-item" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>{it.label}<span className="grp">{it.grp}</span></div>)}{!list.length && <div className="faint" style={{ padding: 14 }}>No matches.</div>}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Shell() {
  const loc = useLocation();
  return (
    <>
      <div className="shell">
        <Sidebar />
        <div className="main">
          <Topbar />
          <main className="content">
            <ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<div className="row dim"><span className="spinner" /> Loading studio…</div>}>
              <AnimatePresence mode="wait"><motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}><Outlet /></motion.div></AnimatePresence>
            </Suspense></ErrorBoundary>
          </main>
        </div>
      </div>
      <JobsDrawer /><MethodsDrawer /><Palette /><ToastHost />
    </>
  );
}

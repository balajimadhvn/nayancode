import { motion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { snapshotCanvases, useReport } from '@/core/report';
import { create } from 'zustand';
import { Icon } from './Icons';

export const Tabs = <T extends string>({ value, onChange, items }: { value: T; onChange(v: NoInfer<T>): void; items: readonly { id: NoInfer<T>; label: string }[] }) => {
  const gid = useId();
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" className="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}>
          {value === it.id && <motion.i layoutId={`pill-${gid}`} className="pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
};

export const Card = ({ title, sub, actions, children, pad = true, className = '' }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) => {
  const ref = useRef<HTMLElement>(null), add = useReport((s) => s.add), [hasCanvas, setHas] = useState(false);
  useEffect(() => { const el = ref.current; if (!el) return; const chk = () => setHas(!!title && !!el.querySelector('canvas')); chk(); const mo = new MutationObserver(chk); mo.observe(el, { childList: true, subtree: true }); return () => mo.disconnect(); }, [title]);
  const snap = () => { const el = ref.current; if (!el) return; const imgs = snapshotCanvases(el); if (!imgs.length) { toast('Nothing drawable to capture in this card'); return; } const t = el.querySelector('.card-title > div')?.textContent?.replace(/\s+/g, ' ').trim() ?? 'Figure'; imgs.forEach((png, i) => add({ title: imgs.length > 1 ? `${t} (${i + 1})` : t, studio: location.hash.replace('#/', '') || 'workbench', png })); toast(`Added ${imgs.length} figure${imgs.length > 1 ? 's' : ''} to the report`); };
  return (
    <motion.section ref={ref} className={`card ${className}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      {title && <div className="card-title"><div>{title} {sub && <span className="sub">· {sub}</span>}</div><div className="row">{actions}{hasCanvas && <button className="btn ghost sm icon" onClick={snap} title="Add this figure to the report" aria-label="Add figure to report" style={{ padding: 5 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg></button>}</div></div>}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </motion.section>
  );
};

export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="card stat" title={hint}><div className="v">{value}</div><div className="l">{label}</div></div>
);

export const Callout = ({ kind, children }: { kind?: 'warn' | 'err'; children: ReactNode }) => <div className={`callout ${kind ?? ''}`}>{children}</div>;

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="field">{label}{children}</label>;

export const Busy = ({ progress, note }: { progress: number; note?: string }) => (
  <div style={{ display: 'grid', gap: 6 }}><div className="row dim" style={{ fontSize: 12 }}><span className="spinner" /> {note ?? 'Working…'}</div><div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div></div>
);

// ---- toast ----
const useToast = create<{ msg: string | null; show(m: string): void }>((set) => ({ msg: null, show: (msg) => { set({ msg }); setTimeout(() => set({ msg: null }), 2200); } }));
export const toast = (m: string) => useToast.getState().show(m);
export const ToastHost = () => { const m = useToast((s) => s.msg); return m ? <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>{m}</motion.div> : null; };

// ---- file drop ----
export function FileDrop({ onText, accept, label }: { onText(text: string, name: string): void; accept?: string; label?: string }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const read = useCallback(async (f: File) => {
    if (f.size > 200 * 1024 * 1024) { toast('File larger than 200 MB: use the cloud pipeline for this size'); return; }
    onText(await f.text(), f.name);
  }, [onText]);
  return (
    <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}>
      <Icon.Upload style={{ marginBottom: 4 }} /><div>{label ?? 'Drop a file or click to browse'}</div>
      <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Read locally. Never uploaded.</div>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
    </div>
  );
}

// ---- sortable table ----
export interface Col<R> { key: string; label: string; num?: boolean; render?(r: R): ReactNode; sort?(r: R): number | string; width?: number }
export function DataTable<R>({ rows, cols, limit = 300, onRow, rowKey }: { rows: R[]; cols: Col<R>[]; limit?: number; onRow?(r: R): void; rowKey(r: R, i: number): string }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const sorted = (() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.k);
    if (!c?.sort) return rows;
    return [...rows].sort((a, b) => { const x = c.sort!(a), y = c.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  })();
  const shown = sorted.slice(0, limit);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
      <table className="t">
        <thead><tr>{cols.map((c) => (
          <th key={c.key} className={`${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''}`} style={{ width: c.width }} onClick={() => c.sort && setSort((s) => (s?.k === c.key ? { k: c.key, dir: (-s.dir as 1 | -1) } : { k: c.key, dir: 1 }))}>
            {c.label}{sort?.k === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
          </th>))}</tr></thead>
        <tbody>{shown.map((r, i) => (
          <tr key={rowKey(r, i)} onClick={() => onRow?.(r)} style={{ cursor: onRow ? 'pointer' : undefined }}>{cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}</td>)}</tr>))}</tbody>
      </table>
      {rows.length > limit && <div className="faint" style={{ padding: 10, fontSize: 12 }}>Showing {limit.toLocaleString()} of {rows.length.toLocaleString()} rows. Export for the full table.</div>}
    </div>
  );
}

export function downloadText(name: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const toCsv = (rows: object[]) => {
  if (!rows.length) return '';
  const k = Object.keys(rows[0]);
  return [k.join(','), ...rows.map((r) => k.map((c) => { const v = String((r as Record<string, unknown>)[c] ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(','))].join('\n');
};
export const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : '–');
export const sci = (v: number) => (!Number.isFinite(v) ? '–' : v === 0 ? '0' : v < 1e-3 ? v.toExponential(1) : v.toFixed(4));

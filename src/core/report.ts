import { create } from 'zustand';

/** Report store, persisted in IndexedDB (figures are PNGs and exceed localStorage quotas). Nothing leaves the browser. */
export interface Figure { id: string; title: string; studio: string; png: string; caption: string; created: string }
export interface ReportDoc { title: string; author: string; intro: string; figures: Figure[] }
const DB = 'wb-report', STORE = 'doc', KEY = 'current';
const open = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const load = async (): Promise<ReportDoc | null> => { try { const db = await open(); return await new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res((q.result as ReportDoc) ?? null); q.onerror = () => res(null); }); } catch { return null; } };
const save = async (d: ReportDoc) => { try { const db = await open(); db.transaction(STORE, 'readwrite').objectStore(STORE).put(d, KEY); } catch { /* private mode: report lives for this session only */ } };

interface S extends ReportDoc { ready: boolean; hydrate(): Promise<void>; set(p: Partial<ReportDoc>): void; add(f: Omit<Figure, 'id' | 'created' | 'caption'>): void; remove(id: string): void; move(id: string, d: -1 | 1): void; caption(id: string, c: string): void; clear(): void }
const empty: ReportDoc = { title: 'Analysis report', author: '', intro: '', figures: [] };
export const useReport = create<S>((set, get) => {
  const commit = (p: Partial<ReportDoc>) => { set(p); const { title, author, intro, figures } = get(); void save({ title, author, intro, figures }); };
  return {
    ...empty, ready: false,
    hydrate: async () => { if (get().ready) return; const d = await load(); set({ ...(d ?? empty), ready: true }); },
    set: (p) => commit(p),
    add: (f) => commit({ figures: [...get().figures, { ...f, id: crypto.randomUUID(), caption: '', created: new Date().toISOString() }] }),
    remove: (id) => commit({ figures: get().figures.filter((x) => x.id !== id) }),
    move: (id, d) => { const a = [...get().figures], i = a.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; commit({ figures: a }); },
    caption: (id, c) => commit({ figures: get().figures.map((x) => (x.id === id ? { ...x, caption: c } : x)) }),
    clear: () => commit({ ...empty }),
  };
});

/** Snapshot the drawable canvases inside an element as PNG data URLs (skips WebGL/3D viewers that cannot be read back reliably). */
export function snapshotCanvases(root: HTMLElement): string[] {
  const out: string[] = [];
  root.querySelectorAll('canvas').forEach((c) => { if (c.closest('.molstar-host') || c.closest('[class*="igv"]') || c.width < 60 || c.height < 40) return; try { const bg = document.createElement('canvas'); bg.width = c.width; bg.height = c.height; const g = bg.getContext('2d')!; g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-elev').trim() || '#0b1020'; g.fillRect(0, 0, bg.width, bg.height); g.drawImage(c, 0, 0); out.push(bg.toDataURL('image/png')); } catch { /* tainted canvas */ } });
  return out;
}

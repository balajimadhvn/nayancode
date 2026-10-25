/** Local persistence for protocols and notebook entries. Every storage call is guarded. */
import { fromJson, type Protocol } from './format';

export interface NotebookEntry {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  text: string;
  protocol?: string;
}
export interface StoreState { protocols: Protocol[]; notebook: NotebookEntry[] }
export interface LoadedStore extends StoreState { blocked: boolean }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void }

export const STORAGE_KEY = 'nayancode-protocols';

const memory = { protocols: [] as Protocol[], notebook: [] as NotebookEntry[] };

function defaultStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanEntry(raw: unknown): NotebookEntry | null {
  if (!isRecord(raw) || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('note'),
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : new Date().toISOString().slice(0, 10),
    title: raw.title.trim(),
    text: typeof raw.text === 'string' ? raw.text : '',
    ...(typeof raw.protocol === 'string' && raw.protocol.trim() ? { protocol: raw.protocol.trim() } : {}),
  };
}

/** Reads the store; a blocked or corrupt store yields an empty, in-memory state flagged as not saved. */
export function loadStore(storage: StorageLike | null = defaultStorage()): LoadedStore {
  if (!storage) return { ...memory, blocked: true };
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return { protocols: [], notebook: [], blocked: false };
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw)) return { protocols: [], notebook: [], blocked: false };
    const protocols = Array.isArray(raw.protocols) ? raw.protocols.flatMap((p) => {
      const r = fromJson(JSON.stringify(p));
      return r.ok ? [r.protocol] : [];
    }) : [];
    const notebook = Array.isArray(raw.notebook) ? raw.notebook.map(cleanEntry).filter((e): e is NotebookEntry => e !== null) : [];
    return { protocols, notebook, blocked: false };
  } catch {
    return { ...memory, blocked: true };
  }
}

/** Returns false when the browser refuses storage; callers keep their React state. */
export function saveStore(state: StoreState, storage: StorageLike | null = defaultStorage()): boolean {
  memory.protocols = [...state.protocols];
  memory.notebook = [...state.notebook];
  if (!storage) return false;
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state })); return true; } catch { return false; }
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

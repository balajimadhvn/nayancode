import { create } from 'zustand';

type Theme = 'dark' | 'light';
interface UiState { theme: Theme; palette: boolean; jobs: boolean; methods: boolean; sidebar: boolean; setTheme(t: Theme): void; toggleTheme(): void; set(p: Partial<Pick<UiState, 'palette' | 'jobs' | 'methods' | 'sidebar'>>): void }

const isBrowser = typeof window !== 'undefined';
// index.html sets data-theme before first paint (stored choice, else the OS preference, else light), so read it back here.
const initial = (): Theme => {
  if (!isBrowser) return 'light';
  const t = document.documentElement.dataset.theme;
  return t === 'dark' ? 'dark' : 'light';
};
const apply = (t: Theme) => { if (!isBrowser) return; document.documentElement.dataset.theme = t; try { localStorage.setItem('wb.theme', t); } catch { /* noop */ } };

export const useUi = create<UiState>((set, get) => ({
  theme: initial(), palette: false, jobs: false, methods: false, sidebar: false,
  setTheme: (t) => { apply(t); set({ theme: t }); },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  set: (p) => set(p),
}));


/** A lazily loaded studio can fail to fetch after a redeploy (old chunk hashes) or a dev-server restart.
 *  Reload once automatically; if it fails again the error boundary shows a manual Reload button. */
const KEY = 'wb.chunkReload';
export function installChunkRecovery() {
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    try { const last = Number(sessionStorage.getItem(KEY) ?? 0); if (Date.now() - last > 15000) { sessionStorage.setItem(KEY, String(Date.now())); location.reload(); } } catch { location.reload(); }
  });
}
export const isChunkError = (m: string) => /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically/i.test(m);

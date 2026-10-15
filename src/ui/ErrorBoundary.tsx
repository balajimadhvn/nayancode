import { Component, type ReactNode } from 'react';
import { isChunkError } from '@/core/chunk-recovery';

/** Keeps a crash in one studio from blanking the whole app. Shows no user data. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { err: Error | null; key?: string }> {
  state = { err: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) {
    // A stale module (dev-server restart, redeploy) is fixed by one reload; guard against reload loops.
    if (!isChunkError(err.message)) return;
    try { const k = 'wb.boundaryReload', last = Number(sessionStorage.getItem(k) ?? 0); if (Date.now() - last > 15000) { sessionStorage.setItem(k, String(Date.now())); location.reload(); } } catch { /* storage blocked: user can press Reload */ }
  }
  static getDerivedStateFromProps(p: { resetKey?: string }, s: { key?: string; err: Error | null }) { return p.resetKey !== s.key ? { err: null, key: p.resetKey } : null; }
  render() {
    if (!this.state.err) return this.props.children;
    if (isChunkError(this.state.err.message)) return (
      <div className="card card-pad" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
        <h3>This view could not be loaded</h3>
        <p className="dim">The app was updated or the dev server restarted while this page was open, so the loaded files are out of date. Reloading fixes it. Your data was never sent anywhere.</p>
        <div className="row"><button className="btn primary" onClick={() => location.reload()}>Reload</button></div>
      </div>
    );
    return (
      <div className="card card-pad" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
        <h3>Something went wrong in this view</h3>
        <p className="dim">Your data is safe: nothing was sent anywhere. Try again, or reload the page.</p>
        <pre className="seqbox" style={{ maxHeight: 140 }}>{this.state.err.message}</pre>
        <div className="row"><button className="btn primary" onClick={() => this.setState({ err: null })}>Try again</button><button className="btn" onClick={() => location.reload()}>Reload</button></div>
      </div>
    );
  }
}

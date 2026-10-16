import { useEffect, useRef, useState } from 'react';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import { brandedName } from '@/core/filename';

/** Mol* viewer showing the receptor (cartoon) and the selected docked pose (ball-and-stick). Mol* is loaded on demand. */
export function DockViewer({ receptor, pose }: { receptor: { text: string; format: 'pdb' | 'mmcif'; key: string } | null; pose: { pdb: string; key: string } | null }) {
  const host = useRef<HTMLDivElement>(null);
  const plugin = useRef<PluginUIContext | null>(null);
  const poseRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false, mount: HTMLDivElement | null = null;
    (async () => {
      const [{ createPluginUI }, { renderReact18 }, { DefaultPluginUISpec }] = await Promise.all([import('molstar/lib/mol-plugin-ui'), import('molstar/lib/mol-plugin-ui/react18'), import('molstar/lib/mol-plugin-ui/spec')]);
      await import('molstar/lib/mol-plugin-ui/skin/dark.scss');
      if (disposed || !host.current) return;
      const spec = DefaultPluginUISpec();
      mount = document.createElement('div'); mount.style.cssText = 'position:absolute;inset:0';
      host.current.appendChild(mount);
      const ctx = await createPluginUI({ target: mount, render: renderReact18, spec: { ...spec, layout: { initial: { isExpanded: false, showControls: false, controlsDisplay: 'reactive' } }, components: { ...spec.components, remoteState: 'none' } } });
      if (disposed) { ctx.dispose(); return; }
      const { Color } = await import('molstar/lib/mol-util/color');
      ctx.canvas3d?.setProps({ renderer: { backgroundColor: Color(0x0b0f1a) } });
      plugin.current = ctx; setReady(true);
      setTimeout(() => mount?.querySelectorAll('a.msp-logo').forEach((l) => l.setAttribute('aria-label', 'Mol* viewer website')), 500);
    })().catch(() => { /* `ready` stays false */ });
    return () => { disposed = true; plugin.current?.dispose(); plugin.current = null; mount?.remove(); };
  }, []);

  useEffect(() => {
    const p = plugin.current; if (!ready || !p) return;
    (async () => {
      await p.clear(); poseRef.current = null;
      if (!receptor) return;
      const d = await p.builders.data.rawData({ data: receptor.text, label: 'receptor' }, { state: { isGhost: true } });
      const traj = await p.builders.structure.parseTrajectory(d, receptor.format);
      await p.builders.structure.hierarchy.applyPreset(traj, 'default');
    })().catch(() => { /* viewer is optional */ });
  }, [ready, receptor?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = plugin.current; if (!ready || !p) return;
    (async () => {
      if (poseRef.current) { await p.state.data.build().delete(poseRef.current as never).commit(); poseRef.current = null; }
      if (!pose) return;
      const d = await p.builders.data.rawData({ data: pose.pdb, label: 'docked pose' }, { state: { isGhost: true } });
      poseRef.current = d.ref;
      const traj = await p.builders.structure.parseTrajectory(d, 'pdb');
      await p.builders.structure.hierarchy.applyPreset(traj, 'default');
    })().catch(() => { /* viewer is optional */ });
  }, [ready, pose?.key, receptor?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = () => { const c = host.current?.querySelector('canvas'); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = brandedName('docking.png'); a.click(); };
  return (
    <div style={{ position: 'relative' }}>
      <div className="molstar-host" ref={host} />
      {!ready && <div className="row dim" style={{ position: 'absolute', inset: 0, justifyContent: 'center', color: '#9aa8c7', pointerEvents: 'none' }}><span className="spinner" /> Starting Mol* viewer…</div>}
      <button className="btn sm" style={{ position: 'absolute', right: 8, top: 8 }} onClick={snapshot} disabled={!ready}>Save image</button>
    </div>
  );
}

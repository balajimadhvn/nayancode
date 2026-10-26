import type { SVGProps } from 'react';
const base = (p: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p });
export const Icon = {
  Home: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>,
  Sequence: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 3c0 6 14 6 14 12S5 21 5 21M19 3c0 6-14 6-14 12"/><path d="M8 7h8M8 17h8"/></svg>,
  Expression: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>,
  Chemistry: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/></svg>,
  Structure: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><circle cx="19" cy="18" r="1.8"/><path d="m8 7 8 1M7 8l1.5 7.5M11 17.5l6.5 0M18.5 10.5 19 16"/></svg>,
  Phylo: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 12h5M8 6v12M8 6h5M8 18h5M13 3v6M13 15v6M13 3h6M13 9h6M13 15h6M13 21h6"/></svg>,
  Genome: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 8h18M3 16h18"/><path d="M7 5v6M12 5v6M17 5v6M7 13v6M12 13v6M17 13v6" opacity=".7"/></svg>,
  Variant: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 20V8M9 20V4M15 20v-9M21 20V13"/><circle cx="9" cy="4" r="1" fill="currentColor"/></svg>,
  SingleCell: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="7" cy="7" r="2"/><circle cx="16" cy="6" r="1.6"/><circle cx="12" cy="12" r="2.4"/><circle cx="18" cy="14" r="2"/><circle cx="6" cy="17" r="1.8"/><circle cx="14" cy="19" r="1.4"/></svg>,
  Microbiome: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2.4"/><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="18" r="1.8"/></svg>,
  Search: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  Menu: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16"/></svg>,
  Sun: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
  Moon: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>,
  Shield: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/></svg>,
  Jobs: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 6h16M4 12h10M4 18h6"/><circle cx="18" cy="16" r="3"/></svg>,
  Doc: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>,
  Upload: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>,
  Play: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/></svg>,
  X: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18"/></svg>,
  Arrow: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
  Download: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>,
  Lock: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>,
  Cpu: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>,
  Chevron: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m6 9 6 6 6-6"/></svg>,
  Check: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>,
  Spark: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/><circle cx="12" cy="12" r="2.2"/></svg>,
  Book: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>,
  Users: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.2c2.4.3 4 2.2 4 4.8"/></svg>,
  Code: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>,
  Mail: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>,
  Layers: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>,
  Beaker: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 3h6M10 3v6l-5 9.5A1.5 1.5 0 0 0 6.3 21h11.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3"/><path d="M7.5 15h9"/></svg>,
  Docking: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 9a8 8 0 0 1 16 0v1H4z"/><path d="M12 13v8M9 21h6"/><circle cx="12" cy="6.5" r="1.6" fill="currentColor"/></svg>,
  Flask: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3"/><path d="M7.5 15h9"/></svg>,
};
export const StudioIcon: Record<string, (p: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  sequence: Icon.Sequence, expression: Icon.Expression, chemistry: Icon.Chemistry, structure: Icon.Structure, docking: Icon.Docking,
  phylo: Icon.Phylo, genome: Icon.Genome, variant: Icon.Variant, singlecell: Icon.SingleCell, microbiome: Icon.Microbiome, lab: Icon.Flask, stats: Icon.Doc, plasmid: Icon.Genome, biologics: Icon.Spark, pk: Icon.Cpu, peptide: Icon.Cpu, trajectory: Icon.Cpu, popgen: Icon.Genome, omicsquant: Icon.Cpu, amr: Icon.Genome, crispr: Icon.Spark, primer: Icon.Sequence, enrich: Icon.Genome, protocol: Icon.Doc, sanger: Icon.Sequence, imagecount: Icon.SingleCell, flow: Icon.SingleCell, dynamics: Icon.Cpu, search: Icon.Sequence,
};

export const Logo = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    {/* PLACEHOLDER mark, shared with the public site (src/site/icons.tsx): aligned reads with a shared variant column. */}
    <rect x="2" y="6" width="19" height="4" fill="currentColor" />
    <rect x="8" y="14" width="22" height="4" fill="currentColor" />
    <rect x="4" y="22" width="20" height="4" fill="currentColor" />
    <rect x="15" y="6" width="4" height="4" fill="var(--accent-2)" />
    <rect x="15" y="14" width="4" height="4" fill="var(--accent-2)" />
    <rect x="15" y="22" width="4" height="4" fill="var(--accent-2)" />
  </svg>
);

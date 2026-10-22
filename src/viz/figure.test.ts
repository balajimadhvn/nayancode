import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, OKABE, buildBars, buildBoxPlot, buildCurves, buildForest, buildFunnel, buildHeatmap, buildMsa, buildScatter, buildTree, parseColor, placeLabels, sceneToPdf, sceneToSvg, textWidth, treeLayout, tukeyQuartiles, type FigureOptions } from './figure';

const opt = (o: Partial<FigureOptions> = {}): FigureOptions => ({ ...DEFAULT_OPTIONS, ...o });
const pts = Array.from({ length: 200 }, (_, i) => ({ x: Math.sin(i) * 3, y: (i % 17) + Math.cos(i), cat: i % 10 === 0 ? 1 : i % 10 === 5 ? 2 : 0, label: `GENE${i}` }));
const scatter = { points: pts, colors: ['#888888', '#ff0000', '#0000ff'], names: ['ns', 'up', 'down'], xLabel: 'log2FC', yLabel: '-log10 p', vlines: [-1, 1], labelScore: (p: { x: number; y: number }) => Math.abs(p.x) * p.y };

interface El { tag: string; attrs: Record<string, string>; text: string; children: El[] }
/** Strict mini XML parser (nesting, quoted attributes, entities); throws on malformed input. */
function parseXml(svg: string) {
  const root: El = { tag: '#root', attrs: {}, text: '', children: [] }, stack = [root];
  const re = /<\?[^>]*\?>|<\/([\w:-]+)>|<([\w:-]+)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null, last = 0;
  const dec = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  while ((m = re.exec(svg))) {
    if (m.index !== last) throw new Error('unparsable at ' + last); last = re.lastIndex;
    if (m[1]) { const t = stack.pop()!; if (t.tag !== m[1]) throw new Error(`mismatched </${m[1]}> for <${t.tag}>`); }
    else if (m[2]) {
      const attrs: Record<string, string> = {}; for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = dec(a[2]);
      const el: El = { tag: m[2], attrs, text: '', children: [] }; stack[stack.length - 1].children.push(el); if (!m[4]) stack.push(el);
    } else if (m[5]) { if (/[<>&](?!(lt|gt|quot|amp);)/.test(m[5].replace(/&(lt|gt|quot|amp);/g, ''))) throw new Error('bad text'); stack[stack.length - 1].text += dec(m[5]); }
  }
  if (stack.length !== 1 || last !== svg.length) throw new Error('unclosed elements');
  const all: El[] = []; const walk = (e: El) => { all.push(e); e.children.forEach(walk); }; walk(root);
  const textOf = (e: El): string => e.text + e.children.map(textOf).join('');
  return {
    root: root.children[0], all,
    byTag: (t: string) => all.filter((e) => e.tag === t), byId: (id: string) => all.find((e) => e.attrs.id === id),
    textContent: textOf(root),
  };
}

describe('SVG export', () => {
  it('is well-formed with mm size, one circle per point, editable text, no CSS variables', () => {
    const svg = sceneToSvg(buildScatter(scatter, opt({ widthMm: 85, heightMm: 60, title: 'Volcano' })));
    const d = parseXml(svg), root = d.root;
    expect(root.attrs.width).toBe('85mm'); expect(root.attrs.height).toBe('60mm');
    expect(d.byTag('circle').length).toBe(200);
    expect(d.byId('title')?.text).toBe('Volcano');
    expect(svg).not.toMatch(/var\(--|currentColor/);
    expect(d.byTag('text').map((t) => t.text)).toContain('log2FC');
  });
  it('light and dark themes differ in background and text colour', () => {
    const l = sceneToSvg(buildScatter(scatter, opt({ theme: 'light' }))), k = sceneToSvg(buildScatter(scatter, opt({ theme: 'dark' })));
    expect(l).toContain('id="background"'); expect(l).toContain('fill="#ffffff"'); expect(k).toContain('fill="#0b1220"'); expect(k).not.toContain('fill="#ffffff"');
  });
  it('colour-blind palette replaces the series colours with Okabe–Ito', () => {
    const svg = sceneToSvg(buildScatter(scatter, opt({ palette: 'okabe' })));
    expect(svg.toLowerCase()).toContain(OKABE[1].toLowerCase()); expect(svg).not.toContain('#ff0000');
  });
  it('labels the top-N genes by score without overlapping boxes', () => {
    const sc = buildScatter(scatter, opt({ labelTopN: 12, widthMm: 150, heightMm: 110 }));
    const labels = sc.items.filter((i) => i.k === 'text' && i.id === 'gene-label');
    expect(labels.length).toBe(12);
    const top = [...pts].filter((p) => p.cat).sort((a, b) => Math.abs(b.x) * b.y - Math.abs(a.x) * a.y).slice(0, 12).map((p) => p.label);
    expect(labels.map((l) => (l as { t: string }).t).sort()).toEqual(top.sort());
    const boxes = labels.map((l) => { const t = l as { x: number; y: number; t: string; size: number; anchor?: string }, w = textWidth(t.t, t.size), x0 = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x; return { x0, x1: x0 + w, y0: t.y - t.size * 0.8, y1: t.y + t.size * 0.2 }; });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxes[i].x0 < boxes[j].x1 && boxes[i].x1 > boxes[j].x0 && boxes[i].y0 < boxes[j].y1 && boxes[i].y1 > boxes[j].y0).toBe(false);
  });
  it('bars carry error-bar lines and edited axis labels', () => {
    const sc = buildBars({ labels: ['a', 'b'], values: [1, 2], colors: ['#123456'], yLabel: 'Fold change', errors: [0.2, 0.3], dots: [[0.9, 1.1], [1.8, 2.2]] }, opt({ yLabel: 'Relative expression', title: 'qPCR' }));
    const svg = sceneToSvg(sc), d = parseXml(svg);
    expect(d.byTag('rect').filter((r) => r.attrs.id?.startsWith('bar-')).length).toBe(2); expect(d.byTag('circle').length).toBe(4);
    expect(svg).toContain('Relative expression'); expect(svg).not.toContain('Fold change');
  });
  it('heatmap draws one rect per cell and escapes XML in labels', () => {
    const d = parseXml(sceneToSvg(buildHeatmap({ rows: ['r<1>', 'r2'], cols: ['c&1', 'c2', 'c3'], z: [[-2, 0, 2], [1, -1, 0]] }, opt())));
    expect(d.byTag('rect').length).toBeGreaterThanOrEqual(1 + 6);
    expect(d.textContent).toContain('r<1>');
  });
  it('log axes show decade ticks', () => {
    const svg = sceneToSvg(buildCurves({ series: [{ name: 'A', color: '#ff0000', points: [{ x: 1e-9, y: 0 }, { x: 1e-5, y: 100 }], curve: [{ x: 1e-9, y: 0 }, { x: 1e-5, y: 100 }] }], xLabel: 'Dose (M)', yLabel: 'Response', logX: true }, opt()));
    expect(svg).toContain('10⁻⁷'); parseXml(svg);
  });
});

describe('PDF export', () => {
  const pdf = sceneToPdf(buildScatter(scatter, opt({ widthMm: 100, heightMm: 70, title: 'Volcano (β)' })));
  it('has a valid structure with correct xref offsets and page size', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true); expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(/^[\x00-\x7f]*$/.test(pdf)).toBe(true);
    const sx = +pdf.match(/startxref\n(\d+)/)![1]; expect(pdf.slice(sx, sx + 4)).toBe('xref');
    const offs = [...pdf.matchAll(/(\d{10}) 00000 n /g)].map((m) => +m[1]);
    offs.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const mb = pdf.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!; expect(+mb[1]).toBeCloseTo(100 * 72 / 25.4, 1); expect(+mb[2]).toBeCloseTo(70 * 72 / 25.4, 1);
    const len = +pdf.match(/\/Length (\d+)/)![1], body = pdf.slice(pdf.indexOf('stream\n') + 7); expect(body.indexOf('\nendstream')).toBe(len);
  });
  it('contains the expected marks and text', () => {
    expect((pdf.match(/ c h/g) ?? []).length).toBe(200); expect(pdf).toContain('(log2FC) Tj'); expect(pdf).toContain('/F3'); expect(pdf).toContain('/ca ');
  });
});


describe('box plots', () => {
  const spec = { groups: [{ name: 'all', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 100], color: '#4c72b0' }], xLabel: '', yLabel: 'value' };
  it('uses Tukey quartiles with linear interpolation', () => {
    const q = tukeyQuartiles(spec.groups[0].values);
    expect(q.median).toBe(5.5); expect(q.q1).toBe(3.25); expect(q.q3).toBe(7.75);
    expect(q.whiskerHi).toBe(9); expect(q.outliers).toEqual([100]);
  });
  it('draws the box, the whiskers and the outlier circle at the right heights', () => {
    const sc = buildBoxPlot(spec, opt({ widthMm: 90, heightMm: 70 }));
    const box = sc.items.find((i) => i.k === 'rect' && i.id === 'box-0');
    expect(box).toBeTruthy();
    // Calibrate the value axis from the y-axis tick labels and their gridlines (labels sit a constant offset below the line).
    const ticks = sc.items.filter((i) => i.k === 'text' && i.anchor === 'end' && Number.isFinite(Number((i as { t: string }).t))) as { y: number; t: string }[];
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const grid = sc.items.filter((i) => i.k === 'line' && (i as { op?: number }).op === 0.8) as { y1: number; x1: number; x2: number }[];
    expect(grid.length).toBe(ticks.length);
    const atTick = ticks.map((tk) => {
      const line = grid.reduce((a, b) => (Math.abs(b.y1 - tk.y) < Math.abs(a.y1 - tk.y) ? b : a));
      expect(Math.abs(line.y1 - tk.y)).toBeLessThan(6);
      return { value: Number(tk.t), y: line.y1 };
    });
    const t0 = atTick.reduce((a, b) => (a.value < b.value ? a : b)), t1 = atTick.reduce((a, b) => (a.value > b.value ? a : b));
    const v = (y: number) => t0.value + ((t1.value - t0.value) * (y - t0.y)) / ((t1.y - t0.y) || 1);
    const b = box as { y: number; h: number };
    expect(v(b.y)).toBeCloseTo(7.75, 6); // top of the box = Q3
    expect(v(b.y + b.h)).toBeCloseTo(3.25, 6); // bottom = Q1
    const median = sc.items.find((i) => i.k === 'line' && i.id === 'median-0') as { y1: number };
    expect(v(median.y1)).toBeCloseTo(5.5, 6);
    const hi = sc.items.find((i) => i.k === 'line' && i.id === 'whisker-hi-0') as { y1: number };
    expect(v(hi.y1)).toBeCloseTo(9, 6); // upper whisker ends at the largest value inside 1.5 × IQR
    // One outlier circle above the whisker, plus the jittered points.
    const circles = sc.items.filter((i) => i.k === 'circle') as { cy: number; r: number }[];
    expect(circles.length).toBeGreaterThan(spec.groups[0].values.length);
    expect(circles.some((c) => Math.abs(v(c.cy) - 100) < 1e-6)).toBe(true);
  });
});

describe('alignment figures', () => {
  const spec = { names: ['a', 'b', 'c'], seqs: ['ACGTACGTAC', 'ACGTACGTAT', 'ACGAACGTAC'], type: 'dna' as const };
  it('renders one text item per residue, the names, and a finite size', () => {
    const sc = buildMsa(spec, opt({ widthMm: 100, heightMm: 60 }));
    const residues = sc.items.filter((i) => i.k === 'text' && i.id?.startsWith('res-'));
    expect(residues.length).toBe(30);
    for (const n of spec.names) expect(sc.items.some((i) => i.k === 'text' && i.t === n)).toBe(true);
    expect(Number.isFinite(sc.w) && sc.w > 0).toBe(true); expect(Number.isFinite(sc.h) && sc.h > 0).toBe(true);
  });
  it('wraps into blocks with a position ruler', () => {
    const sc = buildMsa({ ...spec, blockWidth: 4 }, opt({ widthMm: 100, heightMm: 60 }));
    expect(sc.items.filter((i) => i.k === 'text' && i.id?.startsWith('res-')).length).toBe(30);
    expect(sc.items.some((i) => i.k === 'text' && i.t === '5')).toBe(true); // second block starts at column 5
  });
});

describe('tree figures', () => {
  const newick = '((A:1,B:2)90:1,C:3);';
  it('places tips at their cumulative branch length', () => {
    const o = opt({ widthMm: 90, heightMm: 60 });
    const lay = treeLayout(newick, o);
    const depth = Object.fromEntries(lay.tips.map((t) => [t.name, t.depth]));
    expect(depth).toMatchObject({ A: 2, B: 3, C: 3 });
    for (const t of lay.tips) expect(t.x).toBeCloseTo(lay.left + t.depth * lay.pxPerUnit, 9);
    const sc = buildTree({ newick, showSupport: true, showScale: true }, o);
    const labels = sc.items.filter((i) => i.k === 'text' && i.id?.startsWith('tip-')) as { x: number; t: string }[];
    expect(labels.map((l) => l.t).sort()).toEqual(['A', 'B', 'C']);
    for (const t of lay.tips) expect(labels.find((l) => l.t === t.name)!.x).toBeCloseTo(t.x + 3, 9);
    const svg = sceneToSvg(sc);
    for (const n of ['A', 'B', 'C']) expect(svg).toContain(`>${n}</text>`);
    expect(svg).toContain('<text');
    expect(sc.items.some((i) => i.k === 'text' && i.t === '90')).toBe(true); // support value
    expect(sc.items.some((i) => i.k === 'line' && i.id === 'scale-bar')).toBe(true);
  });
  it('exports to SVG and PDF', () => {
    const sc = buildTree({ newick }, opt({ widthMm: 90, heightMm: 60 }));
    expect(sceneToSvg(sc).length).toBeGreaterThan(0);
    const pdf = sceneToPdf(sc);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  });
});

describe('helpers', () => {
  it('parses css colours', () => {
    expect(parseColor('#f00')).toMatchObject({ r: 255, g: 0, b: 0 }); expect(parseColor('rgb(10, 20, 30)')).toMatchObject({ r: 10, g: 20, b: 30 });
    expect(parseColor('hsl(120 100% 50%)')).toMatchObject({ r: 0, g: 255, b: 0 }); expect(parseColor('rgba(0,0,0,.35)').a).toBeCloseTo(0.35);
  });
  it('placeLabels never exceeds N and stays inside the box', () => {
    const c = Array.from({ length: 30 }, (_, i) => ({ x: 100 + (i % 3), y: 100 + (i % 2), text: `G${i}`, score: i }));
    const out = placeLabels(c, 10, 7, { x0: 0, y0: 0, x1: 200, y1: 200 });
    expect(out.length).toBeLessThanOrEqual(10); for (const l of out) { expect(l.x).toBeGreaterThan(-1); expect(l.y).toBeLessThan(200); }
  });
});

describe('meta-analysis figures', () => {
  const labels = ['Study A', 'Study B', 'Study C', 'Study D'];
  const forestSpec = {
    labels, est: [-0.8, -0.4, -1.1, -0.2], lo: [-1.4, -0.9, -1.9, -0.6], hi: [-0.2, 0.1, -0.3, 0.2],
    weight: [10, 30, 5, 55], pooled: { est: -0.52, lo: -0.85, hi: -0.19, label: 'Pooled' }, xLabel: 'log risk ratio',
  };

  it('forest plot draws one label per study and a diamond for the pooled effect', () => {
    const sc = buildForest(forestSpec, opt({ widthMm: 120, heightMm: 80 }));
    const texts = sc.items.filter((i) => i.k === 'text').map((i) => (i as { t: string }).t);
    for (const l of labels) expect(texts).toContain(l);
    expect(texts).toContain('Pooled');
    const polys = sc.items.filter((i) => i.k === 'poly') as { pts: [number, number][] }[];
    expect(polys).toHaveLength(1);
    expect(polys[0].pts).toHaveLength(4);
  });

  it('forest plot works on a log scale and its SVG contains every study label', () => {
    const sc = buildForest({ ...forestSpec, logScale: true }, opt());
    const svg = sceneToSvg(sc);
    for (const l of labels) expect(svg).toContain(l.replace(/&/g, '&amp;'));
    expect(svg).toMatch(/^<\?xml/);
  });

  it('funnel plot puts precise studies on top (y increases with the standard error)', () => {
    const se = [0.05, 0.1, 0.2, 0.4, 0.8];
    const sc = buildFunnel({ yi: [-0.6, -0.5, -0.3, -0.7, -0.1], se, centre: -0.45, xLabel: 'log RR' }, opt());
    const circles = sc.items.filter((i) => i.k === 'circle') as { cx: number; cy: number }[];
    expect(circles).toHaveLength(se.length);
    for (let i = 1; i < circles.length; i++) expect(circles[i].cy).toBeGreaterThan(circles[i - 1].cy);
    // plot-space y = −se decreases as se increases (inverted axis)
    expect(-se[se.length - 1]).toBeLessThan(-se[0]);
  });

  it('both figures export to SVG and PDF', () => {
    for (const sc of [buildForest(forestSpec, opt()), buildFunnel({ yi: [-0.6, -0.3, -0.7, -0.1], se: [0.1, 0.2, 0.4, 0.8], centre: -0.45, xLabel: 'log RR' }, opt())]) {
      const svg = sceneToSvg(sc);
      expect(() => parseXml(svg)).not.toThrow();
      expect(sceneToPdf(sc).startsWith('%PDF-1.4')).toBe(true);
    }
  });
});

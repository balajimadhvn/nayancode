import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, OKABE, buildBars, buildCurves, buildHeatmap, buildScatter, parseColor, placeLabels, sceneToPdf, sceneToSvg, textWidth, type FigureOptions } from './figure';

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

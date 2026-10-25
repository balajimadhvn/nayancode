/** A deterministic synthetic plate with 42 separated colonies, used by the demo button and the e2e test. */

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }

export const DEMO_COLONIES = 42;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoPlate(): RgbaImage & { expected: number; pxPerMm: number } {
  const width = 700, height = 500;
  const rnd = seeded(20240517);
  const colonies: { x: number; y: number; r: number }[] = [];
  let guard = 0;
  while (colonies.length < DEMO_COLONIES && guard++ < 100_000) {
    const r = 6 + rnd() * 4;
    const x = 35 + rnd() * (width - 70);
    const y = 35 + rnd() * (height - 70);
    if (colonies.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + 10)) colonies.push({ x, y, r });
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 40 + (rnd() - 0.5) * 6;
      for (const c of colonies) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r) v = 224 + (rnd() - 0.5) * 6;
        else if (d <= c.r + 1.5) v = Math.max(v, 224 - (d - c.r) * 70);
      }
      const i = (y * width + x) * 4;
      const b = Math.max(0, Math.min(255, Math.round(v)));
      data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width, height, data, expected: DEMO_COLONIES, pxPerMm: 25 };
}

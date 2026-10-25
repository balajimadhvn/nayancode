import { describe, expect, it } from 'vitest';
import { demoPlate } from './demo';
import { autoPolarity, filterBySize, gaussianBlur, label, otsu, toGrey } from './seg';

describe('demoPlate', () => {
  it('contains the advertised 42 colonies and counts them with the default pipeline', () => {
    const img = demoPlate();
    expect(img.expected).toBe(42);
    const grey = gaussianBlur(toGrey(img.data), img.width, img.height, 1);
    const invert = autoPolarity(grey, img.width, img.height);
    expect(invert).toBe(false);
    const t = otsu(grey);
    const mask = new Uint8Array(grey.length);
    for (let i = 0; i < grey.length; i++) mask[i] = (invert ? 255 - grey[i] : grey[i]) > t ? 1 : 0;
    const { components } = label(mask, img.width, img.height);
    expect(filterBySize(components, 20, 1_000_000)).toHaveLength(42);
  });
});

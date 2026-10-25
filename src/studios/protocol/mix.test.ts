import { describe, expect, it } from 'vitest';
import { masterMix, volumeLabel } from './mix';

const reagents = [
  { name: 'Buffer', perRxn: 10, unit: 'uL' as const },
  { name: 'dNTP', perRxn: 1, unit: 'uL' as const },
  { name: 'F primer', perRxn: 1, unit: 'uL' as const },
  { name: 'R primer', perRxn: 1, unit: 'uL' as const },
  { name: 'Polymerase', perRxn: 0.5, unit: 'uL' as const },
];

describe('masterMix', () => {
  it('scales the known 8-reaction, 10 % overage example', () => {
    const m = masterMix({ reagents, finalVolume: 20, reactions: 8, overagePct: 10 });
    expect(m.effectiveReactions).toBeCloseTo(8.8, 12);
    m.rows.slice(0, 5).forEach((r, i) => expect(r.totalUl).toBeCloseTo([88, 8.8, 8.8, 8.8, 4.4][i], 9));
    expect(m.waterPerRxn).toBeCloseTo(6.5, 12);
    expect(m.waterTotal).toBeCloseTo(57.2, 9);
    expect(m.rows[5]).toMatchObject({ name: 'Water', kind: 'water' });
    expect(m.rows[5].totalUl).toBeCloseTo(57.2, 9);
    expect(m.perRxnTotal).toBe(20);
    expect(m.masterTotal).toBeCloseTo(176, 9);
    expect(m.dispensePerTube).toBe(20);
  });

  it('uses no overage when the overage is zero', () => {
    const m = masterMix({ reagents, finalVolume: 20, reactions: 8, overagePct: 0 });
    expect(m.rows[0].totalUl).toBe(80);
    expect(m.masterTotal).toBe(160);
  });

  it('converts mL reagents to uL internally', () => {
    const m = masterMix({ reagents: [{ name: 'Buffer', perRxn: 0.5, unit: 'mL' }], finalVolume: 1000, reactions: 1, overagePct: 0 });
    expect(m.rows[0].perRxnUl).toBe(500);
    expect(m.waterPerRxn).toBe(500);
    expect(m.rows[0].totalLabel).toBe('500 uL');
  });

  it('switches the display to mL at 1000 uL', () => {
    expect(volumeLabel(999.9)).toBe('999.9 uL');
    expect(volumeLabel(1000)).toBe('1 mL');
    const m = masterMix({ reagents: [{ name: 'Buffer', perRxn: 125, unit: 'uL' }], finalVolume: 200, reactions: 10, overagePct: 0 });
    expect(m.rows[0].totalUl).toBe(1250);
    expect(m.rows[0].totalLabel).toBe('1.25 mL');
  });

  it('subtracts the template volume from the dispense volume', () => {
    const m = masterMix({ reagents, finalVolume: 20, reactions: 4, overagePct: 0, templatePerRxn: 2 });
    expect(m.dispensePerTube).toBe(18);
    expect(m.templatePerRxn).toBe(2);
  });

  it('rejects reagents that exceed the final volume and names the excess', () => {
    expect(() => masterMix({ reagents, finalVolume: 12, reactions: 1, overagePct: 0 })).toThrow('Reagents exceed the final volume by 1.5 uL.');
  });
});

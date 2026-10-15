import { describe, expect, it } from 'vitest';
import { brandedName } from './filename';

describe('brandedName', () => {
  const d = new Date(2026, 9, 15);
  it('prefixes the brand and adds the date before the extension', () => {
    expect(brandedName('differential_expression.csv', d)).toBe('vivofold-nayancode_differential_expression_2026-10-15.csv');
    expect(brandedName('sorted.bam.bai', d)).toBe('vivofold-nayancode_sorted_2026-10-15.bam.bai');
    expect(brandedName('My tree (ML).nwk', d)).toBe('vivofold-nayancode_My_tree_ML_2026-10-15.nwk');
  });
  it('leaves already-branded names alone', () => {
    expect(brandedName('vivofold-nayancode_x_2026-01-01.csv', d)).toBe('vivofold-nayancode_x_2026-01-01.csv');
  });
});

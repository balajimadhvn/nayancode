import { describe, expect, it } from 'vitest';
import { buildMethods, type ProvRecord } from './provenance';

describe('auto-written Methods', () => {
  it('numbers method references and always cites the Workbench DOI last', () => {
    const rec = { toolId: 'x', toolName: 'Tool', toolVersion: '1', engine: 'TS', citations: ['smyth2004', 'benjamini1995'], params: {}, summary: 'Genes were tested', app: 'Nayancode Workbench 1.0.0' } as unknown as ProvRecord;
    const { text, refs } = buildMethods([rec]);
    expect(text).toContain('Genes were tested (Tool v1, TS). [1][2]');
    expect(text).toContain('with the Nayancode Workbench 1.0.0 [3]');
    expect(refs).toHaveLength(3); expect(refs[2]).toContain('10.5281/zenodo.23393495');
  });
});

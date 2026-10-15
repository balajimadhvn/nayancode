import { describe, expect, it } from 'vitest';
import { parseCivicEvidence, parseClinvarSummary, parseOpenTargets } from './evidence';

describe('evidence parsers (shapes taken from live API responses)', () => {
  it('ClinVar esummary, new and old classification layouts', () => {
    const rows = parseClinvarSummary({ result: { uids: ['1', '2'], '1': { title: 'NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)', germline_classification: { description: 'Pathogenic', review_status: 'reviewed by expert panel', trait_set: [{ trait_name: 'Melanoma' }] }, genes: [{ symbol: 'BRAF' }] }, '2': { title: 'old', clinical_significance: { description: 'Benign', review_status: 'single submitter' } } } });
    expect(rows[0]).toMatchObject({ significance: 'Pathogenic', genes: ['BRAF'], conditions: ['Melanoma'] }); expect(rows[1].significance).toBe('Benign');
    expect(parseClinvarSummary({})).toEqual([]);
  });
  it('CIViC evidence items', () => {
    const r = parseCivicEvidence({ data: { evidenceItems: { nodes: [{ id: 1409, evidenceType: 'PREDICTIVE', evidenceLevel: 'A', significance: 'SENSITIVITYRESPONSE', evidenceDirection: 'SUPPORTS', description: 'Phase 3 …', disease: { name: 'Skin Melanoma' }, therapies: [{ name: 'Vemurafenib' }] }] } } });
    expect(r[0]).toMatchObject({ id: 'EID1409', level: 'A', disease: 'Skin Melanoma', therapies: ['Vemurafenib'] });
  });
  it('Open Targets target', () => {
    const r = parseOpenTargets({ data: { target: { approvedName: 'B-Raf proto-oncogene', functionDescriptions: ['Kinase…'], associatedDiseases: { rows: [{ score: 0.87, disease: { id: 'EFO_1', name: 'melanoma' } }] } } } });
    expect(r.diseases[0]).toEqual({ id: 'EFO_1', name: 'melanoma', score: 0.87 }); expect(r.name).toMatch(/B-Raf/);
  });
});

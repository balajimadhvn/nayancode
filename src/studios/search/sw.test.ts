import { describe, expect, it } from 'vitest';
import { BLOSUM62_MATRIX, encodeResidues, swScore, swTopHits, RESIDUES } from './sw';

// Independent pure-Python Gotoh reference: /tmp/phase4-scratch/sw.py
// It reads B62_ORDER/B62_ROWS from src/studios/sequence/kernels.ts, so both
// implementations use exactly the same BLOSUM62 numbers, gap cost 11 + 1*k.
const PAIRS: [string, string, number][] = [
  ['FSPVDAPWNMMHYKSMNCHNSYHSFPQLHTPQMLDMNFQMLWSN', 'RMHCFVHWFISICQPEPLVATIDRFPGCKKYENEWKLRDQDLALTMDWKWWCATCENGR', 19],
  ['SCHDRLVMSQGNLPRQQTRDFMMDCSNNHLLVKTLGNMPTQRHTNQMFWLRDHPWNVQFRKYRNHWWQIHGKNFF', 'MQYSTWLQEWVDVTWLESRVFGQYAECFRIMAHMWLFAVCWWIWHCDMWYWRFDDQQNSPDMSISVPPRDWGAHEATEMA', 24],
  ['FWQIPWAFNVKTSERYMIRKEIPTMSGPYSTHGTDHRWIYHKDMQYMKHFTKTGACNRAFSQFYRGHTVWIPQTESCNSREENRGQNGCEAQNGKWIARPSHW', 'NVDVLMWMWCLSTGYVYYGWFWQFKDLMYECHKDGRI', 25],
  ['EQMDNIWWSGKYEYSLRMRWKWIKVLGESQQQDCYCLYIMLMHKQCQGPTNIFWPHRKCHASWIQAMNQQIVV', 'CVDCVNSVYQPCENKLCTDYIINLDMSEQGDT', 20],
  ['QGDPMPAVCCMKFRLRREDMQWEMCMHRLIKHYGCNSEEKLFANDMMWPVGSNKGTMRQDKWMTWVGEDWN', 'MQMTHCWPKHVLWSGCHGDDYRPATHPQQHAWYIFESVRIDTEEWKTGAGNWTPHQRINAFQSFFRYGLPDMLK', 28],
  ['QNHWSKWETNPKFGQPFVQAMRHKLCNKKENWASKCEQQFNFPQISKGWFFIDGWDDLKGDRNNQWDNLHFMWRCYSRMYDWMQGQHFWIQSKDHIESFFFGKASNGCCIYD', 'HQMLDNITDCQKCFTTYGFTASCHGEHINLSHAKKKSCLC', 21],
  ['HNPQKEARCIIWCVFQCWKDEGSCNEFWHAGAICRNPYCPYLQARDNDSPAWRLFYWMEPVVDSFMQIPNVWWWCHTYKSTLTQHERC', 'WKVLGFCSACNSMYCLSWHFLVPNLYHATWYMDKVDVNQKVT', 29],
  ['SCGQFTTRQHGTSLGCEYYASYTIGDTDIRHWYHPHTCKFHYTGQMWNACKLWHYHDERWAMIIHWEPAVCERDNFWAL', 'YVLQAFWGSCALQGILDNAFPFWSPKKYFMFFFQSFKNRKTIVYMPPYTPLFFVATINQMWFWESSLDI', 25],
  ['QEGQAEDNHKCMAPTGSHAEHFIQVESLCFMRSWWIMHVAT', 'GFPSTWKCIMKNRQKLDERMVTNHAVEGNMFPFTYWKQGDKHAMRLVAQKQDLFMTIDNN', 20],
  ['QIHYYDWTQEKFSKVGVVSTEYWDKFYIQDPADFYYSKC', 'PGYDQQCCNCLDSHPIQLDPMPPISHHPWKIVHYHLLCMTPHPATMSYVMRMSKRDPGCWRILWEDDNNTMQNIKHDAVYFGQNQHQFDEGDKDAPNSKIQPNYP', 20],
];

describe('Smith-Waterman score (affine Gotoh)', () => {
  it('scores the identical peptide as the sum of BLOSUM62 diagonals', () => {
    // H8 E5 A4 G6 A4 W11 G6 H8 E5 E5 = 62
    expect(swScore('HEAGAWGHEE', 'HEAGAWGHEE')).toBe(62);
  });

  it('matches the independent Python Gotoh on ten seeded random pairs', () => {
    for (const [q, s, expected] of PAIRS) expect(swScore(q, s), `${q.slice(0, 8)}…`).toBe(expected);
  });

  it('charges a two-residue gap 11 + 2', () => {
    // A C D E F G H I K against A C D E F L L G H I K:
    // diagonal BLOSUM62 scores 4+9+6+5+6+6+8+4+5 = 53; the inserted LL is one
    // gap of length 2, cost 11 + 2 = 13; 53 - 13 = 40.
    expect(swScore('ACDEFGHIK', 'ACDEFLLGHIK')).toBe(40);
  });

  it('is symmetric, and an empty sequence scores zero', () => {
    expect(swScore('', 'ACDE')).toBe(0);
    expect(swScore('ACDE', '')).toBe(0);
    for (const [q, s, expected] of PAIRS) expect(swScore(s, q)).toBe(expected);
  });

  it('encodes every matrix letter and sends absent letters to the -1 sentinel', () => {
    expect(RESIDUES).toHaveLength(24);
    expect(Array.from(encodeResidues('ARND')).slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(encodeResidues('J')[0]).toBe(24);
    // X is in BLOSUM62 and keeps its real row, where C-X = -2 and C-C = 9.
    expect(BLOSUM62_MATRIX[RESIDUES.indexOf('X') * 24 + RESIDUES.indexOf('C')]).toBe(-2);
    expect(BLOSUM62_MATRIX[RESIDUES.indexOf('C') * 24 + RESIDUES.indexOf('C')]).toBe(9);
  });
});

describe('swTopHits', () => {
  it('scores the whole database, keeps the best n in score order and counts cells', () => {
    const db = ['AAAA', 'HEAGAWGHEE', 'ACDEFLLGHIK', 'W'];
    const r = swTopHits('HEAGAWGHEE', db, 2);
    expect(Array.from(r.scores)).toEqual([8, 62, 14, 11]);
    expect(r.hits.map((h) => h.index)).toEqual([1, 2]);
    expect(r.cells).toBe(10 * (4 + 10 + 11 + 1));
  });
});

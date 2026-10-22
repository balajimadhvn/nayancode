import { describe, expect, it } from 'vitest';
import { analyseChains, findCdrs, splitScFv } from './cdr';

const TRASTUZUMAB_VH = 'EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS';
const TRASTUZUMAB_VL = 'DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK';
const ADALIMUMAB_VH = 'EVQLVESGGGLVQPGRSLRLSCAASGFTFDDYAMHWVRQAPGKGLEWVSAITWNSGHIDYADSVEGRFTISRDNAKNSLYLQMNSLRAEDTAVYYCAKVSYLSTASSLDYWGQGTLVTVSS';
const ADALIMUMAB_VL = 'DIQMTQSPSSLSASVGDRVTITCRASQGIRNYLAWYQQKPGKAPKLLIYAASTLQSGVPSRFSGSGSGTDFTLTISSLQPEDVATYYCQRYNRAPYTFGQGTKVEIK';

describe('findCdrs: known therapeutics', () => {
  it('trastuzumab VH → H1 DTYIH, H2 RIYPTNGYTRYADSVKG, H3 WGGDGFYAMDY', () => {
    const c = findCdrs(TRASTUZUMAB_VH);
    expect(c.chain).toBe('H');
    expect(c.cdr1).toBe('DTYIH');
    expect(c.cdr2).toBe('RIYPTNGYTRYADSVKG');
    expect(c.cdr3).toBe('WGGDGFYAMDY');
  });

  it('trastuzumab VL → L1 RASQDVNTAVA, L2 SASFLYS, L3 QQHYTTPPT', () => {
    const c = findCdrs(TRASTUZUMAB_VL);
    expect(c.chain).toBe('L');
    expect(c.cdr1).toBe('RASQDVNTAVA');
    expect(c.cdr2).toBe('SASFLYS');
    expect(c.cdr3).toBe('QQHYTTPPT');
  });

  it('adalimumab VH → H1 DYAMH, H2 AITWNSGHIDYADSVEG, H3 VSYLSTASSLDY', () => {
    const c = findCdrs(ADALIMUMAB_VH);
    expect(c.chain).toBe('H');
    expect(c.cdr1).toBe('DYAMH');
    expect(c.cdr2).toBe('AITWNSGHIDYADSVEG');
    expect(c.cdr3).toBe('VSYLSTASSLDY');
  });

  it('adalimumab VL → L1 RASQGIRNYLA, L2 AASTLQS, L3 QRYNRAPYT', () => {
    const c = findCdrs(ADALIMUMAB_VL);
    expect(c.chain).toBe('L');
    expect(c.cdr1).toBe('RASQGIRNYLA');
    expect(c.cdr2).toBe('AASTLQS');
    expect(c.cdr3).toBe('QRYNRAPYT');
  });

  it('CDR positions bracket the CDR strings in the input', () => {
    const c = findCdrs(TRASTUZUMAB_VH);
    expect(TRASTUZUMAB_VH.slice(c.cdr1Pos[0] - 1, c.cdr1Pos[1])).toBe(c.cdr1);
    expect(TRASTUZUMAB_VH.slice(c.cdr2Pos[0] - 1, c.cdr2Pos[1])).toBe(c.cdr2);
    expect(TRASTUZUMAB_VH.slice(c.cdr3Pos[0] - 1, c.cdr3Pos[1])).toBe(c.cdr3);
  });

  it('a random protein is not a VH or VL domain', () => {
    const c = findCdrs('MKKWLLFSAVLVAAQPAMAQTVSGTGGSSTTTGGSSQPAVAAAPSGGSSGAAGGKKDDEEFFYYWW');
    expect(c.chain).toBeNull();
    expect(c.error).toBe('Not recognised as a VH or VL domain');
  });
});

describe('scFv handling', () => {
  it('splits at the (GGGGS)2+ linker and analyses both domains', () => {
    const scfv = TRASTUZUMAB_VH + 'GGGGSGGGGS' + TRASTUZUMAB_VL;
    const split = splitScFv(scfv);
    expect(split).not.toBeNull();
    expect(split!.a).toBe(TRASTUZUMAB_VH);
    expect(split!.b).toBe(TRASTUZUMAB_VL);
    const chains = analyseChains(scfv);
    expect(chains.map((c) => c.cdr.chain)).toEqual(['H', 'L']);
    expect(chains[1].cdr.cdr3).toBe('QQHYTTPPT');
  });
});

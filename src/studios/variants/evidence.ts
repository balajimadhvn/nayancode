/** Clinical / cancer evidence from openly licensed sources only (all queried live, nothing bundled):
 *  ClinVar (NCBI, public domain) · CIViC (CC0) · Open Targets Platform (CC0) · gnomAD via MyVariant.info (CC0).
 *  Deliberately excluded: OncoKB, COSMIC, OMIM, HGMD, DisGeNET, CADD, SpliceAI, dbNSFP (commercial licences). */
import { trackedFetch } from '@/core/net';

export interface ClinvarRow { uid: string; title: string; significance: string; review: string; conditions: string[]; genes: string[] }
export interface CivicRow { id: string; type: string; level: string; significance: string; direction: string; disease: string; therapies: string[]; description: string }
export interface OtDisease { id: string; name: string; score: number }
export interface GeneCard { symbol: string; name: string; summary: string; civicDescription: string; diseases: OtDisease[] }

const json = async (r: Response) => r.json();
const chrom = (c: string) => c.replace(/^chr/i, '');

export function parseClinvarSummary(j: { result?: Record<string, unknown> }): ClinvarRow[] {
  const res = j.result ?? {}; const ids = (res.uids as string[] | undefined) ?? [];
  return ids.map((uid) => {
    const r = res[uid] as { title?: string; germline_classification?: { description?: string; review_status?: string; trait_set?: { trait_name?: string }[] }; clinical_significance?: { description?: string; review_status?: string }; genes?: { symbol?: string }[]; trait_set?: { trait_name?: string }[] };
    const g = r.germline_classification, old = r.clinical_significance;
    return { uid, title: r.title ?? '', significance: g?.description ?? old?.description ?? '–', review: g?.review_status ?? old?.review_status ?? '–', conditions: (g?.trait_set ?? r.trait_set ?? []).map((t) => t.trait_name ?? '').filter(Boolean), genes: (r.genes ?? []).map((x) => x.symbol ?? '').filter(Boolean) };
  });
}
export async function clinvarAtPosition(c: string, pos: number, assembly: 'GRCh38' | 'GRCh37'): Promise<ClinvarRow[]> {
  const f = assembly === 'GRCh38' ? 'chrpos38' : 'chrpos37', term = encodeURIComponent(`${chrom(c)}[chr] AND ${pos}[${f}]`), base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const s = await trackedFetch(`${base}/esearch.fcgi?db=clinvar&term=${term}&retmode=json&retmax=15&tool=workbench`).then(json);
  const ids: string[] = s.esearchresult?.idlist ?? []; if (!ids.length) return [];
  return parseClinvarSummary(await trackedFetch(`${base}/esummary.fcgi?db=clinvar&id=${ids.join(',')}&retmode=json&tool=workbench`).then(json));
}

const CIVIC = 'https://civicdb.org/api/graphql';
const gql = (url: string, query: string) => trackedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }).then(json);
const esc = (s: string) => s.replace(/[^A-Za-z0-9 ._*>-]/g, '');
export function parseCivicEvidence(j: { data?: { evidenceItems?: { nodes?: { id: number; evidenceType: string; evidenceLevel: string; significance: string; evidenceDirection: string; description: string; disease?: { name: string }; therapies?: { name: string }[] }[] } } }): CivicRow[] {
  return (j.data?.evidenceItems?.nodes ?? []).map((n) => ({ id: `EID${n.id}`, type: n.evidenceType, level: n.evidenceLevel, significance: n.significance, direction: n.evidenceDirection, disease: n.disease?.name ?? '–', therapies: (n.therapies ?? []).map((t) => t.name), description: n.description ?? '' }));
}
export async function civicEvidence(molecularProfile: string): Promise<{ rows: CivicRow[]; total: number }> {
  const j = await gql(CIVIC, `{ evidenceItems(status: ACCEPTED, first: 25, molecularProfileName: "${esc(molecularProfile)}") { totalCount nodes { id evidenceType evidenceLevel significance evidenceDirection description disease { name } therapies { name } } } }`);
  if (j.errors) throw new Error('CIViC: ' + (j.errors[0]?.message ?? 'query failed'));
  return { rows: parseCivicEvidence(j), total: j.data?.evidenceItems?.totalCount ?? 0 };
}

export function parseOpenTargets(j: { data?: { target?: { approvedName?: string; functionDescriptions?: string[]; associatedDiseases?: { rows?: { score: number; disease: { id: string; name: string } }[] } } } }): { name: string; summary: string; diseases: OtDisease[] } {
  const t = j.data?.target; return { name: t?.approvedName ?? '', summary: t?.functionDescriptions?.[0] ?? '', diseases: (t?.associatedDiseases?.rows ?? []).map((r) => ({ id: r.disease.id, name: r.disease.name, score: r.score })) };
}
export async function geneCard(symbol: string): Promise<GeneCard> {
  const OT = 'https://api.platform.opentargets.org/api/v4/graphql', sym = esc(symbol).toUpperCase();
  const s = await gql(OT, `{ search(queryString: "${sym}", entityNames: ["target"], page: { index: 0, size: 3 }) { hits { id name entity } } }`);
  const hit = (s.data?.search?.hits ?? []).find((h: { name: string }) => h.name.toUpperCase() === sym) ?? s.data?.search?.hits?.[0]; if (!hit) throw new Error(`No Open Targets entry for “${symbol}”.`);
  const [ot, cv] = await Promise.all([gql(OT, `{ target(ensemblId: "${hit.id}") { approvedName functionDescriptions associatedDiseases(page: { index: 0, size: 12 }) { rows { score disease { id name } } } } }`), gql(CIVIC, `{ genes(entrezSymbols: ["${sym}"], first: 1) { nodes { description } } }`).catch(() => null)]);
  const p = parseOpenTargets(ot); return { symbol: sym, name: p.name, summary: p.summary, civicDescription: cv?.data?.genes?.nodes?.[0]?.description ?? '', diseases: p.diseases };
}

/** Population allele frequency (gnomAD, CC0) through MyVariant.info. Only openly licensed fields are requested. */
export async function gnomadFrequency(c: string, pos: number, ref: string, alt: string, assembly: 'GRCh38' | 'GRCh37'): Promise<{ genome: number | null; exome: number | null; rsid: string | null } | null> {
  if (ref.length !== 1 || alt.length !== 1) return null; // SNVs only in this lookup
  const hgvs = `chr${chrom(c)}:g.${pos}${ref}>${alt}`, fields = 'gnomad_genome.af.af,gnomad_exome.af.af,dbsnp.rsid';
  const r = await fetch(`https://myvariant.info/v1/variant/${encodeURIComponent(hgvs)}?assembly=${assembly === 'GRCh38' ? 'hg38' : 'hg19'}&fields=${fields}`); if (r.status === 404) return null; if (!r.ok) throw new Error(`MyVariant.info responded ${r.status}`);
  const j = await r.json(); return { genome: j.gnomad_genome?.af?.af ?? null, exome: j.gnomad_exome?.af?.af ?? null, rsid: j.dbsnp?.rsid ?? null };
}

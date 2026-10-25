/** Master-mix scaling: per-reaction volumes, overage, water and dispense volume. */

export type VolumeUnit = 'uL' | 'mL';
export interface MixReagent { name: string; perRxn: number; unit: VolumeUnit }
export interface MixOptions {
  reagents: MixReagent[];
  finalVolume: number;
  reactions: number;
  overagePct: number;
  waterName?: string;
  /** Template volume added separately to each tube (uL). */
  templatePerRxn?: number;
}
export interface MixRow {
  name: string;
  kind: 'reagent' | 'water';
  perRxnUl: number;
  totalUl: number;
  perRxnLabel: string;
  totalLabel: string;
}
export interface MasterMix {
  rows: MixRow[];
  effectiveReactions: number;
  sumReagentsPerRxn: number;
  waterPerRxn: number;
  waterTotal: number;
  /** Final volume per reaction, including water. */
  perRxnTotal: number;
  /** Final volume of the whole master mix, including overage. */
  masterTotal: number;
  /** Volume of master mix to dispense into each tube. */
  dispensePerTube: number;
  templatePerRxn: number;
}

const trim = (v: number) => String(+v.toFixed(4));
const toUl = (r: MixReagent) => (r.unit === 'mL' ? r.perRxn * 1000 : r.perRxn);

/** Display switches to mL at >= 1000 uL. */
export function volumeLabel(ul: number): string {
  return ul >= 1000 ? `${trim(ul / 1000)} mL` : `${trim(ul)} uL`;
}

export function masterMix(o: MixOptions): MasterMix {
  const { reagents, finalVolume, reactions, overagePct, waterName = 'Water', templatePerRxn = 0 } = o;
  if (!Number.isFinite(finalVolume) || finalVolume <= 0) throw new Error('Final volume must be greater than zero.');
  if (!Number.isFinite(reactions) || reactions <= 0) throw new Error('The number of reactions must be greater than zero.');
  if (!Number.isFinite(overagePct) || overagePct < 0) throw new Error('Overage must be zero or more.');
  if (!Number.isFinite(templatePerRxn) || templatePerRxn < 0) throw new Error('Template volume must be zero or more.');
  const sumReagentsPerRxn = reagents.reduce((s, r) => s + toUl(r), 0);
  if (!Number.isFinite(sumReagentsPerRxn)) throw new Error('Every reagent volume must be a number.');
  const waterPerRxn = finalVolume - sumReagentsPerRxn;
  if (waterPerRxn < 0) throw new Error(`Reagents exceed the final volume by ${trim(-waterPerRxn)} uL.`);
  if (templatePerRxn > finalVolume) throw new Error(`Template volume exceeds the final volume by ${trim(templatePerRxn - finalVolume)} uL.`);
  const effectiveReactions = reactions * (1 + overagePct / 100);
  const rows: MixRow[] = reagents.map((r) => {
    const perRxnUl = toUl(r);
    const totalUl = perRxnUl * effectiveReactions;
    return { name: r.name, kind: 'reagent', perRxnUl, totalUl, perRxnLabel: volumeLabel(perRxnUl), totalLabel: volumeLabel(totalUl) };
  });
  const waterTotal = waterPerRxn * effectiveReactions;
  if (waterPerRxn > 0) rows.push({ name: waterName, kind: 'water', perRxnUl: waterPerRxn, totalUl: waterTotal, perRxnLabel: volumeLabel(waterPerRxn), totalLabel: volumeLabel(waterTotal) });
  return {
    rows, effectiveReactions, sumReagentsPerRxn, waterPerRxn, waterTotal,
    perRxnTotal: finalVolume, masterTotal: finalVolume * effectiveReactions,
    dispensePerTube: finalVolume - templatePerRxn, templatePerRxn,
  };
}

/** Five generic protocol templates. Volumes are editable starting points, not manufacturer instructions. */
import type { Protocol } from './format';

const NOTE = "Generic starting point. Check against your lab's validated SOP and the manufacturer's instructions.";

export const TEMPLATES: Protocol[] = [
  {
    title: 'PCR with Taq polymerase',
    description: 'A generic endpoint PCR for a plasmid or purified template.',
    note: NOTE,
    steps: [
      { text: 'Thaw the 2× PCR master mix, primers and template on ice; mix each tube gently.', minutes: 5, note: 'Keep the polymerase out of direct light.' },
      { text: 'Assemble the master mix for the number of reactions plus overage. Add template separately to each tube.', minutes: 10 },
      { text: 'Run the thermal cycle: initial denaturation, 25–35 cycles of denaturation, annealing and extension, then a final extension.', note: 'Use an annealing temperature about 3–5 °C below the lower primer Tm and an extension time suited to the amplicon length.' },
      { text: 'Hold at 4 °C, then check 2–5 µL on an agarose gel against a size ladder.', minutes: 30 },
    ],
    mix: { reagents: [{ name: '2× PCR master mix', perRxn: 10, unit: 'uL' }, { name: 'Forward primer (10 µM)', perRxn: 1, unit: 'uL' }, { name: 'Reverse primer (10 µM)', perRxn: 1, unit: 'uL' }], finalVolume: 20, reactions: 1, overagePct: 10, templatePerRxn: 1 },
  },
  {
    title: 'Colony PCR',
    description: 'Screen bacterial colonies for a plasmid insert without a purification step.',
    note: NOTE,
    steps: [
      { text: 'Pick a single colony with a sterile tip and patch it onto a labelled master plate.', note: 'Keep the patch plate as the source for the positive clone.' },
      { text: 'Resuspend the rest of the colony in 20–50 µL of water or buffer; use 1–2 µL as template.', minutes: 5 },
      { text: 'Assemble the colony-PCR master mix and add template to each tube.', minutes: 10 },
      { text: 'Run the PCR with a slightly longer initial denaturation to lyse the cells, then analyse the products on a gel.', minutes: 90 },
    ],
    mix: { reagents: [{ name: '2× PCR master mix', perRxn: 10, unit: 'uL' }, { name: 'Forward primer (10 µM)', perRxn: 0.5, unit: 'uL' }, { name: 'Reverse primer (10 µM)', perRxn: 0.5, unit: 'uL' }], finalVolume: 20, reactions: 1, overagePct: 10, templatePerRxn: 2 },
  },
  {
    title: 'Plasmid miniprep (alkaline lysis)',
    description: 'Small-scale alkaline-lysis plasmid preparation; steps only.',
    note: NOTE,
    steps: [
      { text: 'Inoculate 2–5 mL of selective medium from a single colony and grow overnight with shaking.', minutes: 16 * 60 },
      { text: 'Pellet the cells, discard the supernatant and resuspend the pellet completely in resuspension buffer.', minutes: 5 },
      { text: 'Add lysis buffer, mix gently and incubate for a few minutes; do not vortex.', minutes: 5, note: 'Stop before the lysate clears completely.' },
      { text: 'Add neutralisation buffer, mix gently and centrifuge to pellet the white precipitate.', minutes: 10 },
      { text: 'Load the cleared supernatant onto the column, wash and elute plasmid DNA with the supplied buffer.', minutes: 15 },
      { text: 'Measure concentration and check purity; store the DNA cold.', minutes: 5 },
    ],
  },
  {
    title: 'Bacterial heat-shock transformation',
    description: 'Generic chemical-competent cell transformation with a heat pulse.',
    note: NOTE,
    steps: [
      { text: 'Thaw an aliquot of competent cells on ice; do not refreeze.', minutes: 10 },
      { text: 'Add 1–5 µL of plasmid or ligation mix, mix gently and incubate on ice.', minutes: 30 },
      { text: 'Heat-shock in a water bath or heat block at the temperature validated for the strain, then return to ice.', minutes: 2 },
      { text: 'Add recovery medium and incubate with shaking to let the cells recover.', minutes: 60 },
      { text: 'Plate a range of dilutions on selective agar and incubate overnight.', minutes: 16 * 60 },
    ],
  },
  {
    title: 'SDS-PAGE gel loading',
    description: 'Prepare and load a denaturing protein gel; steps only.',
    note: NOTE,
    steps: [
      { text: 'Mix each sample with loading buffer and heat according to the sample type.', minutes: 10 },
      { text: 'Assemble the gel tank, fill with running buffer and flush the wells.', minutes: 5 },
      { text: 'Load the molecular-weight ladder and the samples with a gel-loading tip.', minutes: 5 },
      { text: 'Run at a constant voltage until the dye front reaches the bottom of the gel.', minutes: 60, note: 'Watch the current; stop if it rises sharply.' },
      { text: 'Remove the gel and stain or transfer it as required.', minutes: 30 },
    ],
  },
];

export const templateByTitle = (title: string) => TEMPLATES.find((t) => t.title === title);

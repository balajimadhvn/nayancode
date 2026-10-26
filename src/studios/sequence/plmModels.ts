export interface PlmModelDef {
  id: string;
  label: string;
  params: string;
  sizeMb: number;
  /** URL to download ONNX model; leave empty for bundled/local models */
  url: string;
  sha256?: string;
  licence: string;
  source: string;
  bundled?: boolean;
  layers?: number;
}

export const PLM_MODELS: PlmModelDef[] = [
  {
    id: 'esm2_t6_8M_UR50D',
    label: 'ESM-2 8M',
    params: '8M',
    sizeMb: 30,
    url: '',
    licence: 'MIT',
    source: 'Xenova/esm2_t6_8M_UR50D',
    bundled: true,
    layers: 6,
  },
  {
    id: 'esm2_t12_35M_UR50D',
    label: 'ESM-2 35M',
    params: '35M',
    sizeMb: 140,
    url: '',
    licence: 'MIT',
    source: 'facebook/esm2_t12_35M_UR50D',
    bundled: false,
    layers: 12,
  },
  {
    id: 'esm2_t30_150M_UR50D',
    label: 'ESM-2 150M',
    params: '150M',
    sizeMb: 600,
    url: '',
    licence: 'MIT',
    source: 'facebook/esm2_t30_150M_UR50D',
    bundled: false,
    layers: 30,
  },
];

export function getModelDef(id: string) {
  return PLM_MODELS.find((m) => m.id === id) ?? PLM_MODELS[0];
}

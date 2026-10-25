/** Protocol serialisation, Markdown export and duration formatting. Never executes imported content. */
import type { MixReagent } from './mix';

export interface ProtocolStep { text: string; minutes?: number; note?: string }
export interface ProtocolMix {
  reagents: MixReagent[];
  finalVolume: number;
  reactions: number;
  overagePct: number;
  templatePerRxn?: number;
  waterName?: string;
}
export interface Protocol { title: string; description?: string; note?: string; steps: ProtocolStep[]; mix?: ProtocolMix }

export type ParseResult = { ok: true; protocol: Protocol } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanStep(raw: unknown): ProtocolStep | null {
  if (!isRecord(raw) || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  const step: ProtocolStep = { text: raw.text.trim() };
  if (finite(raw.minutes) && raw.minutes > 0) step.minutes = raw.minutes;
  if (typeof raw.note === 'string' && raw.note.trim()) step.note = raw.note.trim();
  return step;
}

function cleanMix(raw: unknown): ProtocolMix | undefined {
  if (!isRecord(raw)) return undefined;
  const reagents = Array.isArray(raw.reagents) ? raw.reagents.flatMap((r) => {
    if (!isRecord(r) || typeof r.name !== 'string' || !r.name.trim() || !finite(r.perRxn) || r.perRxn < 0) return [];
    return [{ name: r.name.trim(), perRxn: r.perRxn, unit: r.unit === 'mL' ? 'mL' as const : 'uL' as const }];
  }) : [];
  if (!reagents.length || !finite(raw.finalVolume) || !finite(raw.reactions)) return undefined;
  return {
    reagents, finalVolume: raw.finalVolume, reactions: raw.reactions,
    overagePct: finite(raw.overagePct) ? raw.overagePct : 0,
    ...(finite(raw.templatePerRxn) ? { templatePerRxn: raw.templatePerRxn } : {}),
    ...(typeof raw.waterName === 'string' && raw.waterName.trim() ? { waterName: raw.waterName.trim() } : {}),
  };
}

/** Validates and trims an imported protocol; unknown keys are ignored. */
export function fromJson(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'The file is not valid JSON.' }; }
  if (!isRecord(raw)) return { ok: false, error: 'The JSON must be an object with a title and steps.' };
  if (typeof raw.title !== 'string' || !raw.title.trim()) return { ok: false, error: 'The protocol is missing a title.' };
  if (!Array.isArray(raw.steps)) return { ok: false, error: 'The protocol is missing a steps array.' };
  const steps = raw.steps.map(cleanStep).filter((s): s is ProtocolStep => s !== null);
  const protocol: Protocol = { title: raw.title.trim(), steps };
  if (typeof raw.description === 'string' && raw.description.trim()) protocol.description = raw.description.trim();
  if (typeof raw.note === 'string' && raw.note.trim()) protocol.note = raw.note.trim();
  const mix = cleanMix(raw.mix);
  if (mix) protocol.mix = mix;
  return { ok: true, protocol };
}

export function toJson(protocol: Protocol): string {
  return JSON.stringify(protocol, null, 2);
}

export function toMarkdown(protocol: Protocol): string {
  const out: string[] = [`# ${protocol.title}`];
  if (protocol.description) out.push('', protocol.description);
  out.push('', ...protocol.steps.map((s, i) => {
    const mins = s.minutes ? ` (${s.minutes} min)` : '';
    return `${i + 1}. ${s.text}${mins}${s.note ? `\n   > ${s.note}` : ''}`;
  }));
  if (protocol.mix) {
    out.push('', '## Master mix', '', '| Reagent | Per reaction |', '| --- | --- |');
    for (const r of protocol.mix.reagents) out.push(`| ${r.name} | ${r.perRxn} ${r.unit} |`);
    out.push('', `Final volume ${protocol.mix.finalVolume} uL; ${protocol.mix.reactions} reaction(s); ${protocol.mix.overagePct} % overage.`);
  }
  if (protocol.note) out.push('', `_${protocol.note}_`);
  return out.join('\n');
}

/** `3909 -> 1:05:09`, `270 -> 4:30`; seconds are floored and clamped at zero. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

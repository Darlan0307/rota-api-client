import {
  DEFAULT_EVIDENCE_INCLUDE,
  DEFAULT_EVIDENCE_OPTIONS,
  type EvidenceInclude,
  type EvidenceOptions,
} from '@rota/core/shared';

/**
 * O que vem marcado ao abrir o relatório. Fica só nesta máquina: título,
 * texto livre, ambiente e nomes dos envios são de cada relatório e não entram.
 */
export type EvidencePreset = Pick<
  EvidenceOptions,
  | 'include'
  | 'hideTechnicalHeaders'
  | 'maskSensitive'
  | 'extraMaskedFields'
  | 'maxBodyChars'
  | 'cardBodyLines'
  | 'notesHeading'
  | 'footer'
>;

const KEY = 'rota:evidence-defaults';

export const ROTA_PRESET: EvidencePreset = {
  include: DEFAULT_EVIDENCE_INCLUDE,
  hideTechnicalHeaders: DEFAULT_EVIDENCE_OPTIONS.hideTechnicalHeaders,
  maskSensitive: DEFAULT_EVIDENCE_OPTIONS.maskSensitive,
  extraMaskedFields: DEFAULT_EVIDENCE_OPTIONS.extraMaskedFields,
  maxBodyChars: DEFAULT_EVIDENCE_OPTIONS.maxBodyChars,
  cardBodyLines: DEFAULT_EVIDENCE_OPTIONS.cardBodyLines,
  notesHeading: DEFAULT_EVIDENCE_OPTIONS.notesHeading,
  footer: DEFAULT_EVIDENCE_OPTIONS.footer,
};

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const int = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

/** Valores lidos com conferência campo a campo: um valor estranho volta ao padrão do Rota. */
export function normalizePreset(raw: unknown): EvidencePreset {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EvidencePreset, unknown>>;
  const savedInclude = (p.include && typeof p.include === 'object' ? p.include : {}) as Record<
    string,
    unknown
  >;
  const include = Object.fromEntries(
    Object.entries(DEFAULT_EVIDENCE_INCLUDE).map(([k, v]) => [k, bool(savedInclude[k], v)]),
  ) as unknown as EvidenceInclude;
  return {
    include,
    hideTechnicalHeaders: bool(p.hideTechnicalHeaders, ROTA_PRESET.hideTechnicalHeaders),
    maskSensitive: bool(p.maskSensitive, ROTA_PRESET.maskSensitive),
    extraMaskedFields: text(p.extraMaskedFields, ROTA_PRESET.extraMaskedFields),
    maxBodyChars: int(p.maxBodyChars, ROTA_PRESET.maxBodyChars, 500, 500_000),
    cardBodyLines: int(p.cardBodyLines, ROTA_PRESET.cardBodyLines, 3, 200),
    notesHeading: text(p.notesHeading, ROTA_PRESET.notesHeading),
    footer: text(p.footer, ROTA_PRESET.footer),
  };
}

export function loadPreset(): EvidencePreset {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? normalizePreset(JSON.parse(saved)) : ROTA_PRESET;
  } catch {
    return ROTA_PRESET;
  }
}

export function savePreset(preset: EvidencePreset): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(preset));
    return true;
  } catch {
    return false;
  }
}

export function presetOf(options: EvidenceOptions): EvidencePreset {
  return normalizePreset(options);
}

export function samePreset(a: EvidencePreset, b: EvidencePreset): boolean {
  return JSON.stringify(normalizePreset(a)) === JSON.stringify(normalizePreset(b));
}

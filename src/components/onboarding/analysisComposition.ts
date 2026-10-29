import { displayLineHeight } from '../../theme/tokens';

/**
 * The analysis screen's geometry and vertical arithmetic, kept free of React
 * Native so it can be unit-tested in this project's Node-only suite (which
 * cannot import a component module at all).
 *
 * Presentation only. Nothing here reads app state and no value is derived
 * from a domain rule.
 */

/** Ring geometry, straight from the design: full size, and the reduced one. */
export const ANALYSIS_RING = {
  regular: { size: 184, radius: 76, stroke: 9, bot: 96 },
  compact: { size: 156, radius: 64, stroke: 9, bot: 80 },
} as const;

export interface AnalysisRingGeometry {
  size: number;
  radius: number;
  stroke: number;
  bot: number;
}

/** The celebration bounce lands just after the ring fills, not with it. */
export const ANALYSIS_HOP_DELAY_MS = 200;

/**
 * Every vertical value in the analysis composition, in one place, because
 * the screen has to both *render* them and *add them up* — see
 * `analysisComposition`.
 */
export const ANALYSIS_LAYOUT = {
  paddingTop: 17,
  paddingBottom: 36,
  ringGap: 10,
  percentGap: 18,
  titleGap: 10,
  speechMinHeight: 44,
  speechGap: 16,
  rowGap: 10,
  /** The indicator is the tallest thing in a row, so it sets the row's content height. */
  rowIndicator: 26,
  rowBorder: 2,
  reviewGap: 18,
  reviewMinHeight: 44,
  titleSize: { regular: 32, compact: 28 },
  rowPaddingVertical: { regular: 13, compact: 11 },
} as const;

/**
 * Tightened vertical rhythm, for a caller whose composition is shorter than
 * the one the design sheet was drawn for.
 *
 * Only the gaps move; every *object* (ring, percentage, title, speech box,
 * rows, review link) keeps its own size, so this reads as the same screen
 * breathing less, not as a different layout. The onboarding analysis never
 * uses it: its two-line title and five first-time steps genuinely fill the
 * screen, and the original spacing is what the design specifies.
 */
export const ANALYSIS_DENSE_GAPS = {
  paddingTop: 14,
  paddingBottom: 28,
  ringGap: 8,
  percentGap: 12,
  titleGap: 8,
  speechGap: 14,
  rowGap: 8,
  reviewGap: 14,
} as const;

/**
 * Plain `number`s, not `ANALYSIS_LAYOUT`'s literal types: `as const` makes
 * `paddingTop` the type `17`, which a tightened `14` could never satisfy.
 */
export type AnalysisGaps = Record<
  | 'paddingTop' | 'paddingBottom' | 'ringGap' | 'percentGap' | 'titleGap'
  | 'speechMinHeight' | 'speechGap' | 'rowGap' | 'reviewGap' | 'reviewMinHeight',
  number
>;

/** The resolved gap set. `dense: false` is `ANALYSIS_LAYOUT`, value for value. */
export function analysisGaps(dense: boolean): AnalysisGaps {
  const base: AnalysisGaps = {
    paddingTop: ANALYSIS_LAYOUT.paddingTop,
    paddingBottom: ANALYSIS_LAYOUT.paddingBottom,
    ringGap: ANALYSIS_LAYOUT.ringGap,
    percentGap: ANALYSIS_LAYOUT.percentGap,
    titleGap: ANALYSIS_LAYOUT.titleGap,
    speechMinHeight: ANALYSIS_LAYOUT.speechMinHeight,
    speechGap: ANALYSIS_LAYOUT.speechGap,
    rowGap: ANALYSIS_LAYOUT.rowGap,
    reviewGap: ANALYSIS_LAYOUT.reviewGap,
    reviewMinHeight: ANALYSIS_LAYOUT.reviewMinHeight,
  };
  return dense ? { ...base, ...ANALYSIS_DENSE_GAPS } : base;
}

export type AnalysisVariant = 'regular' | 'compact';

export interface AnalysisCompositionOptions {
  /**
   * Lines the title occupies. Onboarding's is two ("Montando" / "seu plano");
   * the swap's is one ("Trocando treino"), which is 46pt of reserved height
   * that would otherwise become empty space above the checklist.
   */
  titleLines?: number;
  dense?: boolean;
}

export interface AnalysisComposition {
  variant: AnalysisVariant;
  ring: AnalysisRingGeometry;
  titleSize: number;
  rowPaddingVertical: number;
  /** Resolved gaps, so the screen renders the exact values this math used. */
  gaps: AnalysisGaps;
  titleLines: number;
}

/**
 * Picks between the design's two sizes by what actually fits.
 *
 * The design sheet keys this to a ≤667pt screen, which is right for the web
 * prototype but not for the app: the title and the percentage are Anton, and
 * Anton has to be laid out at `displayLineHeight` (1.45x) or iOS crops the
 * top of the glyphs — see the note on that helper. On a two-line title that
 * alone costs ~44pt the prototype never paid, and the "revisar respostas"
 * link the prototype doesn't have costs another 62. So the threshold is
 * computed from the composition itself instead of hardcoded, and a ~390x844
 * phone lands on `compact`, with the full-size ring kept for the screens
 * that genuinely have room. The checklist still scrolls as a last resort, so
 * nothing is ever cut off.
 *
 * `availableHeight` is the window minus the top inset; the bottom inset is
 * already covered by `paddingBottom`.
 */
export function analysisComposition(
  availableHeight: number,
  stepCount: number,
  options?: AnalysisCompositionOptions,
): AnalysisComposition {
  const titleLines = options?.titleLines ?? 2;
  const dense = options?.dense ?? false;
  const variant: AnalysisVariant =
    analysisRequiredHeight('regular', stepCount, options) <= availableHeight ? 'regular' : 'compact';
  return {
    variant,
    ring: ANALYSIS_RING[variant],
    titleSize: ANALYSIS_LAYOUT.titleSize[variant],
    rowPaddingVertical: ANALYSIS_LAYOUT.rowPaddingVertical[variant],
    gaps: analysisGaps(dense),
    titleLines,
  };
}

/** Height the composition occupies at `variant`, top padding to bottom padding. */
export function analysisRequiredHeight(
  variant: AnalysisVariant,
  stepCount: number,
  options?: AnalysisCompositionOptions,
): number {
  const L = ANALYSIS_LAYOUT;
  const G = analysisGaps(options?.dense ?? false);
  const titleLines = options?.titleLines ?? 2;
  const rowHeight = L.rowPaddingVertical[variant] * 2 + L.rowIndicator + L.rowBorder;
  return G.paddingTop
    + ANALYSIS_RING[variant].size + G.ringGap
    + displayLineHeight(26) + G.percentGap
    + displayLineHeight(L.titleSize[variant]) * titleLines + G.titleGap
    + G.speechMinHeight + G.speechGap
    + stepCount * rowHeight + Math.max(0, stepCount - 1) * G.rowGap
    + G.reviewMinHeight + G.reviewGap
    + G.paddingBottom;
}

/**
 * Where AJ looks while a given step is active: a small lean toward that row
 * plus a glance down at the list. Completion recentres him.
 */
export function analysisLookAt(index: number, count: number): readonly [number, number] {
  if (count <= 1) return [0, 2.4];
  return [(index / (count - 1) - 0.5) * 1.6, 2.4];
}

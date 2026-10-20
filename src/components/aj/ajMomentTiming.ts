/**
 * Timing and layout constants for `AjMoment` and the moments built on it.
 *
 * Kept in a React-free module for the same reason `ajBotMotion.ts` is: this
 * project's test suite runs in plain Node and cannot import anything that
 * pulls in React Native, so a number that matters has to live somewhere a
 * test can read it directly.
 */

/**
 * Delay between tapping an answer and the real action firing — exactly the
 * window AJ's hop and the other answers' dismissal need to be seen. The
 * caller's handler is otherwise untouched.
 */
export const AJ_ANSWER_COMMIT_DELAY_MS = 520;

export const AJ_BACKDROP_FADE_IN_MS = 500;
export const AJ_BACKDROP_FADE_OUT_MS = 600;
/**
 * The wash starts fading only after AJ has committed to leaving, so he exits
 * through it instead of it vanishing from under him.
 */
export const AJ_BACKDROP_FADE_OUT_DELAY_MS = 100;
export const AJ_ANSWER_RISE_MS = 400;
export const AJ_ANSWER_RISE_STAGGER_MS = 80;
export const AJ_ANSWER_DISMISS_MS = 300;
/** The close button waits a beat so it never competes with AJ's entrance. */
export const AJ_CLOSE_BUTTON_DELAY_MS = 800;
export const AJ_BOT_SIZE = 104;

/**
 * Height of `AppShell`'s TabBar excluding its own bottom safe-area inset,
 * summed from that component's real paddings (8 + 7 + 9 + 22 icon + 4 gap +
 * ~11 label + 7 + 7 + 6). There is no height token to read, so this is the
 * one number the overlay needs in order to keep the last answer clear of the
 * bar instead of hardcoding a screen-total that would break on any device
 * whose bottom inset differs.
 */
export const AJ_MOMENT_TAB_BAR_HEIGHT = 81;

/** How long Home must be settled and in focus before AJ shows up uninvited. */
export const AJ_CYCLE_PAUSED_DELAY_MS = 1400;

/* ────────────────────────────────────────────────────────────────────────────
 * Acquisition choreography — Questionnaire / Plan / Auth / Paywall.
 *
 * Every number below is an offset in ms from a single trigger (a tap, a step
 * mount, a sheet opening), transcribed from the approved prototype's own
 * timeline. They live here, as data, for the same reason the rest of this
 * module does: the test suite runs in plain Node and cannot render React
 * Native, so a timing that matters has to be readable without a renderer.
 *
 * Reduce Motion never reinterprets these schedules — it collapses them (see
 * `AJ_REDUCED_*` at the bottom). A reduced run must never sit through a hold
 * that only existed to let an animation finish.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Per-character typing cadence, by surface. The design paces each screen differently. */
export const AJ_TYPING_MS_PER_CHAR = {
  /** Question titles, and the reaction lines that follow a key answer. */
  question: 18,
  reaction: 18,
  /** The oversized first line of an interstitial. */
  headline: 24,
  plan: 22,
  auth: 21,
  paywall: 21,
} as const;

/** Delay before a question title starts typing, measured from the step mount. */
export const AJ_TYPING_QUESTION_DELAY_MS = 420;

/** Pause between one line finishing and the next starting, for chained speech. */
export const AJ_TYPING_CHAIN_GAP_MS = 600;

/** Plan narration pauses a beat longer than Auth/Paywall between its five lines. */
export const AJ_TYPING_PLAN_CHAIN_GAP_MS = 650;

/**
 * Mounting a question step. `travelTo` fires immediately because the stage
 * move and the content rise are one gesture, not a sequence.
 */
export const AJ_QUESTION_STEP = {
  contentRiseMs: 400,
  /** Stagger between sibling items inside the rising content block. */
  contentRiseStaggerMs: 50,
  /** The oversized outline number takes nearly twice as long to settle. */
  outlineRiseMs: 700,
  /** Answers stay untouchable until the title finishes typing, then cross in. */
  answersFadeMs: 300,
} as const;

/**
 * Single-choice selection — the design's signature move. Offsets from the tap:
 * the chosen row lifts to the centre of the screen while the others sink, AJ
 * flies down and shrinks onto that row's radio, bounces, and only then does
 * the reaction (or the advance) happen.
 */
export const AJ_PERCH_RADIO = {
  /** The chosen row's rise to screen centre. */
  liftMs: 750,
  liftBezier: [0.25, 0.8, 0.3, 1] as const,
  /** Mid-flight stop of the lift, as a fraction of `liftMs`. */
  liftMidProgress: 0.28,
  liftMidTranslateFraction: 0.12,
  liftMidScale: 0.94,
  liftMidOpacity: 0.85,
  /** Largest the chosen row is allowed to grow, as a scale factor. */
  liftMaxScale: 1.12,
  /** The rows that were not chosen. */
  sinkMs: 300,
  sinkTranslateY: 16,
  /** AJ leaves for the radio once the lift is visibly under way. */
  travelAtMs: 420,
  /** AJ's size once perched, before the row's own `scale` is applied. */
  perchedSize: 34,
  /** The radio under AJ shrinks out from under him. */
  radioExitMs: 250,
  radioExitScale: 0.4,
  hopAtMs: 1100,
  /** Reaction line starts, or the step advances, here. */
  resolveAtMs: 1800,
} as const;

/**
 * Every other answer kind (multi, date, ruler, compound, pickers): AJ stays in
 * the question corner, acknowledges with a nod, and the step resolves much
 * sooner — there is no flight to wait for.
 */
export const AJ_ANSWER_ACKNOWLEDGE = {
  resolveAtMs: 820,
} as const;

/** How long the reaction line stays on screen after it finishes typing. */
export const AJ_REACT_HOLD_MS = 950;

/** AJ's pose for a reaction, as fractions of the screen. */
export const AJ_REACT_STAGE = {
  size: 96,
  /** Top of the mascot box, as a fraction of screen height. */
  yFraction: 0.25,
  /** Distance from the top of the mascot box down to the spoken line. */
  speechOffsetY: 146,
} as const;

/** Interstitials and the other question-free steps. */
export const AJ_INTERSTITIAL = {
  size: 116,
  /** Video interstitials keep AJ small and at the top, above the player. */
  videoSize: 76,
  videoOffsetY: 69,
  videoSpeechOffsetY: 167,
  yFraction: 0.25,
  speechOffsetY: 146,
  hopAtMs: 650,
} as const;

/** The safety-notice sheet (`ProfessionalClearanceModal`). */
export const AJ_GATE = {
  backdropFadeMs: 300,
  sheetRiseMs: 450,
  sheetRiseBezier: [0.2, 0.9, 0.3, 1] as const,
  /** AJ sets off once the sheet is most of the way up. */
  travelAtMs: 470,
  /** AJ's size while perched on the sheet's top edge. */
  size: 80,
  /** How far above the sheet's measured top edge the mascot box sits. */
  perchOffsetY: 46,
  titleTypesAtMs: 520,
  bodyRiseAtMs: 900,
  ctaRiseAtMs: 1100,
  nodAtMs: 1100,
} as const;

/** The Plan screen's narration. */
export const AJ_PLAN = {
  travelAtMs: 120,
  sheetRiseAtMs: 400,
  hopAtMs: 1000,
  firstLineAtMs: 1000,
  /** Gap after a line finishes before the nod/glance that precedes the next. */
  lineSettleMs: 500,
  /** Gap from that nod to the next line starting. */
  nextLineAtMs: 900,
  /** The narration switches to the Diet tab as its fourth line begins. */
  dietLineIndex: 3,
  tabCrossFadeMs: 350,
  tabCrossFadeTranslateX: 14,
  /** CTA tap: AJ bounces, leaves, and only then is `onContinue` called. */
  ctaExitAtMs: 300,
  ctaExitMs: 600,
  ctaContinueAtMs: 900,
} as const;

/** Auth and Paywall share one opening schedule. */
export const AJ_SHEET_SCREEN = {
  travelAtMs: 80,
  sheetRiseAtMs: 500,
  hopAtMs: 1000,
  firstLineAtMs: 1000,
  /** Auth form sub-steps focus their first field once the sheet has settled. */
  autoFocusAtMs: 350,
} as const;

/** Paywall-only: the close affordance waits so it never competes with AJ. */
export const AJ_PAYWALL_CLOSE_RISE_AT_MS = 2000;

/** Content entering a sheet or a step: the design's "rise". */
export const AJ_RISE = {
  durationMs: 400,
  translateY: 14,
  /** Stagger between sibling items. The design gives a 40–60ms window. */
  staggerMs: 50,
} as const;

/** A bottom sheet arriving. */
export const AJ_SHEET_RISE = {
  durationMs: 500,
  translateY: 14,
  bezier: [0.2, 0.9, 0.3, 1] as const,
} as const;

/**
 * Reduce Motion. Two rules cover every schedule above:
 *
 * 1. Anything that existed to be *watched* is gone — travel, lift, sink, hop,
 *    float, lean, per-character typing.
 * 2. Anything that existed to be *waited through* is capped, so a reduced run
 *    is never slower than an unreduced one. A reaction still has to be
 *    readable, so it is capped rather than removed.
 */
export const AJ_REDUCED_TRANSITION_MS = 250;
export const AJ_REDUCED_HOLD_MS = 300;

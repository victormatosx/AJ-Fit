/**
 * Display-name resolution for a `FinalWorkoutSession.name` — never rendered
 * raw in the UI. T001–T090's canonical `name` field mixes already-correct
 * Portuguese phrases ("Aeróbico contínuo") with English/gym-shorthand codes
 * ("Push", "Bench", bare "A"/"B") with no i18n of its own — the exact set
 * catalogued from `docs/workouts/AJ_Fit_T001_T090_workouts_canonical_v1_3.json`
 * (47 distinct values as of this audit).
 *
 * `name` stays the STRUCTURAL identity (session identity, exercise
 * selection continuity, `programIdentity()` hashing, etc. all key off it
 * unchanged) — this module only ever affects what a human reads. `type`
 * (`resistance`/`strength`/`cardio`/`circuit`/`mixed`/`functional_strength`/
 * `interval`/`recovery`/`balance_cardio` — the session's OWN small closed
 * enum) is the fallback layer for a `name` this table doesn't recognize yet
 * (e.g. a future T091+ introducing a new name before a translator adds it
 * here) — never the raw name itself, unless even `type` is unrecognized.
 *
 * Mirrors `WorkoutScreen.tsx`'s existing `translateExerciseName` pattern
 * exactly (same `defaultValue`-probe shape) so both live under the same
 * "known machine value → i18n lookup → graceful fallback" convention;
 * kept here (not inline in `WorkoutScreen.tsx`) so it is a reusable,
 * independently testable layer per docs, not a component-local helper.
 */

export type LooseTranslate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Session `type` → i18n key suffix under `workout:sessionTypes`. Deliberately
 * a small, closed map mirroring the canonical schema's own `type` enum —
 * never inferred/guessed from `name`.
 */
const SESSION_TYPE_KEYS: Record<string, string> = {
  resistance: 'resistance',
  strength: 'strength',
  cardio: 'cardio',
  circuit: 'circuit',
  mixed: 'mixed',
  functional_strength: 'functionalStrength',
  interval: 'interval',
  recovery: 'recovery',
  balance_cardio: 'balanceCardio',
};

/**
 * Resolves the human-facing label for a session. Fallback chain:
 *   1. `workout:sessionNames.{name}` — the exact catalogued name (pt-BR/en/es).
 *   2. `workout:sessionTypes.{type}` — the session's own type enum, for a
 *      `name` this table doesn't know yet.
 *   3. `name` itself — last resort, never throws, never renders nothing;
 *      no worse than the pre-Phase-2 behavior for a name genuinely new to
 *      both tables.
 */
export function resolveSessionDisplayName(t: LooseTranslate, name: string, type: string): string {
  // Namespace-qualified (`workout:...`), never a bare key — this is called
  // from screens whose own default namespace is NOT `workout` (e.g.
  // `HomeScreen`'s `home`/`profile`), and i18next only resolves an
  // unprefixed key against the caller's own default namespace.
  const nameKey = `workout:sessionNames.${name}`;
  const byName = t(nameKey, { defaultValue: '' });
  if (byName && byName !== nameKey) return byName;

  const typeSlug = SESSION_TYPE_KEYS[type];
  if (typeSlug) {
    const typeKey = `workout:sessionTypes.${typeSlug}`;
    const byType = t(typeKey, { defaultValue: '' });
    if (byType && byType !== typeKey) return byType;
  }

  return name;
}

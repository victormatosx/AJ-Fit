/**
 * Display-name resolution for a `FinalWorkoutSession.name` — never rendered
 * raw in the UI. T001–T090's canonical `name` field mixes already-correct
 * Portuguese phrases ("Aeróbico contínuo") with English/gym-shorthand codes
 * ("Push", "Bench", bare "A"/"B") with no i18n of its own — the exact set
 * catalogued from `docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json`
 * (47 distinct values as of this audit).
 *
 * `name` is the session's AUTHORIAL identity — both structural (session
 * identity, exercise selection continuity, `programIdentity()` hashing) and
 * presentational: it is what a human should read when this table has no
 * nicer phrasing for it yet. `type` (`resistance`/`strength`/`cardio`/
 * `circuit`/`mixed`/`functional_strength`/`interval`/`recovery`/
 * `balance_cardio`) is a coarse modality classifier and must NEVER stand in
 * for `name` — doing so collapses distinct sessions (e.g. every T091+
 * "Push"/"Pull"/"Legs" session, all `type: "resistance"`) onto one generic
 * label. A template introducing a session name this table doesn't recognize
 * yet (e.g. a future T103+) falls straight through to its own raw `name`,
 * never to `type`.
 *
 * Mirrors `WorkoutScreen.tsx`'s existing `translateExerciseName` pattern
 * exactly (same `defaultValue`-probe shape) so both live under the same
 * "known machine value → i18n lookup → graceful fallback" convention;
 * kept here (not inline in `WorkoutScreen.tsx`) so it is a reusable,
 * independently testable layer per docs, not a component-local helper.
 */

export type LooseTranslate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Resolves the human-facing label for a session. Fallback chain:
 *   1. `workout:sessionDisplayNames.{displayName}` — localized presentation
 *      of an authored `display_name`, when the template provides one.
 *   2. `workout:sessionNames.{name}` — the exact catalogued name (pt-BR/en/es).
 *   3. `name` itself — the session's own authorial name, always. Never the
 *      session `type` (a modality, not an identity) — a name this table
 *      doesn't recognize yet must still read as that session's own name.
 */
export function resolveSessionDisplayName(
  t: LooseTranslate,
  name: string,
  type: string,
  displayName?: string,
): string {
  void type;
  // `display_name` is authored in pt-BR, so it is never rendered directly.
  // It is a stable lookup value whose localized presentation lives in i18n.
  if (displayName) {
    const displayKey = `workout:sessionDisplayNames.${displayName}`;
    const byDisplayName = t(displayKey, { defaultValue: '' });
    if (byDisplayName && byDisplayName !== displayKey) return byDisplayName;
  }
  // Namespace-qualified (`workout:...`), never a bare key — this is called
  // from screens whose own default namespace is NOT `workout` (e.g.
  // `HomeScreen`'s `home`/`profile`), and i18next only resolves an
  // unprefixed key against the caller's own default namespace.
  const nameKey = `workout:sessionNames.${name}`;
  const byName = t(nameKey, { defaultValue: '' });
  if (byName && byName !== nameKey) return byName;

  return name;
}

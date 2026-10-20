/**
 * A tiny synchronous seam announcing "the user just registered a NEW food
 * entry", so the daily activity streak can refresh and decide whether a
 * milestone was reached.
 *
 * Deliberately a signal, not a counter: it carries no streak state and the
 * listener always re-derives the streak from Firestore. Repeated or
 * duplicated signals are therefore harmless — the same reason the workout
 * side re-reads instead of incrementing.
 *
 * Emitted ONLY from `addDiaryFood` (a genuinely new inclusion). Editing
 * grams, moving an item between meals and deleting never emit: by the
 * product rule those are not new engagement, and an edit must never
 * manufacture a streak day. Deletion is still reflected, just not here — the
 * next read sees `loggedItemCount` and recomputes.
 *
 * Mirrors the established pattern in `src/lib/subscriptionCelebration.ts`.
 */

type NutritionActivityListener = () => void;

const listeners = new Set<NutritionActivityListener>();

/** Called by `addDiaryFood` after the write has durably resolved. */
export function emitNutritionActivityRegistered(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A listener failure must never surface as a diary write failure —
      // the food is already saved and that is what matters.
    }
  });
}

export function subscribeToNutritionActivity(listener: NutritionActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

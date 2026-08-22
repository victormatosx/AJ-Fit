import AsyncStorage from '@react-native-async-storage/async-storage';

import { logError } from '../lib/logger';

/**
 * Storage key for `WorkoutScreen`'s "permanent" (until changed again)
 * exercise-substitution preferences (`permSubs`) — Fase 11 audit finding.
 *
 * Extracted out of the screen component so it has a single source of truth
 * shared with the account-deletion shutdown routine
 * (`accountDeletionShutdown.ts`), which is the only other place allowed to
 * touch this key.
 *
 * Not yet uid-namespaced — `WorkoutScreen` has no `useAuth()`/uid of its own
 * today (it renders from the static `TODAY_WORKOUT` constant, not a
 * Firestore-backed per-user workout document). Until that screen is wired to
 * real per-user data, the safest available fix is clearing this key
 * unconditionally on account deletion, exactly like `clearOnboardingDraft()`
 * already does for the onboarding draft — this closes the account-deletion
 * leak gate even though it does not yet give this key uid-scoped isolation
 * for a plain (non-deletion) account switch on the same device.
 */
export const WORKOUT_SUBSTITUTIONS_STORAGE_KEY = 'ajfit-subs';

export async function clearWorkoutSubstitutionPreferences(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WORKOUT_SUBSTITUTIONS_STORAGE_KEY);
  } catch (err) {
    logError('workoutSubstitutionsStorage:clear', err);
  }
}

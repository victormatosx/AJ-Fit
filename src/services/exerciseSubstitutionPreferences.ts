import {
  collection,
  getDocs,
  onSnapshot,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { logInfo, logWarn } from '../lib/logger';

const USERS = 'users';
const EXERCISE_SUBSTITUTION_PREFERENCES = 'exerciseSubstitutionPreferences';

export type PermanentExerciseSubstitutionPreferences = ReadonlyMap<string, string>;

type PreferenceDocument = {
  id: string;
  data: () => DocumentData;
};

/** Parses the whole user collection in one pass; malformed entries fail closed individually. */
export function permanentExerciseSubstitutionPreferencesFromDocuments(
  documents: readonly PreferenceDocument[],
): Map<string, string> {
  const preferences = new Map<string, string>();
  for (const item of documents) {
    const data = item.data();
    const preferredExerciseId = data.preferredExerciseId;
    if (typeof preferredExerciseId !== 'string' || preferredExerciseId.length === 0) continue;
    // The document id is the canonical prescribed anchor. Do not reinterpret
    // sourceExerciseId (or any payload field) as that identity.
    preferences.set(item.id, preferredExerciseId);
  }
  return preferences;
}

function preferencesCollection(uid: string) {
  return collection(db, USERS, uid, EXERCISE_SUBSTITUTION_PREFERENCES);
}

/** One batched collection read, shared by new-execution materialization. */
export async function loadPermanentExerciseSubstitutionPreferences(
  uid: string,
): Promise<Map<string, string>> {
  const snapshot = await getDocs(preferencesCollection(uid));
  return permanentExerciseSubstitutionPreferencesFromDocuments(snapshot.docs);
}

/**
 * One collection listener for Meu Plano. It delivers the complete preference
 * map on initial load and on create/update/delete, so returning to the kept-
 * alive screen never depends on a restart or on polling. A read/listener
 * failure explicitly publishes an empty map (safe prescribed-plan fallback).
 */
export function subscribeToPermanentExerciseSubstitutionPreferences(
  uid: string,
  onPreferences: (preferences: Map<string, string>) => void,
): Unsubscribe {
  const startedAtMs = Date.now();
  return onSnapshot(
    preferencesCollection(uid),
    (snapshot) => {
      const preferences = permanentExerciseSubstitutionPreferencesFromDocuments(snapshot.docs);
      logInfo('my_plan', 'substitution_preferences_loaded', {
        durationMs: Date.now() - startedAtMs,
        resultCount: snapshot.size,
      });
      onPreferences(preferences);
    },
    (error) => {
      logWarn('my_plan', 'substitution_preferences_failed_fail_open', {
        durationMs: Date.now() - startedAtMs,
        code: error.code,
      });
      onPreferences(new Map());
    },
  );
}

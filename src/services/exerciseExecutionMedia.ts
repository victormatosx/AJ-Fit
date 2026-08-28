/**
 * Own-video lookup for the in-session exercise UI (`WorkoutScreen`/
 * `ExerciseGif`) — deliberately separate from `workoutPrograms.ts`'s
 * `loadExerciseCatalogForLimitations`, which is the Limitation Resolver's
 * exclusive I/O boundary and fetches the ENTIRE exercise collection with
 * strict shape validation. This fetches only `execution` (the admin-panel
 * video slots) for the small set of exercise ids actually in the current
 * session, via a targeted `documentId() in [...]` query — never the whole
 * catalog, and never on the generation/prescription path.
 */
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logWarn } from '../lib/logger';
import type { ExerciseExecution } from '../types/exercise';

const EXERCISES = 'exercises';
// Firestore `in` queries accept at most 30 values per query.
const FIRESTORE_IN_CHUNK_SIZE = 30;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function isExecutionShape(value: unknown): value is ExerciseExecution {
  return typeof value === 'object' && value !== null;
}

/**
 * Best-effort — a failed/partial lookup must never block or crash the
 * workout UI, only fall through to the fallback library/unavailable state
 * (`ExerciseGif`'s own priority chain). Ids with no document, no
 * `execution`, or a malformed `execution` are simply absent from the
 * returned map.
 */
export async function loadExerciseExecutionMedia(
  exerciseIds: string[],
): Promise<Record<string, ExerciseExecution>> {
  const uniqueIds = [...new Set(exerciseIds)];
  if (uniqueIds.length === 0) return {};
  const media: Record<string, ExerciseExecution> = {};
  try {
    for (const idsChunk of chunk(uniqueIds, FIRESTORE_IN_CHUNK_SIZE)) {
      const snapshot = await getDocs(
        query(collection(db, EXERCISES), where(documentId(), 'in', idsChunk)),
      );
      for (const docSnapshot of snapshot.docs) {
        const execution = docSnapshot.data()?.execution;
        if (isExecutionShape(execution)) media[docSnapshot.id] = execution;
      }
    }
  } catch (error) {
    logWarn('workout', 'exercise_execution_media_load_failed', { error });
    return {};
  }
  return media;
}

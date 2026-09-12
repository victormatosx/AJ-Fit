/**
 * Regression guard for item #7 (exercise execution video priority).
 *
 * Real bug found by git-history audit: `ExerciseGif`'s fallback library
 * (`LOCAL_VIDEOS` + the free-exercise-db remote frames, both present since
 * the file's first commit — nothing was ever deleted from it) was never
 * actually "removed"; the gap was that the exercise's own Firestore/admin
 * video (`exercises/{id}.execution.videos`) was never read or passed in at
 * all, so an own video could never take priority over the fallback even
 * when one existed. `ExerciseGif.tsx`/`expo-video` can't be imported into
 * this Node-environment Vitest config, so — per this codebase's convention
 * for such files — these are structural source assertions.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const GIF_SRC = readFileSync(new URL('../../components/fitness/ExerciseGif.tsx', import.meta.url), 'utf8');
const WORKOUT_SRC = readFileSync(new URL('../../screens/WorkoutScreen.tsx', import.meta.url), 'utf8');

describe('ExerciseGif — own video > fallback library > unavailable', () => {
  it('accepts an ownVideo prop and resolves it before the local/remote fallbacks', () => {
    expect(GIF_SRC).toContain("ownVideo?: ExerciseExecution['videos'];");
    const resolveIdx = GIF_SRC.indexOf('const resolvedSource =');
    const ownVideoIdx = GIF_SRC.indexOf('const ownVideoForOrientation =');
    const localSourceIdx = GIF_SRC.indexOf('const localSource =');
    expect(ownVideoIdx).toBeGreaterThan(-1);
    expect(localSourceIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeGreaterThan(Math.max(ownVideoIdx, localSourceIdx));
    expect(GIF_SRC).toContain(
      'const resolvedSource = ownVideoForOrientation ? ownVideoForOrientation.url : localSource;',
    );
  });

  it('picks vertical/horizontal by the same portrait check the fallback already uses', () => {
    expect(GIF_SRC).toContain(
      'const ownVideoForOrientationRaw = isPortrait ? ownVideo?.vertical : ownVideo?.horizontal;',
    );
  });

  it('a video that fails to actually play (statusChange "error") falls through to the next priority tier instead of staying blank', () => {
    expect(GIF_SRC).toContain("import { useEventListener } from 'expo';");
    expect(GIF_SRC).toContain("useEventListener(player, 'statusChange', ({ status, error }) => {");
    expect(GIF_SRC).toContain("if (status !== 'error') return;");
    // Failure is scoped per (id, own-video URL, orientation) — a different
    // exercise/orientation always gets a clean attempt.
    expect(GIF_SRC).toContain(
      "const identityKey = `${id ?? ''}|${ownVideoForOrientationRaw?.url ?? ''}|${isPortrait}`;",
    );
    expect(GIF_SRC).toContain('const ownVideoForOrientation = ownFailed ? undefined : ownVideoForOrientationRaw;');
    expect(GIF_SRC).toContain('const localSource = localFailed ? null : localSourceRaw;');
  });

  it('the player and the free-exercise-db cross-fade both key off resolvedSource, not localSource alone', () => {
    expect(GIF_SRC).toContain('useVideoPlayer(resolvedSource,');
    expect(GIF_SRC).toContain('if (resolvedSource || ownVideoLoading) return;');
    expect(GIF_SRC).toContain('if (resolvedSource) {');
    // The pre-existing fallback library itself must still be intact —
    // nothing invented, nothing deleted.
    expect(GIF_SRC).toContain('LOCAL_VIDEOS');
    expect(GIF_SRC).toContain("DB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises'");
  });

  it('never renders the fallback library while ownVideoLoading is true and no source has resolved yet — no flash of the wrong demo ahead of a real own video', () => {
    expect(GIF_SRC).toContain('ownVideoLoading?: boolean;');
    expect(GIF_SRC).toContain('ownVideoLoading = false');
    const resolvedIdx = GIF_SRC.indexOf('if (resolvedSource) {');
    const loadingIdx = GIF_SRC.indexOf('if (ownVideoLoading) {');
    const failedIdx = GIF_SRC.indexOf('if (failed || !id) {');
    expect(loadingIdx).toBeGreaterThan(-1);
    // Order matters: an own video that HAS arrived always wins even while
    // loading was recently true; the loading branch only applies before
    // that, and must be checked before ever falling to the placeholder/
    // crossfade fallback.
    expect(loadingIdx).toBeGreaterThan(resolvedIdx);
    expect(failedIdx).toBeGreaterThan(loadingIdx);
  });

  it('resolves the free-exercise-db fallback id through EXERCISE_FALLBACK_VIDEO_ID (our catalog ids are not free-exercise-db ids since the 116-exercise migration)', () => {
    expect(GIF_SRC).toContain(
      "import { EXERCISE_FALLBACK_VIDEO_ID } from '../../data/exerciseFallbackVideoMap';",
    );
    expect(GIF_SRC).toContain(
      'const fallbackVideoId = id ? (EXERCISE_FALLBACK_VIDEO_ID[id] ?? id) : null;',
    );
    // Both crossfade frames must use the mapped id, never the raw catalog id.
    expect(GIF_SRC).toContain('uri: `${DB_BASE}/${fallbackVideoId}/0.jpg`');
    expect(GIF_SRC).toContain('uri: `${DB_BASE}/${fallbackVideoId}/1.jpg`');
    expect(GIF_SRC).not.toContain('uri: `${DB_BASE}/${id}/0.jpg`');
    expect(GIF_SRC).not.toContain('uri: `${DB_BASE}/${id}/1.jpg`');
  });
});

describe('WorkoutScreen — wires the session\'s own-video lookup into every ExerciseGif', () => {
  it('fetches media for the effective exercise in every slot, including persisted/manual substitutions', () => {
    expect(WORKOUT_SRC).toContain(
      "import { useExerciseExecutionMedia } from '../workoutExecution/useExerciseExecutionMedia';",
    );
    expect(WORKOUT_SRC).toContain(
      '() => exercises.map((exercise, index) => substitutions[index]?.exerciseId ?? exercise.id),',
    );
    expect(WORKOUT_SRC).toContain(
      'const { media: exerciseExecutionMedia, loading: exerciseMediaLoading } = useExerciseExecutionMedia(',
    );
    expect(WORKOUT_SRC).toContain('exerciseMediaIds,');
  });

  it('passes ownVideo through at all three ExerciseGif call sites (banner, fullscreen modal, sub-option thumbnail)', () => {
    const occurrences = WORKOUT_SRC.match(/ownVideo={exerciseExecutionMedia\[[^\]]+\]\?\.videos}/g) ?? [];
    expect(occurrences.length).toBe(3);
    expect(WORKOUT_SRC.match(/ownVideo={exerciseExecutionMedia\[ex\.db\]\?\.videos}/g)).toHaveLength(2);
    expect(WORKOUT_SRC).not.toContain('ownVideo={exerciseExecutionMedia[ex.id]?.videos}');
  });

  it('passes ownVideoLoading through at all three ExerciseGif call sites too — without it the fallback library would flash ahead of a real own video', () => {
    const occurrences = WORKOUT_SRC.match(/ownVideoLoading={exerciseMediaLoading}/g) ?? [];
    expect(occurrences.length).toBe(3);
  });
});

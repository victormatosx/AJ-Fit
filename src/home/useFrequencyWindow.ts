import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { logWarn } from '../lib/logger';
import { addDaysLocal, type LocalDate } from '../scheduleEngine/calendar';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { listCompletedWorkoutDatesInRange } from '../services/workoutExecutions';
import {
  buildFrequencyWindow,
  frequencyWindowNeedsPromotion,
  frequencyWindowBounds,
  mergeCoveredFrom,
  type FrequencyWindowViewModel,
} from './frequencyHeatmap';
import type { InitialSectionStatus } from './homeInitialReadiness';

export interface FrequencyWindowState {
  /** `null` only until the very first window has ever resolved — never goes back to `null` afterward, even mid-navigation to an uncovered period (see module doc). */
  viewModel: FrequencyWindowViewModel | null;
  /** True while the *currently selected* window's data isn't available yet — `viewModel` is still showing the previous window; UI may dim, must never unmount/resize for this. */
  loading: boolean;
  initialStatus: InitialSectionStatus;
  /** False on the current (most recent) window — never navigate into the future. */
  canGoNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  reload: () => Promise<void>;
}

/**
 * Presentation-only pagination (`offsetWindows`) over the same canonical
 * `workoutExecutions` completion dates `useWorkoutActivitySnapshot` uses for
 * "esta semana" — never persisted, always resets to the current 30-day
 * window on remount.
 *
 * Caching: the fetched range always starts at `today` and only grows
 * backward as the user pages into older windows, so paging back re-fetches
 * exactly the newly-needed days once, and paging forward again is always
 * free (already in `completedDates`). Never a query per cell/window.
 *
 * ## Why `viewModel` never goes back to `null` mid-navigation
 *
 * The previous implementation derived `viewModel` with a plain `useMemo`
 * keyed on `offsetWindows`, returning `null` whenever the *selected* window
 * wasn't covered by the cache yet. `HomeScreen` renders the whole "Sua
 * frequência" section (including its wrapping `<View>`) conditionally on
 * `frequencyWindow` being non-null — so on every cache MISS, for the entire
 * gap between the tap and the fetch resolving, the section (and its height)
 * disappeared from the tree. That shrank the Home `ScrollView`'s content
 * height, which made it clamp/snap the current scroll offset — the
 * "scroll to top" bug. On a cache HIT the new window was available
 * synchronously in the same render, so `viewModel` was never `null` and the
 * section never unmounted — matching the reported HIT/MISS split exactly.
 *
 * The fix: `viewModel` here is `displayedViewModel`, only ever replaced
 * once the *selected* window's data is actually available. While a
 * newly-selected window is still loading, the previously displayed window
 * keeps rendering (stale-but-stable) — the section's mounted subtree/height
 * never changes; only `loading` flips so the UI can dim in place. Promoting
 * newly-available data to `displayedViewModel` is done with the "adjust
 * state during render" pattern (a plain, synchronous, side-effect-free
 * comparison + `setState` in the render body — see
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-
 * state-when-a-prop-changes) so a cache HIT still commits in the very same
 * paint as before the fix (no added flicker); only fetching itself
 * (a real side effect) lives in `useEffect`.
 */
export function useFrequencyWindow(timezone: string): FrequencyWindowState {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [offsetWindows, setOffsetWindows] = useState(0);
  const [completedDates, setCompletedDates] = useState<ReadonlySet<LocalDate>>(new Set());
  const [displayedOffset, setDisplayedOffset] = useState<number | null>(null);
  const [displayedViewModel, setDisplayedViewModel] = useState<FrequencyWindowViewModel | null>(null);
  const [displayedDates, setDisplayedDates] = useState<ReadonlySet<LocalDate> | null>(null);
  // Oldest local date already covered by a fetch; the covered range's upper
  // bound is implicitly always "today" (never null once uid resolves).
  // Only ever moves backward (see `ensureCovered`) — a slower request that
  // needed a smaller range must never regress coverage a faster/deeper
  // concurrent request already established.
  const coveredFromRef = useRef<LocalDate | null>(null);
  const inFlightRequestIdRef = useRef(0);
  const [loadingRequestId, setLoadingRequestId] = useState<number | null>(null);
  const [initialStatus, setInitialStatus] = useState<InitialSectionStatus>(uid ? 'PENDING' : 'NOT_APPLICABLE');

  const today = uid ? localDateInTimezone(new Date(), timezone) : null;

  const ensureCovered = useCallback(async (neededFromLocalDate: LocalDate, todayLocalDate: LocalDate) => {
    if (!uid) return;
    if (coveredFromRef.current !== null && neededFromLocalDate >= coveredFromRef.current) return;
    const rangeTo = coveredFromRef.current ? addDaysLocal(coveredFromRef.current, -1) : todayLocalDate;
    const requestId = ++inFlightRequestIdRef.current;
    setLoadingRequestId(requestId);
    try {
      const dates = await listCompletedWorkoutDatesInRange(uid, neededFromLocalDate, rangeTo);
      setCompletedDates((previous) => new Set([...previous, ...dates]));
      coveredFromRef.current = mergeCoveredFrom(coveredFromRef.current, neededFromLocalDate);
      setInitialStatus((previous) => previous === 'PENDING' ? 'SUCCESS' : previous);
    } catch (error) {
      logWarn('home_frequency', 'load_failed', { error });
      // A failed first read is a terminal ERROR presentation, not an
      // infinite loading state. Mark the requested range as covered with the
      // already-known empty/previous set so the normal synchronous promotion
      // below builds and commits the final fallback grid before Home reveals.
      coveredFromRef.current = mergeCoveredFrom(coveredFromRef.current, neededFromLocalDate);
      setCompletedDates((previous) => new Set(previous));
      setInitialStatus((previous) => previous === 'PENDING' ? 'ERROR' : previous);
    } finally {
      // Only the most recently *issued* request clears the loading flag —
      // an older, slower request resolving after a newer one must not mask
      // the newer one still being in flight.
      setLoadingRequestId((current) => (current === requestId ? null : current));
    }
  }, [uid]);

  // Real side effect (network I/O) — stays in an effect. A no-op once the
  // selected window is already covered.
  useEffect(() => {
    if (!uid || !today) return;
    const { startLocalDate } = frequencyWindowBounds(today, offsetWindows);
    void ensureCovered(startLocalDate, today);
    // `today` intentionally excluded: it only changes across a day
    // boundary, which a fresh Home mount already re-evaluates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, offsetWindows, ensureCovered]);

  // Pure, synchronous promotion of already-available data — see module doc
  // for why this runs during render rather than in an effect.
  if (today) {
    const { startLocalDate } = frequencyWindowBounds(today, offsetWindows);
    const isCovered = coveredFromRef.current !== null && startLocalDate >= coveredFromRef.current;
    if (frequencyWindowNeedsPromotion({
      isCovered,
      displayedOffset,
      selectedOffset: offsetWindows,
      displayedDates,
      completedDates,
    })) {
      setDisplayedOffset(offsetWindows);
      setDisplayedDates(completedDates);
      setDisplayedViewModel(buildFrequencyWindow({ todayLocalDate: today, offsetWindows, completedDates }));
    }
  }

  const reload = useCallback(async () => {
    if (!uid || !today) return;
    coveredFromRef.current = null;
    setOffsetWindows(0);
    const { startLocalDate } = frequencyWindowBounds(today, 0);
    await ensureCovered(startLocalDate, today);
  }, [uid, today, ensureCovered]);

  const goPrev = useCallback(() => setOffsetWindows((previous) => previous + 1), []);
  const goNext = useCallback(() => setOffsetWindows((previous) => Math.max(0, previous - 1)), []);

  return {
    viewModel: displayedViewModel,
    loading: displayedOffset !== offsetWindows || loadingRequestId !== null,
    initialStatus,
    canGoNext: offsetWindows > 0,
    goPrev,
    goNext,
    reload,
  };
}

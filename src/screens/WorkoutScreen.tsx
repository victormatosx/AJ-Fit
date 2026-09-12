import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  Animated,
  Easing,
  Keyboard,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { CtaButton } from '../components/ui/CtaButton';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { CardioSessionContent } from '../components/workout/CardioSessionContent';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { ExerciseGif } from '../components/fitness/ExerciseGif';
import { useExerciseExecutionMedia } from '../workoutExecution/useExerciseExecutionMedia';
import { displayLineHeight, radii, sizes, spacing } from '../theme/tokens';
import { darkTheme, useTheme } from '../theme';
import { logInfo, logWarn } from '../lib/logger';
import type { FinalCardioFinisher, FinalWorkoutPlan } from '../workoutPrescription/types';
import { useUnits } from '../state/UnitsContext';
import { usePremiumCapabilities } from '../hooks/usePremiumCapabilities';
import {
  adjustWorkoutLoadKg,
  formatWorkoutLoadFromKg,
  workoutLoadFromKg,
  workoutLoadToKg,
  workoutLoadUnit,
} from '../units/workoutLoadConversions';
import { resolveSessionDisplayName } from '../workoutPrescription/sessionPresentation';
import {
  canRevertToAnchor,
  exerciseDisplayName,
  exerciseDisplayTarget,
  resolveDisplayCandidates,
  type ManualSubstitutionUserContext,
} from '../services/exerciseSubstitutionCandidates';
import type { ExerciseSubstitutionScope } from '../services/exerciseSubstitution';
import { resolveCardioFinisherPresentation } from '../workoutPrescription/cardioPresentation';
import {
  canSkipExercise,
  workoutExercisesFromPlan,
  pluralCountForReps,
  type Exercise,
  type SetData,
  type SubOption,
} from './workoutScreenPlan';
import { computeRemainingSeconds, computeRestProgress } from '../lib/restTimer';
import { deriveWorkoutHydration } from '../workoutExecution/hydration';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { computeWorkoutElapsedSeconds } from '../lib/workoutSessionTimer';
import { useRestSession } from '../state/RestSessionContext';
import {
  cardioProgressRatio,
  computeCardioElapsedSeconds,
  createCardioSession,
  crossedCardioTarget,
  extendCardioTarget,
  finishCardio,
  formatCardioClock,
  parsePrescribedCardioDurationSeconds,
  remainingCardioSeconds,
  startCardio,
  type CardioSession,
} from '../lib/cardioTimer';
import {
  clearCardioSession,
  persistCardioSession,
  readCardioSession,
} from '../services/cardioSessionStorage';

type Props = {
  plan: FinalWorkoutPlan;
  /** Leaves the completion screen only after the durable finish chain succeeds. */
  onDone: () => void;
  onRetryCompletion: () => void;
  /** Leaves an execution that was durably abandoned, without running the finish chain. */
  onDiscarded: () => void;
  onMinimize?: () => void;
  /** Which session in `plan.sessions` to run — decided by the Schedule Engine (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md). Defaults to 0 for callers that haven't wired schedule resolution yet. */
  sessionIndex?: number;
  /**
   * The Firestore-backed execution this screen is running against —
   * `useWorkoutExecution().execution`, docs/workout-lifecycle/
   * 09_WORKOUT_EXECUTION_AND_HISTORY.md. This is the single source of truth
   * for progress (Workout Recovery / Resume após process death): local
   * `order`/`progress`/`logged` are all reverse-derived from it once, on
   * mount, via `deriveWorkoutHydration` — a freshly-started execution (every
   * set PENDING) derives to the same empty defaults this screen already
   * used before `execution` existed, so this is safe to pass unconditionally
   * whether the session was just started or is being resumed after the app
   * was killed mid-`IN_PROGRESS`. `null` only during the brief window before
   * the first `start()`/`adoptExecution()` call has resolved.
   */
  execution?: PersistedWorkoutExecution | null;
  /**
   * Canonical start instant for THIS session's duration timer, epoch ms —
   * from `useWorkoutExecution().workoutStartedAtMs` (backed by the persisted
   * `PersistedWorkoutExecution.startedAt`, docs/workout-lifecycle/
   * 09_WORKOUT_EXECUTION_AND_HISTORY.md). The displayed elapsed time is
   * always `now - workoutStartedAtMs`, never a tick count, so it stays
   * correct across background/lock/cold start. `null` only while the very
   * first `start()` call hasn't produced even its local fallback yet —
   * falls back to "now" for that one render.
   */
  workoutStartedAtMs?: number | null;
  /**
   * Fires once, the moment the session is ready for the durable finish chain
   * (`execution.finish()` -> `completeScheduledSession()` -> lifecycle) —
   * distinct from `onDone` (which also fires on an early exit/X tap). This is
   * what the Schedule Engine listens to advance the rotation. `recovery: true`
   * means this fired from this screen's INITIAL mount state (a resumed
   * session that was already fully done — strength-only, or cardio already
   * durably COMPLETED — when the app died before `finish()` ran last time),
   * not from a fresh user action just now (docs — Cardio Finisher Completion
   * Recovery hardening; used only for observability, never changes behavior).
   */
  onSessionCompleted?: (context: { recovery: boolean }) => void;
  /**
   * True while `onSessionCompleted`'s durable finish chain is still in
   * flight — drives `WorkoutDone`'s "Finalizando treino..." state so the
   * success screen never lets the user believe the session is durably done,
   * or navigate away, before it actually is (docs — Cardio Finisher
   * Completion Recovery hardening).
   */
  finishing?: boolean;
  /** True only after Execution terminal + Schedule completion are both durable. */
  completionConfirmed?: boolean;
  /** Timestamp captured at the durable boundary, used only for DEV performance telemetry. */
  durableCompletionReachedAtMs?: number | null;
  /** Durable finish or schedule completion failed; keep this screen mounted and turn the CTA into an explicit retry. */
  completionFailed?: boolean;
  /** Fires once a set's weight is actually logged (docs/workout-lifecycle/09_WORKOUT_EXECUTION_AND_HISTORY.md) — `exerciseIndex` matches this exercise's position in `plan.sessions[sessionIndex].exercises`, the same identity the Execution record uses. */
  onSetLogged?: (exerciseIndex: number, setIndex: number, weightKg: number) => void | Promise<void>;
  /**
   * Fires when the user confirms "discard" from the exit sheet — distinct
   * from a normal finish; the Schedule Engine must never advance because of
   * this (docs §36). Returns a typed result so this screen can tell success
   * from failure: `onDiscarded` may only run after `{ ok: true }` (docs §8) —
   * abandon must be a durable, persisted fact before the UI treats the
   * session as gone, never a fire-and-forget best effort racing the
   * navigation, and a failed abandon must never be silently treated as one.
   */
  onAbandon?: () => Promise<{ ok: true } | { ok: false; error: unknown }>;
  /**
   * Persists the cardio finisher's completion on the Firestore execution —
   * `useWorkoutExecution().completeCardio` — BEFORE the local UI treats
   * cardio as done (docs — Cardio Finisher Completion Recovery hardening).
   * Returns a typed result, never throws: a network/transaction failure must
   * never be read as "cardio is confirmed done". `CardioSessionContent`
   * only advances to `finished` once this resolves `{ ok: true }`.
   */
  onCardioCompleted?: (actualDurationSeconds: number) => Promise<{ ok: true } | { ok: false; error: unknown }>;
  /**
   * The user's current declared limitation regions + equipment context —
   * exactly what the server-side manual-substitution resolver uses too
   * (`loadManualSubstitutionUserContext`, `src/services/exerciseSubstitution.ts`).
   * `null` while loading or when there is no usable questionnaire yet: the
   * "trocar" action stays hidden rather than showing candidates computed
   * against a fabricated default context.
   */
  manualSubstitutionContext?: ManualSubstitutionUserContext | null;
  /**
   * The ONLY path a manual substitution is ever applied through — always
   * calls the `applyExerciseSubstitution` Cloud Function, which independently
   * re-validates against live Firestore data before writing anything. A
   * `requestedExerciseId` equal to the slot's prescribed exercise is a
   * "voltar ao original" request, handled the same way server-side.
   */
  onApplySubstitution?: (input: {
    exerciseIndex: number;
    requestedExerciseId: string;
    scope: ExerciseSubstitutionScope;
  }) => Promise<{ ok: true } | { ok: false; error: unknown }>;
};

/**
 * Muscle group label lookup — closed over the `t` returned by
 * useTranslation. `target` is always a canonical `MuscleId`
 * (`src/types/exercise.ts`) here: `workoutExercisesFromPlan` sets it
 * straight from the exercise catalog's `target.primaryMuscle`, the same
 * authoritative source (Firestore/local catalog, already localized) that
 * exercise NAMES come from — which is why exercise names need no lookup
 * helper at all anymore (see below). `muscleGroups.*` covers every
 * `MuscleId` value, so a miss here means a genuinely new muscle id was
 * added to the catalog without its i18n entry, not routine data — logged
 * once per unique id (module-level `Set`, not per render) so a real gap is
 * still visible in dev without spamming the console every second (this
 * hook re-renders on every session-timer tick).
 */
type LooseT = (key: string, opts?: Record<string, unknown>) => string;

const warnedMissingMuscleGroups = new Set<string>();

function translateMuscleGroup(tLoose: LooseT, target: string): string {
  const key = `muscleGroups.${target}`;
  const value = tLoose(key, { defaultValue: '' });
  if (value) return value;
  if (__DEV__ && !warnedMissingMuscleGroups.has(target)) {
    warnedMissingMuscleGroups.add(target);
    logWarn('workout', 'missing_muscle_group_translation', { target });
  }
  return target;
}

export function WorkoutScreen({ plan, onDone, onRetryCompletion, onDiscarded, onMinimize, sessionIndex = 0, execution, workoutStartedAtMs, onSessionCompleted, finishing, completionConfirmed, durableCompletionReachedAtMs, completionFailed, onSetLogged, onAbandon, onCardioCompleted, manualSubstitutionContext, onApplySubstitution }: Props) {
  const { theme } = useTheme();
  const exitDialogTheme = darkTheme;
  const { t, i18n } = useTranslation('workout');
  // Exit sheet ('choice' = Minimizar/Descartar/Cancelar, 'discard' = the
  // destructive confirmation) — X no longer abandons directly (docs §8 P0
  // follow-up: the X used to fire `abandon()` immediately, which could fail
  // silently and close the screen anyway; now every destructive path is
  // gated behind an explicit confirmation and a result the UI actually
  // reacts to).
  const [exitSheet, setExitSheet] = useState<'choice' | 'discard' | null>(null);
  const [discardError, setDiscardError] = useState(false);
  // Docs §8: guards against a second tap firing a second `abandon()` while
  // the first is still persisting — the discard button becomes
  // non-interactive (not hidden, so the UI doesn't jump) until the awaited
  // abandon settles. Also the single source of truth gating `onDone()` —
  // nothing may navigate away while this is true.
  const [abandoning, setAbandoning] = useState(false);
  const exercises = useMemo(
    () => workoutExercisesFromPlan(plan, i18n.language, sessionIndex),
    [i18n.language, plan, sessionIndex],
  );
  // Workout Recovery / Resume após process death: reverse-derived once from
  // the Firestore execution this screen is bound to — a freshly-started
  // execution (every set PENDING) derives to the same empty defaults this
  // screen always used, so this needs no "is this a resume?" branch. Keyed
  // on `executionId` only (not the whole object) so it's computed exactly
  // once per session — `execution` here is the snapshot loaded at
  // start/adopt time, not a live listener, and local optimistic state must
  // never be clobbered by re-deriving from it mid-session.
  const hydration = useMemo(
    () => (execution ? deriveWorkoutHydration(execution, exercises.map((e) => e.id)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [execution?.executionId],
  );
  // Own-video priority (item #7): a small, targeted Firestore lookup for
  // exactly this session's exercise ids — never the whole catalog, never on
  // the generation path. `ExerciseGif` falls back to its own library/
  // unavailable state for any id this resolves nothing for — but only once
  // `exerciseMediaLoading` confirms the lookup actually landed, so the
  // fallback library never flashes on screen first for an exercise that
  // does have an own video.
  const { media: exerciseExecutionMedia, loading: exerciseMediaLoading } = useExerciseExecutionMedia(
    useMemo(() => exercises.map((e) => e.id), [exercises]),
  );
  const headerButtonStyle = {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.colors.controlBackground,
    borderWidth: 1,
    borderColor: theme.colors.controlBorder,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  const { resolvedUnits } = useUnits();
  const loadUnit = workoutLoadUnit(resolvedUnits);
  const tLoose = t as unknown as LooseT;
  const { canPerform } = usePremiumCapabilities();
  const currentSession = plan.sessions[sessionIndex] ?? plan.sessions[0];
  const cardioFinisher = currentSession?.cardioFinisher;
  const {
    workoutSessionId,
    status: restStatus,
    rest,
    startRest,
    addSeconds: addRestSeconds,
    cancelRest,
    consumeExpiration,
  } = useRestSession();
  const restingExerciseIndex = rest
    ? exercises.findIndex((candidate) => candidate.id === rest.exerciseId)
    : -1;
  // FASE 3: defense-in-depth, not the primary gate — AppShell's
  // `startWorkout()` is the only place that sets `tab === 'workout'` today,
  // and it already checks START_WORKOUT before doing so. This bounces back
  // to Home if the screen is ever reached without that check having run
  // (e.g. a future entry point), so the whole session — every set/load
  // logged inside it (REGISTER_WORKOUT/REGISTER_LOAD) — never depends on
  // remembering to gate somewhere else too.
  useEffect(() => {
    if (!canPerform('START_WORKOUT')) onDone();
    // Intentionally mount-only: this is a one-time entry guard, not a
    // continuous subscription to `canPerform`/`onDone`.
  }, []);
  // Queue of exercise indices in current order (head = current). A resumed
  // session's queue comes from `hydration` (already excludes any exercise
  // with no PENDING sets left); the live-rest reordering below only applies
  // on top of that base, same as it always did for a same-mount remount.
  const [order, setOrder] = useState<number[]>(() => {
    const defaultOrder = hydration ? hydration.order : exercises.map((_, i) => i);
    if (restingExerciseIndex < 0) return defaultOrder;
    return [
      restingExerciseIndex,
      ...defaultOrder.filter((index) => index !== restingExerciseIndex),
    ];
  });
  // exIdx -> sets completed
  const [progress, setProgress] = useState<Record<number, number>>(() => {
    if (restingExerciseIndex >= 0 && rest) {
      return { ...(hydration?.progress ?? {}), [restingExerciseIndex]: rest.setIndex };
    }
    return hydration ? hydration.progress : {};
  });
  // exercise indices that were skipped and later requeued — a skip's exact
  // queue position/badge isn't persisted (docs: Workout Recovery §7), so a
  // resumed session never restores this; it only ever affects the "PULADO"
  // visual tag, never completion correctness.
  const [skipped, setSkipped] = useState<number[]>([]);
  // `${exId}-${setIdx}` -> logged weight for the session
  const [logged, setLogged] = useState<Record<string, number>>(() => hydration?.logged ?? {});

  // Load/PR and workout progression stay in the Workout Engine. A live rest
  // only restores the materialized exercise/set coordinates needed to finish
  // that already-started transition after an in-process screen remount.
  const [pending, setPending] = useState<{
    exId: string;
    exIdx: number;
    setIdx: number;
  } | null>(() => rest && restingExerciseIndex >= 0
    ? { exId: rest.exerciseId, exIdx: restingExerciseIndex, setIdx: rest.setIndex }
    : null);
  const [regWeight, setRegWeight] = useState(() => {
    if (!rest || restingExerciseIndex < 0) return 0;
    return exercises[restingExerciseIndex]?.sets[rest.setIndex]?.w ?? 0;
  });

  const [queueOpen, setQueueOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [subSheet, setSubSheet] = useState(false);
  const [pendingSub, setPendingSub] = useState<SubOption | null>(null);

  // A resumed session whose exercises were all already done when the app
  // died (only `finish()` itself never ran) opens straight on the
  // finisher/completion screen instead of replaying finished exercises —
  // the `finished` effect below still fires `onSessionCompleted` exactly
  // once from this initial state, so the durable finish chain
  // (execution.finish -> schedule.completeSession -> lifecycle) re-runs and
  // self-heals regardless of how far it got before the process died
  // (finishWorkoutExecution/completeScheduledSession are both idempotent).
  //
  // Cardio Finisher Completion Recovery hardening (2026-09): the same
  // self-heal must also cover "cardio was durably marked COMPLETED
  // (`hydration.cardioCompleted`) but the app died before `finish()` ran" —
  // never re-show a blank/ready cardio timer for an already-finished cardio
  // attempt. `!cardioFinisher` (no cardio on this plan at all) and
  // `cardioAlreadyCompleted` (cardio done, only `finish()` is pending) are
  // the two cases that go straight to `finished`; only "cardio exists on
  // this plan and genuinely hasn't been completed yet" goes to
  // `showCardioFinisher`.
  const cardioAlreadyCompleted = !!hydration?.cardioCompleted;
  const [finished, setFinished] = useState(() => !!hydration?.allDone && (!cardioFinisher || cardioAlreadyCompleted));
  const completionSignaledRef = useRef(false);
  // Captured once at mount — never re-evaluated as `finished ping-pongs`
  // later in the session, so observability can tell "this finish chain
  // started from a resumed-already-done session" apart from "the user just
  // finished it right now" (docs — Cardio Finisher Completion Recovery
  // hardening; `onSessionCompleted`'s `recovery` context).
  const finishedViaRecoveryRef = useRef(!!hydration?.allDone && (!cardioFinisher || cardioAlreadyCompleted));
  const [showCardioFinisher, setShowCardioFinisher] = useState(
    () => !!hydration?.allDone && !!cardioFinisher && !cardioAlreadyCompleted,
  );
  const [sessionNow, setSessionNow] = useState(Date.now);
  const [restNow, setRestNow] = useState(Date.now);

  // exerciseIndex -> currently effective manual substitution. Hydrated ONCE
  // from the persisted `execution` snapshot (same "never re-derive mid-session"
  // rule `hydration` above already follows) — never AsyncStorage, and never
  // client-computed: this only ever reflects what `applyExerciseSubstitution`
  // has already confirmed server-side, either in a prior session (SESSION
  // scope on resume) or via a PERMANENT preference already materialized into
  // this execution when it was created.
  const [substitutions, setSubstitutions] = useState<Record<number, { exerciseId: string; scope: ExerciseSubstitutionScope }>>(() => {
    const map: Record<number, { exerciseId: string; scope: ExerciseSubstitutionScope }> = {};
    execution?.exercises.forEach((entry) => {
      if (entry.substitution) map[entry.exerciseIndex] = { exerciseId: entry.exerciseId, scope: entry.substitution.scope };
    });
    return map;
  });
  const [substitutionError, setSubstitutionError] = useState(false);
  const [substitutionPending, setSubstitutionPending] = useState(false);
  const locale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';

  const [pr, setPr] = useState<{ weight: number; exName: string; prev: number } | null>(null);
  const [exComplete, setExComplete] = useState<{ name: string; nextName: string } | null>(null);

  // Session duration is `sessionNow - workoutStartedAtMs` (wall clock), never
  // a tick count — `workoutStartedAtMs` is the persisted execution's
  // `startedAt`, so this stays correct across background/lock/cold start.
  // The interval below only forces a re-render once a second; it never owns
  // or increments the duration itself. It stops the instant the session
  // finishes (`finished` dependency): without this, the interval kept
  // running after the early return to `WorkoutDone` below, so the "time"
  // metric on the completion screen kept counting up instead of freezing at
  // the real final duration.
  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setSessionNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finished]);

  // Shared by strength exercises and the cardio finisher. The X never
  // completes a workout; it only opens the same minimize/discard decision.
  const confirmDiscard = () => {
    if (abandoning) return;
    setDiscardError(false);
    setAbandoning(true);
    void (async () => {
      const result = await onAbandon?.();
      setAbandoning(false);
      if (!result || result.ok) {
        setExitSheet(null);
        void clearCardioSession();
        onDiscarded();
      } else {
        setDiscardError(true);
      }
    })();
  };

  // Reconciles immediately on return to foreground instead of waiting up to
  // 1s for the next interval tick — the absolute-timestamp math already
  // makes the value correct either way, this just removes the visible lag.
  useEffect(() => {
    if (finished) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setSessionNow(Date.now());
    });
    return () => subscription.remove();
  }, [finished]);

  const elapsed = computeWorkoutElapsedSeconds(workoutStartedAtMs ?? sessionNow, sessionNow);

  // Foreground-only visual ticker. It never owns or decrements countdown
  // state; every render is derived from the single absolute `endsAt`.
  useEffect(() => {
    if (restStatus !== 'running' || !rest) return undefined;
    const tick = () => setRestNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [restStatus, rest?.endsAt, rest?.restId]);

  const ovr = (index: number): SubOption | null => {
    const applied = substitutions[index];
    if (!applied) return null;
    return {
      name: exerciseDisplayName(applied.exerciseId, locale),
      target: exerciseDisplayTarget(applied.exerciseId),
      db: applied.exerciseId,
    };
  };
  // `.id` is deliberately NEVER overwritten by a substitution — it stays the
  // anchor/prescribed exercise id for the lifetime of this screen, so the
  // manual resolver always re-resolves candidates against the same anchor
  // (Decision #5: no A->B->C chaining) no matter how many times this slot is
  // re-substituted.
  const resolve = (base: Exercise, index: number): Exercise => {
    const o = ovr(index);
    return o ? { ...base, name: o.name, target: o.target, db: o.db } : base;
  };

  const exIdx = order.length > 0 ? order[0] : 0;
  const baseEx = exercises[exIdx];
  const ex = resolve(baseEx, exIdx);
  const setIdx = progress[exIdx] || 0;
  const exDone = (i: number) => (progress[i] || 0) >= exercises[i].sets.length;
  const canSkipCurrentExercise = canSkipExercise(setIdx, order.length);
  // Manual Substitution is only ever offered before any set of the CURRENT
  // exercise has been logged — the same "0 completed sets" gate `canSkipExercise`
  // already uses for skip, applied here so retroactively re-typing an already
  // logged set's exercise identity is never possible from the UI.
  const canSubstituteCurrentExercise = setIdx === 0;

  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const doneSets = exercises.reduce(
    (a, e, i) => a + Math.min(progress[i] || 0, e.sets.length),
    0
  );
  const pct = doneSets / totalSets;
  const wasSkipped = skipped.includes(exIdx);
  const isSubbed = !!ovr(exIdx);
  const isLastOverall = order.length === 1 && setIdx === ex.sets.length - 1;
  const resting = restStatus === 'running' && rest !== null;
  const finalSetLoadEntry = isLastOverall && pending !== null && !resting;
  const remainingRestSeconds = resting ? computeRemainingSeconds(rest, restNow) : 0;
  const restProgress = resting ? computeRestProgress(rest, restNow) : 0;

  const lastWeight = (e: Exercise, i: number) =>
    logged[`${e.id}-${i}`] ?? e.sets[i].w;

  const fmt = (s: number) =>
    `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

  const advanceAfterRest = (
    transitionPending = pending,
    transitionWeight = regWeight,
  ) => {
    let nextLogged = logged;
    if (transitionPending && transitionWeight > 0) {
      const baseId = exercises[exIdx].id;
      const prevBest = Math.max(
        ...exercises[exIdx].sets.map((s) => s.w),
        ...Object.entries(logged)
          .filter(([k]) => k.startsWith(baseId + '-'))
          .map(([, v]) => v),
        0
      );
      if (transitionWeight > prevBest && prevBest > 0) {
        setPr({
          weight: transitionWeight,
          exName: ex.name,
          prev: prevBest,
        });
        setTimeout(() => setPr(null), 2600);
      }
      nextLogged = {
        ...logged,
        [`${transitionPending.exId}-${transitionPending.setIdx}`]: transitionWeight,
      };
      setLogged(nextLogged);
    }
    if (transitionPending) {
      const finalWeight = nextLogged[
        `${transitionPending.exId}-${transitionPending.setIdx}`
      ] ?? exercises[transitionPending.exIdx].sets[transitionPending.setIdx].w;
      // The persistence hook registers this mutation in its serialized queue
      // synchronously before returning the Promise. The UI transition stays
      // synchronous to preserve the final-set render invariant; finish() is
      // the authoritative await/flush barrier.
      onSetLogged?.(transitionPending.exIdx, transitionPending.setIdx, finalWeight);
    }
    const finishedSet = setIdx + 1;
    const nextProgress = { ...progress, [exIdx]: finishedSet };
    setProgress(nextProgress);
    setPending(null);
    setRegWeight(0);

    if (finishedSet >= ex.sets.length) {
      // Snapshot translated names AT TRANSITION TIME so the overlay always
      // renders in the language active when the exercise ended, even if the
      // user changes language during the 2s overlay window.
      const completedName = ex.name;
      const nextOrder = order.slice(1);
      setOrder(nextOrder);
      setSkipped((s) => s.filter((x) => x !== exIdx));
      if (nextOrder.length === 0) {
        if (cardioFinisher) setShowCardioFinisher(true);
        else setFinished(true);
        return;
      }
      const nextEx = resolve(exercises[nextOrder[0]], nextOrder[0]);
      setExComplete({
        name: completedName,
        nextName: nextEx.name,
      });
      setTimeout(() => setExComplete(null), 2000);
    }
  };

  useEffect(() => {
    if (restStatus !== 'expired' || !rest) return;
    // Deadline wake-up, foreground reconciliation and delayed renders can all
    // observe one expiry. Only the single successful consumer may advance the
    // workout engine.
    if (consumeExpiration(rest.restId)) advanceAfterRest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeExpiration, rest?.restId, restStatus]);

  const completeSet = () => {
    const completedSet = { exId: ex.id, exIdx, setIdx };
    const completedWeight = lastWeight(ex, setIdx);
    setPending(completedSet);
    setRegWeight(completedWeight);

    // The last set has no recovery countdown, but it still needs the same
    // load-entry step as every other set. Keep progress pending until the
    // user confirms the load in RestOverlay, then advance straight to cardio
    // (or workout completion) through advanceAfterRest.
    if (isLastOverall) return;

    // `0` is a deliberate no-rest prescription. Preserve the new engine's
    // semantics and advance synchronously without creating a fake timer.
    if (ex.rest <= 0) {
      advanceAfterRest(completedSet, completedWeight);
      return;
    }

    startRest({
      durationSeconds: ex.rest,
      exerciseId: ex.id,
      exerciseName: ex.name,
      setIndex: setIdx,
      totalSets: ex.sets.length,
    });
  };

  const skipRest = () => {
    if (!rest || rest.workoutSessionId !== workoutSessionId) return;
    if (cancelRest(rest.restId)) advanceAfterRest();
  };

  const skipExercise = () => {
    // Defense-in-depth: the action is hidden when false, but the transition
    // itself also enforces the rule so another caller cannot bypass it.
    if (!canSkipCurrentExercise) return;
    if (!skipped.includes(exIdx)) setSkipped((s) => [...s, exIdx]);
    setOrder((o) => [...o.slice(1), o[0]]);
  };

  const jumpTo = (i: number) => {
    // Selecting another item in the queue is another way of moving the
    // current exercise behind it, so it follows the same invariant.
    if (exDone(i) || (i !== exIdx && !canSkipCurrentExercise)) return;
    setOrder((o) => [i, ...o.filter((x) => x !== i)]);
    setQueueOpen(false);
  };

  const applySub = async (option: SubOption, scope: 'once' | 'all') => {
    setPendingSub(null);
    setSubSheet(false);
    if (!onApplySubstitution) return;
    const isRevertToOriginal = option.db === baseEx.id;
    const requestedScope: ExerciseSubstitutionScope = scope === 'all' ? 'PERMANENT' : 'SESSION';
    setSubstitutionError(false);
    setSubstitutionPending(true);
    const result = await onApplySubstitution({
      exerciseIndex: exIdx,
      requestedExerciseId: option.db,
      scope: requestedScope,
    });
    setSubstitutionPending(false);
    if (!result.ok) {
      setSubstitutionError(true);
      return;
    }
    setSubstitutions((current) => {
      const next = { ...current };
      if (isRevertToOriginal) delete next[exIdx];
      else next[exIdx] = { exerciseId: option.db, scope: requestedScope };
      return next;
    });
  };

  // Every OTHER slot's currently effective exercise id — never this slot's
  // own (Decision #7/Caso 2-4 of the audit): a candidate already resolved
  // elsewhere in the session can never be offered here.
  const effectiveExerciseIdsInSession = useMemo(() => {
    const ids = new Set<string>();
    exercises.forEach((exercise, index) => {
      if (index === exIdx) return;
      ids.add(ovr(index)?.db ?? exercise.id);
    });
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, exIdx, substitutions]);

  const canOfferSubstitution = canSubstituteCurrentExercise && !!manualSubstitutionContext;
  const rankedCandidates = useMemo(
    () => (canOfferSubstitution
      ? resolveDisplayCandidates({
        anchorExerciseId: baseEx.id,
        userContext: manualSubstitutionContext!,
        effectiveExerciseIdsInSession,
      })
      : []),
    [canOfferSubstitution, baseEx.id, manualSubstitutionContext, effectiveExerciseIdsInSession],
  );
  const canRevert = isSubbed && canOfferSubstitution && canRevertToAnchor({
    anchorExerciseId: baseEx.id,
    userContext: manualSubstitutionContext ?? { regions: [], equipmentContext: { environment: 'gym', availableEquipment: new Set() } },
    effectiveExerciseIdsInSession,
  });

  const subOptions: (SubOption & { _base?: boolean })[] = useMemo(
    () => (canRevert || rankedCandidates.length > 0
      ? [
        { name: baseEx.name, target: baseEx.target, db: baseEx.id, _base: true },
        ...rankedCandidates.map((candidate) => ({
          name: exerciseDisplayName(candidate.exerciseId, locale),
          target: exerciseDisplayTarget(candidate.exerciseId),
          db: candidate.exerciseId,
        })),
      ]
      : []),
    [canRevert, rankedCandidates, baseEx, locale]
  );

  // Mount-once-per-finish signal for the Schedule Engine — separate from
  // `onDone`, which is only the completed-workout CTA, and from the
  // early-exit `onDiscarded` teardown.
  useEffect(() => {
    if (finished && !completionSignaledRef.current) {
      completionSignaledRef.current = true;
      onSessionCompleted?.({ recovery: finishedViaRecoveryRef.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const successVisibleRef = useRef(false);
  useEffect(() => {
    const visible = finished && !!completionConfirmed && !completionFailed;
    if (visible && !successVisibleRef.current) {
      const visibleAtMs = Date.now();
      logInfo('workout_performance', 'success_screen_visible', {
        timestampMs: visibleAtMs,
        durationFromDurableMs: durableCompletionReachedAtMs == null
          ? null
          : Math.max(0, visibleAtMs - durableCompletionReachedAtMs),
      });
    }
    successVisibleRef.current = visible;
  }, [completionConfirmed, completionFailed, durableCompletionReachedAtMs, finished]);

  if (finished) {
    // `finished` is local workout progress, not a persistence fact. The very
    // first render after the last set/cardio must therefore be loading even
    // before AppShell's completion effect has had a chance to run.
    if (!completionConfirmed && !completionFailed) {
      return (
        <FullScreenLoading
          accessibilityLabel={t('done.finishing')}
          message={t('done.finishing')}
        />
      );
    }
    if (completionFailed) {
      return <WorkoutCompletionError retrying={!!finishing} onRetry={onRetryCompletion} />;
    }
    return (
      <WorkoutDone
        elapsed={elapsed}
        doneSets={doneSets}
        totalSets={totalSets}
        onDone={() => {
          // Diagnostic instrumentation (Phase 2, Part F) — only the true
          // post-completion navigation (this branch only renders once
          // `finished` is true), never the early-exit/abandon path.
          logInfo('workout', 'workout_done_cta_pressed', {
            templateId: plan.templateId,
            sessionIndex,
          });
          onDone();
        }}
      />
    );
  }

  if (showCardioFinisher && cardioFinisher) {
    return (
      <CardioScreen
        cardioFinisher={cardioFinisher}
        ownerKey={String(workoutStartedAtMs ?? `${plan.templateId}-${sessionIndex}`)}
        onRequestExit={() => {
          setDiscardError(false);
          setExitSheet('choice');
        }}
        exitDialog={(
          <WorkoutExitDialog
            step={exitSheet}
            abandoning={abandoning}
            discardError={discardError}
            onDismiss={() => setExitSheet(null)}
            onMinimize={() => {
              setExitSheet(null);
              onMinimize?.();
            }}
            onRequestDiscard={() => {
              setDiscardError(false);
              setExitSheet('discard');
            }}
            onConfirmDiscard={confirmDiscard}
            onBack={() => {
              setDiscardError(false);
              setExitSheet('choice');
            }}
          />
        )}
        onCardioCompleted={onCardioCompleted}
        onFinish={(actualDurationSeconds) => {
          logInfo('workout', 'cardio_finished', {
            templateId: plan.templateId,
            sessionIndex,
            plannedDurationSeconds: parsePrescribedCardioDurationSeconds(cardioFinisher.duration),
            actualDurationSeconds,
          });
          setFinished(true);
        }}
      />
    );
  }

  // Only computed once `finished` is ruled out above — `order` (and thus
  // `exIdx`/`setIdx`) is only ever left pointing at an exercise with
  // remaining sets while `finished` is false (both `advanceAfterRest` and
  // `completeSet`'s last-set branch flip `finished` to true in the SAME
  // update as the progress/order change that would otherwise leave
  // `setIdx` pointing past the end of `ex.sets`). Reading these before the
  // early return above was the exact cause of the
  // "Cannot read property 'r' of undefined" crash on the final set/final
  // exercise transition: the render right after `finished` became true
  // still fell through to here with a stale/out-of-range `setIdx`.
  const curReps = ex.sets[setIdx].r;
  const curLast = lastWeight(ex, setIdx);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* header */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('header.accessibility.close')}
            accessibilityState={{ disabled: abandoning }}
            disabled={abandoning}
            onPress={() => {
              // Reaching this button at all means `finished` is false (the
              // component early-returns to `WorkoutDone` otherwise). The X no
              // longer abandons directly — it just opens the exit sheet;
              // every domain mutation (discard) happens only from an
              // explicit confirmation below.
              setDiscardError(false);
              setExitSheet('choice');
            }}
            style={[headerButtonStyle, abandoning ? { opacity: 0.5 } : null]}
          >
            <Icon name="x" size={15} color={theme.colors.iconEmphasis} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SegBar value={pct} segs={totalSets} />
            <MonoLabel
              style={{ marginTop: 7, textAlign: 'center' }}
            >
              {(currentSession
                ? resolveSessionDisplayName(
                    tLoose,
                    currentSession.name,
                    currentSession.type,
                    currentSession.displayName,
                  )
                : '').toUpperCase()}
            </MonoLabel>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 4,
              }}
            >
              <MonoLabel color={theme.colors.primaryEmphasis}>
                {fmt(elapsed)}
              </MonoLabel>
              <MonoLabel style={{ marginLeft: 8, textAlign: 'right' }}>
                {t('sets.progress', {
                  done: doneSets,
                  total: totalSets,
                  count: totalSets,
                }).toUpperCase()}
              </MonoLabel>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('header.accessibility.openQueue')}
            onPress={() => setQueueOpen(true)}
            style={headerButtonStyle}
          >
            <Icon name="list" size={15} color={theme.colors.iconEmphasis} />
          </Pressable>
        </View>

        {/* GIF banner */}
        <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          <View style={{ position: 'relative', borderRadius: 20, overflow: 'hidden' }}>
            <ExerciseGif
              id={ex.db}
              name={ex.name}
              height={224}
              radius={20}
              ownVideo={exerciseExecutionMedia[ex.id]?.videos}
              ownVideoLoading={exerciseMediaLoading}
            />
            {/* gradient overlay for legibility */}
            <LinearGradient
              colors={[
                'rgba(2,0,16,0.45)',
                'transparent',
                'transparent',
                'rgba(2,0,16,0.55)',
              ]}
              locations={[0, 0.28, 0.6, 1]}
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <View
              style={{
                position: 'absolute',
                top: 14,
                left: 16,
                backgroundColor: 'rgba(2,0,16,0.7)',
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 6,
              }}
            >
              <MonoLabel color={theme.colors.textPrimary}>
                {t('header.exercisePrefix').toUpperCase()}{' '}
                {String(exIdx + 1).padStart(2, '0')}
                <Text style={{ opacity: 0.5 }}>
                  {' '}
                  / {String(exercises.length).padStart(2, '0')}
                </Text>
              </MonoLabel>
            </View>
            <Pressable
              onPress={() => setVideoOpen(true)}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingVertical: 9,
                paddingHorizontal: 14,
                backgroundColor: theme.colors.primaryActionOverlay,
                borderRadius: 11,
                shadowColor: theme.colors.primary,
                shadowOpacity: 0.5,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
              }}
            >
              <Icon name="play" size={11} color={theme.colors.primaryForeground} />
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12, color: theme.colors.primaryForeground }}>
                {t('actions.viewExecution')}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* name + badges + swap */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 16,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            >
              <Slash>{translateMuscleGroup(tLoose, ex.target).toUpperCase()}</Slash>
              {wasSkipped && (
                <Badge
                  bg={theme.colors.selectionBackground}
                  border={theme.colors.primaryBorderInteractive}
                  color={theme.colors.primaryEmphasis}
                >
                  {t('badges.resumed').toUpperCase()}
                </Badge>
              )}
              {isSubbed && (
                <Badge
                  bg={theme.colors.surfacePressed}
                  border={theme.colors.badgeBorder}
                  color={theme.colors.choiceTextSecondary}
                >
                  {(substitutions[exIdx]?.scope === 'PERMANENT'
                    ? t('substitution.badges.permanent')
                    : t('substitution.badges.today')
                  ).toUpperCase()}
                </Badge>
              )}
            </View>
            <Display size={26} style={{ marginTop: 8 }}>
              {ex.name}
            </Display>
          </View>
          {(rankedCandidates.length > 0 || canRevert) && <Pressable
            onPress={() => setSubSheet(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              height: 38,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
              marginTop: 2,
            }}
          >
            <Icon name="swap" size={15} color={theme.colors.primaryEmphasis} />
            <Text style={{ fontSize: 12, fontFamily: theme.fonts.uiSemi, color: theme.colors.choiceTextSecondary }}>
              {t('actions.swap')}
            </Text>
          </Pressable>}
        </View>

        {/* Next-set card */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <View
            style={{
              borderRadius: 18,
              padding: 18,
              backgroundColor: theme.colors.workoutActiveBackground,
              borderWidth: 1,
              borderColor: theme.colors.workoutActiveBorder,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <View style={{ flex: 1 }}>
              <MonoLabel color={theme.colors.primaryEmphasis}>
                {t('sets.next').toUpperCase()}
              </MonoLabel>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
                <Display size={28}>
                  {t('sets.number', { number: setIdx + 1 }).toUpperCase()}
                </Display>
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 18,
                    color: theme.colors.textFaint,
                    marginLeft: 6,
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  /{ex.sets.length}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'center', minWidth: 60 }}>
              <Text
                style={{
                  fontFamily: theme.fonts.display,
                  fontSize: 40,
                  color: theme.colors.textPrimary,
                  lineHeight: displayLineHeight(40),
                  transform: [{ skewX: '-8deg' }],
                }}
              >
                {curReps}
              </Text>
              <MonoLabel style={{ marginTop: 4 }}>
                {t('reps.label').toUpperCase()}
              </MonoLabel>
            </View>
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.dividerStrong }} />
            <View style={{ alignItems: 'center', minWidth: 66 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 28,
                    color: theme.colors.textPrimary,
                    lineHeight: displayLineHeight(28),
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {curLast > 0 ? formatWorkoutLoadFromKg(curLast, resolvedUnits) : '—'}
                </Text>
                {curLast > 0 && (
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.textFaint, marginLeft: 2 }}>
                    {loadUnit}
                  </Text>
                )}
              </View>
              <MonoLabel size={8.5} style={{ marginTop: 6 }}>
                {t('sets.lastTime').toUpperCase()}
              </MonoLabel>
            </View>
          </View>
        </View>

        {/* set list */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {ex.sets.map((s0, i) => {
            const done = i < setIdx;
            const now = i === setIdx;
            const w = lastWeight(ex, i);
            const justLogged = logged[`${ex.id}-${i}`] != null && done;
            return (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  marginBottom: 6,
                  backgroundColor: now
                    ? theme.colors.workoutActiveBackground
                    : theme.colors.workoutRowBackground,
                  borderWidth: 1,
                  borderColor: now
                    ? theme.colors.workoutActiveBorder
                    : theme.colors.workoutRowBorder,
                  opacity: done ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 14,
                    width: 20,
                    color: done
                      ? theme.colors.primaryEmphasis
                      : now
                        ? theme.colors.textPrimary
                        : theme.colors.textFaint,
                    textTransform: 'uppercase',
                  }}
                >
                  {done ? '✓' : String(i + 1).padStart(2, '0')}
                </Text>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, flex: 1, color: theme.colors.textPrimary }}>
                  {w > 0
                    ? t('sets.summaryWeighted', {
                        count: pluralCountForReps(s0.r),
                        reps: s0.r,
                        weight: formatWorkoutLoadFromKg(w, resolvedUnits),
                        unit: loadUnit,
                      })
                    : t('sets.summaryReps', { count: pluralCountForReps(s0.r), reps: s0.r })}
                </Text>
                {justLogged && (
                  <MonoLabel color={theme.colors.primaryEmphasis}>
                    {t('sets.registered').toUpperCase()}
                  </MonoLabel>
                )}
                {now && (
                  <MonoLabel color={theme.colors.primaryEmphasis}>
                    {t('sets.current').toUpperCase()}
                  </MonoLabel>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* CTAs */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
          <CtaButton onPress={completeSet}>
            <Icon name="check" size={18} color={theme.colors.primaryForeground} />
            <Text
              style={{
                color: theme.colors.primaryForeground,
                fontFamily: theme.fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {isLastOverall
                ? t('actions.finishWorkout')
                : t('actions.completeSet', { number: setIdx + 1 })}
            </Text>
          </CtaButton>
          {/* Keep this slot mounted after the first completed set. The skip
              action disappears, but the primary CTA must not shift vertically. */}
          <View style={{ height: 54 }}>
            {canSkipCurrentExercise && (
              <Pressable
                onPress={skipExercise}
                style={{
                  width: '100%',
                  height: 44,
                  marginTop: 10,
                  borderRadius: 14,
                  backgroundColor: theme.colors.inputBackgroundSubtle,
                  borderWidth: 1,
                  borderColor: theme.colors.dividerStrong,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 9,
                }}
              >
                <Icon name="swap" size={15} color={theme.colors.primaryEmphasis} />
                <Text style={{ fontSize: 13.5, fontFamily: theme.fonts.uiSemi, color: theme.colors.textEmphasis }}>
                  {t('actions.skipBusy')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* REST OVERLAY */}
        {(resting || finalSetLoadEntry) && (
          <RestOverlay
            remainingSeconds={remainingRestSeconds}
            progress={restProgress}
            fmt={fmt}
            regWeight={regWeight}
            setRegWeight={setRegWeight}
            setNumber={(pending ? pending.setIdx : setIdx) + 1}
            finalSetLoadEntry={finalSetLoadEntry}
            continuesToCardio={!!cardioFinisher}
            onAdd15={() => addRestSeconds(15)}
            onSkip={finalSetLoadEntry ? () => advanceAfterRest() : skipRest}
            onMinimize={onMinimize}
          />
        )}

        {/* PR celebration */}
        {pr && <PROverlay weight={pr.weight} exName={pr.exName} prev={pr.prev} />}

        {/* exercise complete transition */}
        {exComplete && <ExerciseDoneOverlay name={exComplete.name} nextName={exComplete.nextName} />}

        {/* VIDEO modal (fullscreen 9:16) */}
        <Modal
          visible={videoOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setVideoOpen(false)}
        >
          <SafeAreaView
            edges={['top', 'bottom']}
            style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}
          >
            <View
              style={{
                width: '92%',
                maxWidth: 380,
                aspectRatio: 9 / 16,
                position: 'relative',
                borderRadius: 20,
                overflow: 'hidden',
              }}
            >
              <ExerciseGif
                id={ex.db}
                name={ex.name}
                aspectRatio={9 / 16}
                radius={20}
                ownVideo={exerciseExecutionMedia[ex.id]?.videos}
                ownVideoLoading={exerciseMediaLoading}
              />

              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  padding: 20,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1 }}>
                  <MonoLabel color={theme.colors.primaryEmphasis}>
                    {t('video.execution').toUpperCase()}
                  </MonoLabel>
                  <Text
                    style={{
                      fontSize: 17,
                      fontFamily: theme.fonts.uiBold,
                      color: theme.colors.textPrimary,
                      marginTop: 3,
                    }}
                  >
                    {ex.name}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('video.accessibility.close')}
                  onPress={() => setVideoOpen(false)}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: 'rgba(2,0,16,0.55)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.18)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="x" size={20} color="#fff" />
                </Pressable>
              </View>

              <LinearGradient
                colors={['transparent', 'rgba(2,0,16,0.5)', 'rgba(2,0,16,0.9)']}
                locations={[0, 0.45, 1]}
                pointerEvents="none"
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 260 }}
              />
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 22 }}>
                <MonoLabel color={theme.colors.primaryEmphasis} style={{ marginBottom: 10 }}>
                  {t('video.keyPoints').toUpperCase()}
                </MonoLabel>
                {(['keyPoint1', 'keyPoint2', 'keyPoint3'] as const).map((key, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 6,
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: theme.colors.primaryEmphasis,
                      }}
                    />
                    <Text style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.88)' }}>
                      {t(`instructions.default.${key}`)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </SafeAreaView>
        </Modal>

        {/* SUB SHEET */}
        <Modal
          visible={subSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setSubSheet(false)}
        >
          <Pressable
            onPress={() => setSubSheet(false)}
            style={{ flex: 1, backgroundColor: theme.colors.workoutSheetBackdrop, justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                maxHeight: '78%',
                backgroundColor: theme.colors.workoutSheetBackground,
                borderTopWidth: 1,
                borderTopColor: theme.colors.primaryBorderMuted,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 18,
                paddingBottom: 30,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.equipmentCheckboxBorder,
                  alignSelf: 'center',
                  marginBottom: 16,
                }}
              />
              <Slash style={{ marginBottom: 6 }}>
                {t('substitution.sheetTitle').toUpperCase()}
              </Slash>
              <Text style={{ fontSize: 12.5, color: theme.colors.textMuted, marginBottom: 16 }}>
                {t('substitution.sheetSubtitle')}
              </Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {subOptions.map((o) => {
                  const active = o.db === ex.db;
                  return (
                    <Pressable
                      key={o.db}
                      onPress={() => {
                        // Never leave two native <Modal>s visible at once:
                        // stacking the sub-sheet and the confirm dialog is
                        // what left the screen touch-dead after closing.
                        setSubSheet(false);
                        if (!active) setPendingSub(o);
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        padding: 10,
                        borderRadius: 14,
                        marginBottom: 8,
                        backgroundColor: active
                          ? theme.colors.primarySurface
                          : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: active
                          ? theme.colors.primaryBorderFocus
                          : theme.colors.sheetDivider,
                      }}
                    >
                      <View style={{ width: 76 }}>
                        <ExerciseGif
                          id={o.db}
                          name={o.name}
                          height={58}
                          radius={10}
                          ownVideo={exerciseExecutionMedia[o.db]?.videos}
                          ownVideoLoading={exerciseMediaLoading}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14.5, fontFamily: theme.fonts.uiBold, color: theme.colors.textPrimary }}>
                          {o.name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: theme.fonts.mono,
                            fontSize: 9.5,
                            color: theme.colors.textFaint,
                            letterSpacing: 1,
                            marginTop: 3,
                          }}
                        >
                          {(o._base
                            ? t('substitution.labels.original')
                            : t('substitution.labels.replacement')
                          ).toUpperCase()}{' '}
                          · {translateMuscleGroup(tLoose, o.target).toUpperCase()}
                        </Text>
                      </View>
                      {active ? (
                        <MonoLabel color={theme.colors.primaryEmphasis}>
                          {t('substitution.labels.current').toUpperCase()}
                        </MonoLabel>
                      ) : (
                        <Icon name="chevron-right" size={16} color={theme.colors.iconMuted} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* PENDING SUB CONFIRM */}
        <Modal
          visible={!!pendingSub}
          transparent
          animationType="fade"
          onRequestClose={() => setPendingSub(null)}
        >
          <Pressable
            onPress={() => setPendingSub(null)}
            style={{
              flex: 1,
              backgroundColor: theme.colors.workoutDialogBackdrop,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 28,
            }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                borderRadius: 20,
                padding: 24,
                backgroundColor: theme.colors.workoutDialogBackground,
                borderWidth: 1,
                borderColor: theme.colors.primaryBorderMuted,
                shadowColor: theme.colors.primary,
                shadowOpacity: 0.25,
                shadowRadius: 40,
                shadowOffset: { width: 0, height: 0 },
                elevation: 12,
              }}
            >
              <Slash style={{ marginBottom: 12 }}>
                {t('substitution.confirmTitle').toUpperCase()}
              </Slash>
              {/* The full sentence lives in a single i18n key with two
                  placeholders so word order matches each locale (e.g.
                  "X in place of Y" in EN). Bold styling is applied via the
                  outer Text style so it wraps around the interpolated names. */}
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  color: theme.colors.textStrong,
                  fontFamily: theme.fonts.uiBold,
                }}
              >
                {t('substitution.replaceQuestion', {
                  replacement: pendingSub
                    ? pendingSub.name
                    : '',
                  original: baseEx.name,
                })}
              </Text>
              {substitutionError && (
                <Text style={{ fontSize: 12.5, color: theme.colors.dangerText, marginTop: 10 }}>
                  {t('substitution.error')}
                </Text>
              )}
              <View style={{ marginTop: 22, gap: 10, opacity: substitutionPending ? 0.6 : 1 }}>
                <Pressable
                  disabled={substitutionPending}
                  onPress={() => pendingSub && applySub(pendingSub, 'once')}
                  style={{
                    paddingVertical: 15,
                    borderRadius: 14,
                    backgroundColor: theme.colors.controlBackground,
                    borderWidth: 1,
                    borderColor: theme.colors.borderStrong,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14.5, fontFamily: theme.fonts.uiSemi, color: theme.colors.textPrimary }}>
                    {t('substitution.actions.once')}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={substitutionPending}
                  onPress={() => pendingSub && applySub(pendingSub, 'all')}
                  style={{
                    paddingVertical: 15,
                    borderRadius: 14,
                    backgroundColor: theme.colors.primary,
                    alignItems: 'center',
                    shadowColor: theme.colors.primary,
                    shadowOpacity: 0.45,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 8,
                  }}
                >
                  <Text style={{ fontSize: 14.5, fontFamily: theme.fonts.uiBold, color: theme.colors.primaryForeground }}>
                    {t('substitution.actions.permanent')}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={substitutionPending}
                  onPress={() => setPendingSub(null)}
                  style={{ paddingVertical: 11, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, color: theme.colors.textMuted, fontFamily: theme.fonts.uiMed }}>
                    {t('substitution.actions.cancel')}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* QUEUE SHEET */}
        <Modal
          visible={queueOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setQueueOpen(false)}
        >
          <Pressable
            onPress={() => setQueueOpen(false)}
            style={{ flex: 1, backgroundColor: theme.colors.workoutSheetBackdrop, justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                maxHeight: '75%',
                backgroundColor: theme.colors.workoutSheetBackground,
                borderTopWidth: 1,
                borderTopColor: theme.colors.primaryBorderMuted,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 18,
                paddingBottom: 30,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.equipmentCheckboxBorder,
                  alignSelf: 'center',
                  marginBottom: 16,
                }}
              />
              <Slash style={{ marginBottom: 14 }}>
                {t('queue.title', { count: exercises.length }).toUpperCase()}
              </Slash>
              <ScrollView showsVerticalScrollIndicator={false}>
                {order.map((i, pos) => {
                  const e = exercises[i];
                  const now = pos === 0;
                  const wasSkip = skipped.includes(i);
                  const navigationLocked = !now && !canSkipCurrentExercise;
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => jumpTo(i)}
                      disabled={navigationLocked}
                      accessibilityState={{ disabled: navigationLocked }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        marginBottom: 6,
                        opacity: navigationLocked ? 0.45 : 1,
                        backgroundColor: now ? theme.colors.primarySurface : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: now
                          ? theme.colors.primaryBorderFocus
                          : theme.colors.workoutRowBorder,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: theme.fonts.display,
                          fontSize: 14,
                          width: 26,
                          color: theme.colors.textFaint,
                          textTransform: 'uppercase',
                        }}
                      >
                        {String(pos + 1).padStart(2, '0')}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.textPrimary }}>
                          {resolve(e, i).name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: theme.fonts.mono,
                            fontSize: 9.5,
                            color: theme.colors.textFaint,
                            letterSpacing: 1,
                            marginTop: 2,
                          }}
                        >
                          {t('queue.activeItem', {
                            target: translateMuscleGroup(tLoose, resolve(e, i).target),
                            done: Math.min(progress[i] || 0, e.sets.length),
                            total: e.sets.length,
                            count: e.sets.length,
                          }).toUpperCase()}
                        </Text>
                      </View>
                      {wasSkip && !now && (
                        <MonoLabel color={theme.colors.primaryEmphasis}>
                          {t('queue.states.skipped').toUpperCase()}
                        </MonoLabel>
                      )}
                      {now && (
                        <MonoLabel color={theme.colors.primaryEmphasis}>
                          {t('queue.states.now').toUpperCase()}
                        </MonoLabel>
                      )}
                    </Pressable>
                  );
                })}
                {exercises.map((e, i) =>
                  exDone(i) ? (
                    <View
                      key={'done-' + e.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        marginBottom: 6,
                        opacity: 0.4,
                        backgroundColor: theme.colors.surfaceSubtle,
                        borderWidth: 1,
                        borderColor: theme.colors.workoutRowBorder,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: theme.fonts.display,
                          fontSize: 14,
                          width: 26,
                          color: theme.colors.primaryEmphasis,
                          textTransform: 'uppercase',
                        }}
                      >
                        ✓
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.textPrimary }}>
                          {resolve(e, i).name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: theme.fonts.mono,
                            fontSize: 9.5,
                            color: theme.colors.textFaint,
                            letterSpacing: 1,
                            marginTop: 2,
                          }}
                        >
                          {t('queue.completedItem', {
                            done: e.sets.length,
                            total: e.sets.length,
                            count: e.sets.length,
                          }).toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  ) : null
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* EXIT DIALOG — Minimizar / Descartar / Cancelar (docs §8 P0 follow-up) */}
        <Modal
          visible={exitSheet !== null}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => {
            if (abandoning) return;
            setExitSheet(null);
          }}
        >
          <Pressable
            onPress={() => {
              if (abandoning) return;
              setExitSheet(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('exit.cancel')}
            style={{
              flex: 1,
              backgroundColor: exitDialogTheme.colors.overlayStrong,
              justifyContent: 'center',
              paddingHorizontal: spacing[6],
            }}
          >
            <Pressable
              accessibilityRole="none"
              onPress={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: sizes.modalMaxWidth,
                alignSelf: 'center',
                borderRadius: radii.xl,
                borderBottomRightRadius: 0,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: exitDialogTheme.colors.primaryBorderQuiet,
                backgroundColor: exitDialogTheme.colors.background,
                shadowColor: exitDialogTheme.colors.primary,
                shadowOpacity: 0.18,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 10 },
                elevation: 10,
              }}
            >
              <LinearGradient
                colors={exitDialogTheme.gradients.poster}
                locations={[0, 0.45, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  padding: spacing[5],
                }}
              >
                <HudCorners color={exitDialogTheme.colors.hudCorner} />
                {exitSheet === 'choice' && (
                  <>
                    <Slash
                      accentColor={exitDialogTheme.colors.primaryEmphasis}
                      textColor={exitDialogTheme.colors.textFaint}
                    >
                      {t('exit.kicker').toUpperCase()}
                    </Slash>
                    <Display size={26} color={exitDialogTheme.colors.textPrimary} style={{ marginTop: 9 }}>
                      {t('exit.title').toUpperCase()}
                    </Display>
                    <Text style={{ marginTop: 8, fontFamily: exitDialogTheme.fonts.ui, fontSize: 13, color: exitDialogTheme.colors.textSecondaryStrong, lineHeight: 19 }}>
                      {t('exit.body')}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('exit.minimize')}
                      onPress={() => {
                        setExitSheet(null);
                        onMinimize?.();
                      }}
                      style={{
                        height: 48,
                        marginTop: 18,
                        borderRadius: 10,
                        borderBottomRightRadius: 0,
                        backgroundColor: exitDialogTheme.colors.inverseSurface,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 9,
                      }}
                    >
                      <Icon name="minus" size={12} color={exitDialogTheme.colors.inverseForeground} />
                      <Text
                        style={{
                          color: exitDialogTheme.colors.inverseForeground,
                          fontFamily: exitDialogTheme.fonts.display,
                          fontSize: 15,
                          letterSpacing: 1.4,
                          textTransform: 'uppercase',
                        }}
                      >
                        {t('exit.minimize')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('exit.discard')}
                      onPress={() => {
                        setDiscardError(false);
                        setExitSheet('discard');
                      }}
                      style={{
                        height: 48,
                        marginTop: 10,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        borderBottomRightRadius: 0,
                        borderWidth: 1,
                        borderColor: exitDialogTheme.colors.controlBorder,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: exitDialogTheme.colors.textSecondaryStrong, fontFamily: exitDialogTheme.fonts.ui, fontSize: 13 }}>
                        {t('exit.discard')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('exit.cancel')}
                      onPress={() => setExitSheet(null)}
                      style={{ alignSelf: 'center', paddingHorizontal: 18, paddingTop: 13, paddingBottom: 2 }}
                    >
                      <Text style={{ color: exitDialogTheme.colors.textMuted, fontFamily: exitDialogTheme.fonts.ui, fontSize: 13 }}>
                        {t('exit.cancel')}
                      </Text>
                    </Pressable>
                  </>
                )}
                {exitSheet === 'discard' && (
                  <>
                    <Slash
                      accentColor={exitDialogTheme.colors.primaryEmphasis}
                      textColor={exitDialogTheme.colors.textFaint}
                    >
                      {t('exit.kicker').toUpperCase()}
                    </Slash>
                    <Display size={26} color={exitDialogTheme.colors.textPrimary} style={{ marginTop: 9 }}>
                      {t('exit.discardConfirmTitle').toUpperCase()}
                    </Display>
                    <Text style={{ marginTop: 8, fontFamily: exitDialogTheme.fonts.ui, fontSize: 13, color: exitDialogTheme.colors.textSecondaryStrong, lineHeight: 19 }}>
                      {t('exit.discardConfirmBody')}
                    </Text>
                    {discardError && (
                      <Text
                        accessibilityRole="alert"
                        style={{ color: exitDialogTheme.colors.warning, fontFamily: exitDialogTheme.fonts.ui, fontSize: 12, lineHeight: 17, marginTop: 8 }}
                      >
                        {t('exit.discardError')}
                      </Text>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('exit.discardConfirmYes')}
                      accessibilityState={{ disabled: abandoning }}
                      disabled={abandoning}
                      onPress={confirmDiscard}
                      style={{
                        height: 48,
                        marginTop: 18,
                        borderRadius: 10,
                        borderBottomRightRadius: 0,
                        backgroundColor: exitDialogTheme.colors.inverseSurface,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 9,
                        opacity: abandoning ? 0.6 : 1,
                      }}
                    >
                      {abandoning ? (
                        <ActivityIndicator color={exitDialogTheme.colors.inverseForeground} />
                      ) : (
                        <Icon name="x" size={12} color={exitDialogTheme.colors.inverseForeground} />
                      )}
                      <Text
                        style={{
                          color: exitDialogTheme.colors.inverseForeground,
                          fontFamily: exitDialogTheme.fonts.display,
                          fontSize: 14,
                          letterSpacing: 1.2,
                          textTransform: 'uppercase',
                        }}
                      >
                        {abandoning ? t('exit.discarding') : t('exit.discardConfirmYes')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('exit.discardConfirmBack')}
                      accessibilityState={{ disabled: abandoning }}
                      disabled={abandoning}
                      onPress={() => {
                        if (abandoning) return;
                        setDiscardError(false);
                        setExitSheet('choice');
                      }}
                      style={{ alignSelf: 'center', marginTop: 10, paddingVertical: 10, paddingHorizontal: 18 }}
                    >
                      <Text style={{ color: exitDialogTheme.colors.textMuted, fontFamily: exitDialogTheme.fonts.ui, fontSize: 13 }}>
                        {t('exit.discardConfirmBack')}
                      </Text>
                    </Pressable>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </ScreenBg>
  );
}

function WorkoutExitDialog({
  step,
  abandoning,
  discardError,
  onDismiss,
  onMinimize,
  onRequestDiscard,
  onConfirmDiscard,
  onBack,
}: {
  step: 'choice' | 'discard' | null;
  abandoning: boolean;
  discardError: boolean;
  onDismiss: () => void;
  onMinimize: () => void;
  onRequestDiscard: () => void;
  onConfirmDiscard: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('workout');
  const theme = darkTheme;
  const close = () => {
    if (!abandoning) onDismiss();
  };

  return (
    <Modal
      visible={step !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('exit.cancel')}
        onPress={close}
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlayStrong,
          justifyContent: 'center',
          paddingHorizontal: spacing[6],
        }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: sizes.modalMaxWidth,
            alignSelf: 'center',
            borderRadius: radii.xl,
            borderBottomRightRadius: 0,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.primaryBorderQuiet,
            backgroundColor: theme.colors.background,
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={theme.gradients.poster}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: spacing[5] }}
          >
            <HudCorners color={theme.colors.hudCorner} />
            <Slash accentColor={theme.colors.primaryEmphasis} textColor={theme.colors.textFaint}>
              {t('exit.kicker').toUpperCase()}
            </Slash>

            {step === 'choice' ? (
              <>
                <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
                  {t('exit.title').toUpperCase()}
                </Display>
                <Text style={{ marginTop: 8, fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondaryStrong, lineHeight: 19 }}>
                  {t('exit.body')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('exit.minimize')}
                  onPress={onMinimize}
                  style={{
                    height: 48,
                    marginTop: 18,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    backgroundColor: theme.colors.inverseSurface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 9,
                  }}
                >
                  <Icon name="minus" size={12} color={theme.colors.inverseForeground} />
                  <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.display, fontSize: 15, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                    {t('exit.minimize')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('exit.discard')}
                  onPress={onRequestDiscard}
                  style={{
                    height: 48,
                    marginTop: 10,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    borderWidth: 1,
                    borderColor: theme.colors.controlBorder,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                    {t('exit.discard')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('exit.cancel')}
                  onPress={onDismiss}
                  style={{ alignSelf: 'center', paddingHorizontal: 18, paddingTop: 13, paddingBottom: 2 }}
                >
                  <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                    {t('exit.cancel')}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
                  {t('exit.discardConfirmTitle').toUpperCase()}
                </Display>
                <Text style={{ marginTop: 8, fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondaryStrong, lineHeight: 19 }}>
                  {t('exit.discardConfirmBody')}
                </Text>
                {discardError && (
                  <Text accessibilityRole="alert" style={{ color: theme.colors.warning, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
                    {t('exit.discardError')}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('exit.discardConfirmYes')}
                  accessibilityState={{ disabled: abandoning }}
                  disabled={abandoning}
                  onPress={onConfirmDiscard}
                  style={{
                    height: 48,
                    marginTop: 18,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    backgroundColor: theme.colors.inverseSurface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 9,
                    opacity: abandoning ? 0.6 : 1,
                  }}
                >
                  {abandoning ? (
                    <ActivityIndicator color={theme.colors.inverseForeground} />
                  ) : (
                    <Icon name="x" size={12} color={theme.colors.inverseForeground} />
                  )}
                  <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.display, fontSize: 14, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    {abandoning ? t('exit.discarding') : t('exit.discardConfirmYes')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('exit.discardConfirmBack')}
                  accessibilityState={{ disabled: abandoning }}
                  disabled={abandoning}
                  onPress={onBack}
                  style={{ alignSelf: 'center', marginTop: 10, paddingVertical: 10, paddingHorizontal: 18 }}
                >
                  <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                    {t('exit.discardConfirmBack')}
                  </Text>
                </Pressable>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Badge({
  children,
  bg,
  border,
  color,
}: {
  children: React.ReactNode;
  bg: string;
  border: string;
  color: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.monoBold,
          fontSize: 9,
          letterSpacing: 1,
          color,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/* ───────────────────────────── CARDIO FINISHER ───────────────────────────── */

/**
 * Post-strength cardio finisher — its own focused experience, not a
 * stopwatch bolted onto the exercise UI. `elapsed`/`target`/`remaining` are
 * always derived from absolute timestamps (`cardioTimer.ts`), the same
 * principle as the main workout timer and the rest timer: correct across
 * background/lock, never a tick counter.
 *
 * State lives locally (READY/RUNNING/FINISHED, `CardioSession`) because
 * `WorkoutScreen` itself is never unmounted while minimized to another tab
 * (AppShell keeps it mounted with `pointerEvents`/opacity toggling) — a
 * React Context mirroring `RestSessionContext` isn't needed for that case.
 * AsyncStorage persistence (`cardioSessionStorage`) is a best-effort extra
 * for a JS-runtime restart within the same app session; it cannot help
 * across a full process kill because `WorkoutScreen` itself doesn't survive
 * one today (`AppShell`'s `workoutInProgress` is plain `useState`, and the
 * exercise-by-exercise `order`/`progress` state has the same limitation —
 * see `RestSessionContext`'s own cold-mount comment). Closing that gap is a
 * separate, broader lifecycle change outside this feature's scope.
 */
function CardioScreen({
  cardioFinisher,
  ownerKey,
  onRequestExit,
  exitDialog,
  onCardioCompleted,
  onFinish,
}: {
  cardioFinisher: FinalCardioFinisher;
  /** Identifies this workout attempt — from `workoutStartedAtMs`, so a stale persisted session from a previous attempt is never mistakenly restored. */
  ownerKey: string;
  onRequestExit: () => void;
  exitDialog: React.ReactNode;
  /** See `Props.onCardioCompleted`'s doc comment above. */
  onCardioCompleted?: (actualDurationSeconds: number) => Promise<{ ok: true } | { ok: false; error: unknown }>;
  onFinish: (actualDurationSeconds: number) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const tLoose = t as unknown as LooseT;
  const cardio = resolveCardioFinisherPresentation(tLoose, cardioFinisher);
  const plannedDurationSeconds = useMemo(
    () => parsePrescribedCardioDurationSeconds(cardioFinisher.duration),
    [cardioFinisher.duration],
  );
  const cardioSessionId = `cardio_${ownerKey}`;

  const [session, setSession] = useState<CardioSession>(() =>
    createCardioSession({ cardioSessionId, workoutSessionId: ownerKey, plannedDurationSeconds })
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const publish = (next: CardioSession) => {
    if (next === sessionRef.current) return;
    sessionRef.current = next;
    setSession(next);
    void persistCardioSession(next);
  };

  // Restores a same-process JS remount (see doc comment above) — a
  // different `ownerKey` (a genuinely different workout attempt) never
  // adopts another attempt's persisted clock.
  useEffect(() => {
    let mounted = true;
    void readCardioSession().then((persisted) => {
      if (!mounted) return;
      if (persisted && persisted.workoutSessionId === ownerKey && persisted.status !== 'FINISHED') {
        sessionRef.current = persisted;
        setSession(persisted);
      } else if (persisted) {
        void clearCardioSession();
      }
    });
    return () => {
      mounted = false;
    };
    // Intentionally mount-only: this restores whatever was persisted for
    // this exact cardio attempt, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (session.status !== 'RUNNING') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session.status]);
  useEffect(() => {
    if (session.status !== 'RUNNING') return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, [session.status]);

  const elapsed = computeCardioElapsedSeconds(session, now);
  const remaining = remainingCardioSeconds(elapsed, session.targetDurationSeconds);
  const progress = cardioProgressRatio(elapsed, session.targetDurationSeconds);
  const targetReached = elapsed >= session.targetDurationSeconds;

  // One-shot celebration (docs §16) — fires exactly on the tick that
  // crosses the live target, never again while still over it, and re-arms
  // the next time a *raised* target (via +5 min) is crossed.
  const previousElapsedRef = useRef(elapsed);
  const [justReachedTarget, setJustReachedTarget] = useState(false);
  const celebrationAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const previousElapsed = previousElapsedRef.current;
    previousElapsedRef.current = elapsed;
    if (!crossedCardioTarget(previousElapsed, elapsed, session.targetDurationSeconds)) return;
    setJustReachedTarget(true);
    celebrationAnim.setValue(0);
    Animated.sequence([
      Animated.timing(celebrationAnim, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(celebrationAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => setJustReachedTarget(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  const lastExtendAtRef = useRef(0);
  const handleExtend = () => {
    const tapAt = Date.now();
    if (tapAt - lastExtendAtRef.current < 500) return; // guards an accidental double-tap
    lastExtendAtRef.current = tapAt;
    publish(extendCardioTarget(session, 300));
  };

  const handleStart = () => publish(startCardio(session, Date.now()));

  // Cardio Finisher Completion Recovery hardening (2026-09): the local
  // `session` never flips to FINISHED (and AsyncStorage is never cleared)
  // until `onCardioCompleted` has durably persisted the completion on the
  // Firestore execution — a network/transaction failure must never be read
  // as "cardio is confirmed done" (docs — this is the exact bug class that
  // motivated this hardening: a fire-and-forget local "done" that outran the
  // durable write). `idle -> persisting -> idle` (success) or `-> error`
  // (retryable, never silently swallowed as success).
  const [finishState, setFinishState] = useState<'idle' | 'persisting' | 'error'>('idle');
  const finishingRef = useRef(false);

  const finalizeNow = async () => {
    // Re-entrancy guard via ref (not just `finishState`, which lags a render
    // behind) — a double tap (footer "Pular cardio" + accidental second tap,
    // or the modal's "Tentar novamente" pressed twice) can never fire two
    // concurrent `completeCardioExecution` calls.
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishState('persisting');
    logInfo('workout_performance', 'finish_ui_loading_started', { timestampMs: Date.now(), source: 'cardio' });
    const cardioPersistStartedAtMs = Date.now();
    logInfo('workout_performance', 'cardio_persist_start', { timestampMs: cardioPersistStartedAtMs });
    logInfo('workout', 'cardio_finish_requested', {});
    // Frozen once, here — a retry after a failure recomputes fresh (the user
    // was still legitimately doing cardio while stuck on the error state),
    // but a single attempt always persists and locally freezes the exact
    // same duration, never two different values for one confirmed tap.
    const finishedSession = finishCardio(session, Date.now());
    const actualDurationSeconds = finishedSession.actualDurationSeconds ?? 0;
    const result = onCardioCompleted
      ? await onCardioCompleted(actualDurationSeconds)
      : ({ ok: true } as const);
    logInfo('workout_performance', 'cardio_persist_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - cardioPersistStartedAtMs,
      success: result.ok,
    });
    finishingRef.current = false;
    if (!result.ok) {
      logWarn('workout', 'cardio_finish_ui_failed', {});
      setFinishState('error');
      return;
    }
    publish(finishedSession);
    void clearCardioSession();
    setFinishState('idle');
    onFinish(actualDurationSeconds);
  };

  const [confirmSheet, setConfirmSheet] = useState<'finish' | null>(null);
  const finishModalVisible = confirmSheet === 'finish' || finishState !== 'idle';

  const handleHeaderClose = () => {
    onRequestExit();
  };

  const doneClock = formatCardioClock(elapsed);
  const targetClock = formatCardioClock(session.targetDurationSeconds);

  if (finishState === 'persisting') {
    return (
      <FullScreenLoading
        accessibilityLabel={t('done.finishing')}
        message={t('done.finishing')}
      />
    );
  }

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <CardioSessionContent
          cardio={cardio}
          ready={session.status === 'READY'}
          targetReached={targetReached}
          targetClock={targetClock}
          remainingClock={formatCardioClock(remaining)}
          progress={progress}
          finishing={false}
          onClose={handleHeaderClose}
          onSkip={() => void finalizeNow()}
          onStart={handleStart}
          onExtend={handleExtend}
          onFinish={() => setConfirmSheet('finish')}
          celebration={justReachedTarget ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                opacity: celebrationAnim,
                transform: [{ scale: celebrationAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: theme.colors.success,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={18} color={theme.colors.primaryForeground} />
            </Animated.View>
          ) : null}
        />
      </SafeAreaView>

      {exitDialog}

      <Modal
        visible={finishModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          setConfirmSheet(null);
          setFinishState('idle');
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('cardioSession.continueCardio')}
          onPress={() => {
            setConfirmSheet(null);
            setFinishState('idle');
          }}
          style={{
            flex: 1,
            backgroundColor: theme.colors.overlayStrong,
            justifyContent: 'center',
            paddingHorizontal: spacing[6],
          }}
        >
          <Pressable
            accessibilityRole="none"
            onPress={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: sizes.modalMaxWidth,
              alignSelf: 'center',
              borderRadius: radii.xl,
              borderBottomRightRadius: 0,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.colors.primaryBorderQuiet,
              backgroundColor: theme.colors.background,
              shadowColor: theme.colors.primary,
              shadowOpacity: 0.18,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 10 },
              elevation: 10,
            }}
          >
            <LinearGradient
              colors={theme.gradients.poster}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: spacing[5] }}
            >
              <HudCorners color={theme.colors.hudCorner} />
              <Slash accentColor={theme.colors.primaryEmphasis} textColor={theme.colors.textFaint}>
                {t('cardioFinisher.title').toUpperCase()}
              </Slash>

              {finishState === 'error' ? (
                <>
                  <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
                    {t('cardioSession.finishErrorTitle').toUpperCase()}
                  </Display>
                  <Text style={{ marginTop: 8, fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondaryStrong, lineHeight: 19 }}>
                    {t('cardioSession.finishErrorBody')}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('cardioSession.finishRetry')}
                    onPress={() => void finalizeNow()}
                    style={{
                      height: 48,
                      marginTop: 18,
                      borderRadius: 10,
                      borderBottomRightRadius: 0,
                      backgroundColor: theme.colors.inverseSurface,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 9,
                    }}
                  >
                    <Icon name="swap" size={12} color={theme.colors.inverseForeground} />
                    <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.display, fontSize: 15, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                      {t('cardioSession.finishRetry')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('cardioSession.continueCardio')}
                    onPress={() => {
                      setConfirmSheet(null);
                      setFinishState('idle');
                    }}
                    style={{ alignSelf: 'center', marginTop: 10, paddingVertical: 10, paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                      {t('cardioSession.continueCardio')}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
                    {t('cardioSession.finishConfirmTitle').toUpperCase()}
                  </Display>
                  <Text style={{ marginTop: 8, fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondaryStrong, lineHeight: 19 }}>
                    {t(targetReached ? 'cardioSession.finishConfirmAfterGoal' : 'cardioSession.finishConfirmBeforeGoal', {
                      done: doneClock,
                      target: targetClock,
                    })}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('cardioSession.confirmFinish')}
                    onPress={() => void finalizeNow()}
                    style={{
                      height: 48,
                      marginTop: 18,
                      borderRadius: 10,
                      borderBottomRightRadius: 0,
                      backgroundColor: theme.colors.inverseSurface,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 9,
                    }}
                  >
                    <Icon name="check" size={12} color={theme.colors.inverseForeground} />
                    <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.display, fontSize: 15, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                      {t('cardioSession.confirmFinish')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('cardioSession.continueCardio')}
                    onPress={() => setConfirmSheet(null)}
                    style={{ alignSelf: 'center', marginTop: 10, paddingVertical: 10, paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                      {t('cardioSession.continueCardio')}
                    </Text>
                  </Pressable>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBg>
  );
}

/* ────────────────────────────── REST OVERLAY ────────────────────────────── */

function RestOverlay({
  remainingSeconds,
  progress,
  fmt,
  regWeight,
  setRegWeight,
  setNumber,
  finalSetLoadEntry,
  continuesToCardio,
  onAdd15,
  onSkip,
  onMinimize,
}: {
  remainingSeconds: number;
  progress: number;
  fmt: (s: number) => string;
  regWeight: number;
  setRegWeight: (fn: number | ((prev: number) => number)) => void;
  setNumber: number;
  finalSetLoadEntry?: boolean;
  continuesToCardio?: boolean;
  onAdd15: () => void;
  onSkip: () => void;
  onMinimize?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const { resolvedUnits } = useUnits();
  const loadUnit = workoutLoadUnit(resolvedUnits);
  const registerButtonStyle = {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.selectionBackground,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorderInteractive,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  return (
    // Tapping anywhere in the overlay dismisses the keyboard — RN's touch
    // responder system only lets this `onPress` fire when the touch didn't
    // land on a nested Pressable/TextInput (they claim the responder first),
    // so the +/-, +15s, "next set" buttons and the weight `TextInput` all
    // keep working exactly as before; only empty space around them dismisses.
    <Pressable
      accessibilityRole="none"
      onPress={() => Keyboard.dismiss()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.workoutOverlayStrong,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        zIndex: 20,
      }}
    >
      {onMinimize && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('rest.minimizeAccessibility')}
          onPress={onMinimize}
          style={{
            position: 'absolute',
            top: 54,
            right: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingVertical: 9,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: theme.colors.surfacePressed,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
          }}
        >
          <Icon name="minus" size={13} color={theme.colors.primaryEmphasis} />
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1, color: theme.colors.textPrimary }}>
            {t('rest.minimize').toUpperCase()}
          </Text>
        </Pressable>
      )}
      <Slash style={{ marginBottom: 14 }}>{t('rest.title').toUpperCase()}</Slash>
      <Text
        style={{
          fontFamily: theme.fonts.display,
          fontSize: 104,
          color: theme.colors.textPrimary,
          lineHeight: displayLineHeight(104),
          transform: [{ skewX: '-8deg' }],
        }}
      >
        {fmt(remainingSeconds)}
      </Text>
      <View style={{ width: 220, marginTop: 22 }}>
        <SegBar value={progress} segs={14} />
      </View>

      {/* weight logging card */}
      <View
        style={{
          width: '100%',
          maxWidth: 320,
          marginTop: 36,
          borderRadius: 18,
          padding: 18,
          backgroundColor: theme.colors.inputBackgroundSubtle,
          borderWidth: 1,
          borderColor: theme.colors.dividerStrong,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <MonoLabel>
            {t('rest.logLoad', { setNumber }).toUpperCase()}
          </MonoLabel>
          <Text style={{ fontSize: 10.5, color: theme.colors.textFaint, fontStyle: 'italic' }}>
            {t('rest.optional')}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <Pressable
            onPress={() => setRegWeight((kg: number) => adjustWorkoutLoadKg(kg, -1, resolvedUnits))}
            style={registerButtonStyle}
          >
            <Icon name="minus" size={16} color={theme.colors.primaryEmphasis} />
          </Pressable>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'center',
              minWidth: 96,
            }}
          >
            <TextInput
              value={regWeight > 0 ? formatWorkoutLoadFromKg(regWeight, resolvedUnits) : ''}
              placeholder="—"
              placeholderTextColor={theme.colors.textFaint}
              keyboardType="decimal-pad"
              onChangeText={(t) => {
                const v = t.replace(',', '.').replace(/[^0-9.]/g, '');
                setRegWeight(v === '' ? 0 : workoutLoadToKg(parseFloat(v) || 0, resolvedUnits));
              }}
              style={{
                width: 96,
                textAlign: 'center',
                fontFamily: theme.fonts.display,
                transform: [{ skewX: '-8deg' }],
                fontSize: 46,
                lineHeight: displayLineHeight(46),
                color: theme.colors.inputText,
                padding: 0,
              }}
            />
            <Text style={{ fontSize: 14, color: theme.colors.textFaint, marginLeft: 2 }}>
              {loadUnit}
            </Text>
          </View>
          <Pressable
            onPress={() => setRegWeight((kg: number) => adjustWorkoutLoadKg(kg, 1, resolvedUnits))}
            style={registerButtonStyle}
          >
            <Icon name="plus" size={16} color={theme.colors.primaryEmphasis} />
          </Pressable>
        </View>
        <Text
          style={{
            textAlign: 'center',
            marginTop: 10,
            fontSize: 10.5,
            color: theme.colors.textFaint,
            fontFamily: theme.fonts.mono,
          }}
        >
          {t('rest.inputHint')}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 28 }}>
        {!finalSetLoadEntry && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('rest.addSecondsAccessibility', { seconds: 15 })}
            onPress={onAdd15}
            style={{
              paddingVertical: 14,
              paddingHorizontal: 22,
              borderRadius: 12,
              backgroundColor: theme.colors.surfacePressed,
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
            }}
          >
            {/* "+15s" is a universal compact glyph — kept verbatim across
                locales; the semantic label lives in `accessibilityLabel`
                (rest.addSecondsAccessibility) so screen readers announce
                "Add 15 seconds" in the active language. */}
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, letterSpacing: 1, color: theme.colors.textPrimary }}>
              +15s
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onSkip}
          style={{
            paddingVertical: 14,
            paddingHorizontal: 28,
            minWidth: finalSetLoadEntry ? 220 : undefined,
            borderRadius: 12,
            backgroundColor: theme.colors.primary,
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.5,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: theme.fonts.display,
              fontSize: 14,
              letterSpacing: 1.5,
              color: theme.colors.primaryForeground,
              textTransform: 'uppercase',
            }}
          >
            {finalSetLoadEntry
              ? continuesToCardio
                ? t('rest.continueToCardio')
                : t('rest.finishWorkout')
              : t('rest.nextSet')}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

/* ─────────────────────────── PR CELEBRATION ─────────────────────────── */

function PROverlay({
  weight,
  exName,
  prev,
}: {
  weight: number;
  exName: string;
  prev: number;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const { resolvedUnits } = useUnits();
  const loadUnit = workoutLoadUnit(resolvedUnits);
  const displayedWeight = formatWorkoutLoadFromKg(weight, resolvedUnits);
  const displayedPrevious = formatWorkoutLoadFromKg(prev, resolvedUnits);
  const displayedDelta = Math.round(workoutLoadFromKg(weight - prev, resolvedUnits) * 10) / 10;
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.workoutOverlay,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        overflow: 'hidden',
        zIndex: 28,
      }}
    >
      <Confetti />
      <View
        style={{
          width: 120,
          height: 120,
          marginBottom: 30,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PulseRings />
        <PopBadge>
          <Icon name="trophy" size={46} color={theme.colors.primaryForeground} stroke={2.2} />
        </PopBadge>
      </View>
      <Slash style={{ marginBottom: 12 }}>{t('record.new').toUpperCase()}</Slash>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Display size={46}>{displayedWeight}</Display>
        <Text
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 22,
            color: theme.colors.primaryEmphasis,
            marginLeft: 6,
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {loadUnit.toUpperCase()}
        </Text>
      </View>
      <Text
        style={{
          marginTop: 14,
          fontSize: 14,
          color: theme.colors.textMuted,
          textAlign: 'center',
          fontFamily: theme.fonts.ui,
        }}
      >
        {t('record.previousContext', { exName, previous: displayedPrevious, unit: loadUnit })}{' '}
        <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiBold }}>
          {t('record.gain', { delta: displayedDelta, unit: loadUnit })}
        </Text>
      </Text>
    </View>
  );
}

// Celebration artwork keeps its fixed AJ Fit brand palette independent from
// the surrounding interface theme.
const CONFETTI_COLORS = ['#0b70f9', '#4da3ff', '#ffffff', '#1f82ff'];

function Confetti() {
  const anims = useRef(
    Array.from({ length: 20 }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.timing(a, {
        toValue: 1,
        duration: 1500,
        delay: (i % 5) * 40,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    Animated.parallel(animations).start();
  }, [anims]);

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: '42%', left: '50%', width: 0, height: 0 }}
    >
      {anims.map((a, i) => {
        const ang = (i / 20) * Math.PI * 2;
        const dist = 130 + (i % 4) * 38;
        const tx = Math.cos(ang) * dist;
        const ty = Math.sin(ang) * dist;
        const rot = (i * 57) % 360;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: i % 2 ? 7 : 9,
              height: i % 2 ? 7 : 9,
              borderRadius: i % 3 ? 1 : 5,
              backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              opacity: a.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, tx] }) },
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, ty] }) },
                {
                  rotate: a.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${rot}deg`],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

function PulseRings() {
  const { theme } = useTheme();
  const rings = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    const loops = rings.map((r, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 400),
          Animated.timing(r, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(r, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [rings]);

  return (
    <>
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: 96,
            height: 96,
            borderRadius: 48,
            borderWidth: 2,
            borderColor: theme.colors.primaryGlow,
            opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [
              {
                scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.5] }),
              },
            ],
          }}
        />
      ))}
    </>
  );
}

function PopBadge({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(s, {
        toValue: 1.12,
        duration: 330,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(s, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [s]);
  return (
    <Animated.View style={{ transform: [{ scale: s }] }}>
      <LinearGradient
        colors={theme.gradients.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: theme.colors.primary,
          shadowOpacity: 0.7,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 0 },
          elevation: 10,
        }}
      >
        {children}
      </LinearGradient>
    </Animated.View>
  );
}

/* ─────────────────────── EXERCISE DONE TRANSITION ─────────────────────── */

function ExerciseDoneOverlay({ name, nextName }: { name: string; nextName: string }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.workoutOverlayStrong,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        zIndex: 26,
      }}
    >
      <View
        style={{
          width: 120,
          height: 120,
          marginBottom: 32,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PulseRings />
        <PopBadge>
          <Icon name="check" size={48} color={theme.colors.primaryForeground} stroke={3} />
        </PopBadge>
      </View>
      <Slash style={{ marginBottom: 12 }}>
        {t('exerciseDone.completed').toUpperCase()}
      </Slash>
      <Display size={30} style={{ textAlign: 'center' }}>
        {name}
      </Display>
      <View
        style={{
          marginTop: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 18,
          borderRadius: 14,
          backgroundColor: theme.colors.controlBackground,
          borderWidth: 1,
          borderColor: theme.colors.primaryBorderSubtle,
        }}
      >
        <MonoLabel color={theme.colors.primaryEmphasis}>
          {t('exerciseDone.nextLabel').toUpperCase()}
        </MonoLabel>
        <Icon name="arrow-right" size={15} color={theme.colors.primaryEmphasis} />
        <Text style={{ fontSize: 15, fontFamily: theme.fonts.uiBold, color: theme.colors.textPrimary }}>{nextName}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── WORKOUT DONE ─────────────────────────── */

function WorkoutDone({
  elapsed,
  doneSets,
  totalSets,
  onDone,
}: {
  elapsed: number;
  doneSets: number;
  totalSets: number;
  onDone: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const shareWorkout = () => {
    void Share.share({ message: t('done.shareMessage', { time: fmt(elapsed), sets: `${doneSets}/${totalSets}` }) })
      .catch((error) => logWarn('workout', 'workout_share_failed', { error }));
  };
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, paddingHorizontal: 26, paddingTop: 20, paddingBottom: 36 }}>
          <OutlineNumber
            size={300}
            style={{ position: 'absolute', top: -50, right: -60, opacity: 0.4 }}
          >
            ✓
          </OutlineNumber>

          <Slash style={{ marginBottom: 14 }}>
            {t('done.kicker').toUpperCase()}
          </Slash>
          <Display size={46}>{t('done.titleLine1').toUpperCase()}</Display>
          <Display size={46} color={theme.colors.primaryEmphasis}>
            {t('done.titleLine2').toUpperCase()}
          </Display>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 30,
            }}
          >
            {(
              // Phase 2, Part G: `volume` and `newPr` were hardcoded demo
              // values (always "8.2t" / "+1") shown as if they were real
              // results — removed rather than left presenting fabricated
              // data as fact. No reliable infrastructure exists yet to
              // compute either for real (actual reps performed per set
              // isn't logged today, only weight; PR detection exists
              // per-set during the session but nothing aggregates a count
              // across the workout) — this phase does not add a
              // Progression/PR Engine to manufacture one. `time` and `sets`
              // are both real, already-tracked session state.
              [
                { key: 'time', v: fmt(elapsed) },
                { key: 'sets', v: `${doneSets}/${totalSets}` },
              ] as const
            ).map((s) => (
              <Card key={s.key} style={{ width: '47%', padding: 16 }}>
                <MonoLabel>{t(`done.metrics.${s.key}`).toUpperCase()}</MonoLabel>
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 30,
                    color: theme.colors.textPrimary,
                    marginTop: 8,
                    transform: [{ skewX: '-8deg' }],
                    textTransform: 'uppercase',
                  }}
                >
                  {s.v}
                </Text>
              </Card>
            ))}
          </View>

          {/*
            Phase 2, Part G: this card showed a hardcoded "15 day streak,
            6 until a record" regardless of the user's real history — no
            streak-tracking infrastructure exists yet to compute either
            value for real. Removed rather than left
            presenting fabricated data as fact; not replaced with a Streak
            Engine in this phase.
          */}

          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('done.share')}
            onPress={shareWorkout}
            style={{
              minHeight: 50,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.colors.primaryBorderInteractive,
              backgroundColor: theme.colors.controlBackground,
            }}
          >
            <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.display, fontSize: 16, letterSpacing: 1.3, textTransform: 'uppercase' }}>
              {t('done.share')}
            </Text>
          </Pressable>
          <CtaButton
            onPress={onDone}
            accessibilityLabel={t('done.backHome')}
          >
            <Text
              style={{
                color: theme.colors.primaryForeground,
                fontFamily: theme.fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {t('done.backHome')}
            </Text>
            <Icon name="arrow-right" size={18} color={theme.colors.primaryForeground} />
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

function WorkoutCompletionError({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  if (retrying) {
    return <FullScreenLoading accessibilityLabel={t('done.finishing')} message={t('done.finishing')} />;
  }
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 26, gap: 20 }}>
          <Text
            accessibilityRole="alert"
            style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 18, textAlign: 'center' }}
          >
            {t('done.finishFailed')}
          </Text>
          <CtaButton onPress={onRetry} accessibilityLabel={t('done.retry')}>
            <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.display, fontSize: 17, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              {t('done.retry')}
            </Text>
            <Icon name="swap" size={18} color={theme.colors.primaryForeground} />
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

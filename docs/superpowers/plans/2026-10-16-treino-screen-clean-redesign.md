# Treino Screen "Opção B (Clean)" Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visual presentation of `src/screens/TreinoScreen.tsx` with the "Treino · Opção B (Clean)" layout, without touching the Schedule Engine, `resolution`, `TreinoScreen`'s public props, or any other screen.

**Architecture:** Four new pure-presentation components under `src/components/treino/` (`TreinoWeekStrip`, `TreinoTodayBlock`, `TreinoExerciseList`, `TreinoUpcomingList`) render data that `TreinoScreen.tsx` derives using only existing exported helpers (`deriveSessionMuscles`, `buildUpcomingWorkouts`, `effectiveNextSessionIndex`, `treinoCardSession`, `resolveSessionDisplayName`, `estimateSessionMinutes`, `workoutExercisesFromPlan`) plus one new pure projection, `buildTreinoWeekStrip` (`src/home/treinoWeekStrip.ts`), which labels this week's training days with their `plan.sessions` letter by re-calling `buildUpcomingWorkouts` with a week-sized limit — never a second scheduler. `BodyMuscleMap` gets one new optional, default-`0` visual prop (`frontOffsetX`) so Treino can offset the front silhouette without touching its other 4 call sites. Per the user's explicit decision, the new Today block is **theme-aware** (uses the live `useTheme()` theme, dark or light) instead of today's forced-dark `TODAY_WORKOUT_THEME` override — a deliberate, approved behavior change scoped to this screen only; Home's own forced-dark poster is untouched.

**Tech Stack:** React Native (Expo SDK 56), TypeScript, react-i18next, Vitest (Node environment, logic-only tests — this repo has no RN component-render test harness, so new tests follow the existing convention of pure-function unit tests and source-text "architecture" assertions).

---

## Important context for the engineer

- Read `src/screens/TreinoScreen.tsx` in full before starting — every derivation it currently computes (`nextIndex`, `displayedSession`, `canStartNow`, `isFlexible`, `statusCopyKey`, `exerciseCount`, `setCount`, `sessionMuscles`, `showBodyMap`, `todayLocalDate`, `nextWorkoutDate`, `dateLabel`, `headerDateLabel`, `trainingDays`, `upcoming`) must still exist in the rewritten file, verbatim in behavior. Only their *rendering* changes.
- `TreinoScreen`'s prop signature is **frozen**: `sex, plan, resolution, completedTodaySessionIndex, scheduleConfig, workoutInProgress, startPending, onStart, onOpenAgendaEditor, onReposition, evolutionViewModel, weekOverview`. Do not add, remove, or rename any of them.
- No new call sites of `<BodyMuscleMap>` — there must still be exactly 5 in the whole repo, or `src/components/fitness/__tests__/bodyMuscleMapArchitecture.test.ts` (`'gives every production BodyMuscleMap call site an explicit sex prop'`, `expect(tags).toHaveLength(5)`) fails. We are restyling the one existing call site inside `TreinoScreen.tsx`, not adding another.
- **Known, approved omissions from the visual spec** (do not try to "fill in" these with invented data — this was already decided during planning):
  1. **Session focus line** ("Peito & Ombro" under the session name): `FinalWorkoutSession` has no focus/description field. Omit the line entirely.
  2. **"Em andamento" progress bar** (sets done / total): that data is not in any prop `TreinoScreen` receives, and its prop signature is frozen. Omit the bar; keep only the "Retomar treino" CTA.
  3. **Week-strip header summary** ("N de M treinos"): the clean layout's week strip has no slot for it. It is preserved as data, not dropped — folded into the strip's `accessibilityLabel` instead of shown visually.
  4. **"Próximos treinos" row meta "{Nome} · {Foco}"**: same as (1), no `Foco` field exists — the row title is the session name alone.
- **Theme:** per explicit user decision, the new Today block must use the live `useTheme()` theme (dark or light), not a forced-dark override. Delete the `TODAY_WORKOUT_THEME = darkTheme` constant and its usages from `TreinoScreen.tsx`. Do not touch `HomeScreen.tsx` — its own forced-dark poster is out of scope and keeps its current behavior.
- A few spec colors have no exact existing token (e.g. `rgba(255,255,255,0.45)`, the 3-stop muscle-dot scale `#4da3ff → #2a8aff → #1f6fd6`, `rgba(255,255,255,0.38)` for the mono "cap" label). Use literals for those (noted per-file below) — do not invent new semantic tokens in `tokens.ts` for a single screen.
- i18n: this repo enforces resource parity across locales (`src/i18n/__tests__/resourceParity.test.ts` — same leaf-key set in `pt-BR`, `en`, `es`). Every new key must be added to all three files in the same task, with the same shape.

---

## Task 1: `BodyMuscleMap` — add the `frontOffsetX` visual prop

**Files:**
- Modify: `src/components/fitness/BodyMuscleMap.tsx`

- [ ] **Step 1: Add the prop to the interface and destructure it with a `0` default**

In `src/components/fitness/BodyMuscleMap.tsx`, add to `BodyMuscleMapProps` (after `gap?: number;`):

```ts
  gap?: number;
  /**
   * Visual-only horizontal shift of the FRONT silhouette, in px. The back
   * silhouette never moves. Default `0` is a no-op — every existing call
   * site (Home's/Treino's Today poster, onboarding, workout summary,
   * posters) keeps its current layout untouched.
   */
  frontOffsetX?: number;
  style?: StyleProp<ViewStyle>;
```

And in the `BodyMuscleMap` function signature, add `frontOffsetX = 0,` right after `gap = 6,`.

- [ ] **Step 2: Wrap the front `DiagramView` in an offset `View`**

Replace:

```tsx
  return (
    <View style={[{ flexDirection: 'row', gap }, style]}>
      <DiagramView
        diagramKey={bodyMuscleMapDiagramKey(sex, 'front')}
        diagram={anatomy.front}
        {...sharedProps}
      />
      <DiagramView
        diagramKey={bodyMuscleMapDiagramKey(sex, 'back')}
        diagram={anatomy.back}
        {...sharedProps}
      />
    </View>
  );
```

with:

```tsx
  return (
    <View style={[{ flexDirection: 'row', gap }, style]}>
      <View style={frontOffsetX ? { transform: [{ translateX: frontOffsetX }] } : undefined}>
        <DiagramView
          diagramKey={bodyMuscleMapDiagramKey(sex, 'front')}
          diagram={anatomy.front}
          {...sharedProps}
        />
      </View>
      <DiagramView
        diagramKey={bodyMuscleMapDiagramKey(sex, 'back')}
        diagram={anatomy.back}
        {...sharedProps}
      />
    </View>
  );
```

- [ ] **Step 3: Verify no other call site is affected**

Run: `grep -rn "<BodyMuscleMap" src --include="*.tsx" | grep -v __tests__`
Expected: the same 5 call sites as before (Treino, onboarding's `MuscleFocusBodyMapPicker`, `MusclesWorkedSection`, `PosterBodyMap`, `PosterCreative`) — none of them pass `frontOffsetX`, so all keep rendering exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/components/fitness/BodyMuscleMap.tsx
git commit -m "feat(treino): add optional frontOffsetX visual prop to BodyMuscleMap"
```

---

## Task 2: `buildTreinoWeekStrip` — pure week-strip projection (TDD)

**Files:**
- Create: `src/home/treinoWeekStrip.ts`
- Test: `src/home/__tests__/treinoWeekStrip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/home/__tests__/treinoWeekStrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTreinoWeekStrip } from '../treinoWeekStrip';
import type { WeekOverviewViewModel } from '../weekOverview';
import type { ScheduleResolution } from '../../scheduleEngine/types';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';

function session(name: string): FinalWorkoutSession {
  return { name, type: 'resistance', exercises: [] };
}

const SESSIONS = [session('A'), session('B'), session('C')];

// Monday 2026-10-12 .. Sunday 2026-10-18. Training days MON/WED/FRI.
function overview(statusByDate: Record<string, WeekOverviewViewModel['days'][number]['status']>, todayLocalDate: string): WeekOverviewViewModel {
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
  const days = dates.map((localDate, index) => ({
    localDate,
    weekday: weekdays[index],
    status: statusByDate[localDate] ?? 'REST',
    isToday: localDate === todayLocalDate,
  }));
  return { days, scheduledCount: 3, completedCount: 0 };
}

describe('buildTreinoWeekStrip', () => {
  it('labels today with the resolution cursor and the next training day with the projected letter', () => {
    const todayLocalDate = '2026-10-12'; // Monday
    const resolution: ScheduleResolution = { status: 'SESSION_READY', sessionIndex: 0 };
    const result = buildTreinoWeekStrip({
      overview: overview({ '2026-10-12': 'TODAY_PENDING', '2026-10-14': 'UPCOMING', '2026-10-16': 'UPCOMING' }, todayLocalDate),
      todayLocalDate,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      sessions: SESSIONS,
      resolution,
      nextSessionIndex: 0,
    });

    const monday = result.find((day) => day.localDate === '2026-10-12')!;
    expect(monday.isTrainingDay).toBe(true);
    expect(monday.glyph).toBeNull();
    expect(monday.sessionIndex).toBe(0);
    expect(monday.isNextSession).toBe(true);

    const wednesday = result.find((day) => day.localDate === '2026-10-14')!;
    expect(wednesday.sessionIndex).toBe(1);
    expect(wednesday.isNextSession).toBe(false);

    const friday = result.find((day) => day.localDate === '2026-10-16')!;
    expect(friday.sessionIndex).toBe(2);

    const tuesday = result.find((day) => day.localDate === '2026-10-13')!;
    expect(tuesday.isTrainingDay).toBe(false);
    expect(tuesday.sessionIndex).toBeNull();
  });

  it('keeps the week-overview glyph for MISSED/COMPLETED/FULFILLED_EARLY days and never attaches a session letter to them', () => {
    const todayLocalDate = '2026-10-16'; // Friday
    const resolution: ScheduleResolution = { status: 'SESSION_READY', sessionIndex: 2 };
    const result = buildTreinoWeekStrip({
      overview: overview({
        '2026-10-12': 'COMPLETED',
        '2026-10-14': 'MISSED',
        '2026-10-16': 'TODAY_PENDING',
      }, todayLocalDate),
      todayLocalDate,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      sessions: SESSIONS,
      resolution,
      nextSessionIndex: 2,
    });

    const monday = result.find((day) => day.localDate === '2026-10-12')!;
    expect(monday.glyph).toBe('COMPLETED');
    expect(monday.sessionIndex).toBeNull();
    expect(monday.isNextSession).toBe(false);

    const wednesday = result.find((day) => day.localDate === '2026-10-14')!;
    expect(wednesday.glyph).toBe('MISSED');
    expect(wednesday.sessionIndex).toBeNull();

    const friday = result.find((day) => day.localDate === '2026-10-16')!;
    expect(friday.glyph).toBeNull();
    expect(friday.sessionIndex).toBe(2);
    expect(friday.isNextSession).toBe(true);
  });

  it('marks the first upcoming day as next when today itself has no pending session (REST_DAY)', () => {
    const todayLocalDate = '2026-10-13'; // Tuesday, a REST day
    const resolution: ScheduleResolution = { status: 'REST_DAY', nextWorkoutDate: '2026-10-14', nextSessionIndex: 1 };
    const result = buildTreinoWeekStrip({
      overview: overview({ '2026-10-12': 'COMPLETED', '2026-10-14': 'UPCOMING' }, todayLocalDate),
      todayLocalDate,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
      sessions: SESSIONS,
      resolution,
      nextSessionIndex: 1,
    });

    const wednesday = result.find((day) => day.localDate === '2026-10-14')!;
    expect(wednesday.sessionIndex).toBe(1);
    expect(wednesday.isNextSession).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/home/__tests__/treinoWeekStrip.test.ts`
Expected: FAIL — `Cannot find module '../treinoWeekStrip'`.

- [ ] **Step 3: Implement `buildTreinoWeekStrip`**

Create `src/home/treinoWeekStrip.ts`:

```ts
import type { ScheduleMode, Weekday } from '../state/AppState';
import type { LocalDate } from '../scheduleEngine/calendar';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { FinalWorkoutSession } from '../workoutPrescription/types';
import type { WeekOverviewViewModel } from './weekOverview';
import { buildUpcomingWorkouts } from './upcomingWorkouts';

export type TreinoWeekStripGlyph = 'COMPLETED' | 'MISSED' | 'FULFILLED_EARLY';

export interface TreinoWeekStripDayViewModel {
  localDate: LocalDate;
  weekday: Weekday;
  isToday: boolean;
  /** Two-digit day-of-month, e.g. "05". */
  dayNumber: string;
  /** Whether this day carries a training obligation at all (vs REST/ACTIVE_RECOVERY/BEFORE_PROGRAM). */
  isTrainingDay: boolean;
  glyph: TreinoWeekStripGlyph | null;
  /** `plan.sessions` index for this day, or null when there is no honest projection for it (rest day, or the glyph already tells the story). */
  sessionIndex: number | null;
  /** True for the single day that is the very next session to perform. */
  isNextSession: boolean;
}

const TRAINING_STATUSES = new Set([
  'COMPLETED', 'TODAY_COMPLETED', 'FULFILLED_EARLY', 'MISSED', 'TODAY_PENDING', 'UPCOMING',
]);

/**
 * "Faixa da semana" (Treino · Opção B). Labels which of THIS WEEK's
 * training days carries which `plan.sessions` letter by reusing the exact
 * same forward projection "Próximos treinos" already calls
 * (`buildUpcomingWorkouts`), with a week-sized limit — never a second
 * scheduler. Past days keep the Schedule Engine's own week-overview glyph
 * (COMPLETED/MISSED/FULFILLED_EARLY) instead of a session letter, because
 * the engine does not expose which session a missed/early day belonged to.
 */
export function buildTreinoWeekStrip(input: {
  overview: WeekOverviewViewModel;
  todayLocalDate: LocalDate;
  scheduleMode?: ScheduleMode;
  trainingDays: readonly Weekday[];
  sessions: readonly FinalWorkoutSession[];
  resolution: ScheduleResolution | null | undefined;
  /** `effectiveNextSessionIndex(resolution)` — the rotation's current cursor. */
  nextSessionIndex: number | null;
}): TreinoWeekStripDayViewModel[] {
  const { overview, todayLocalDate, scheduleMode, trainingDays, sessions, resolution, nextSessionIndex } = input;

  const projected = buildUpcomingWorkouts({
    todayLocalDate,
    scheduleMode,
    trainingDays,
    sessions,
    resolution,
    limit: 7,
  });
  const sessionIndexByDate = new Map(projected.map((workout) => [workout.localDate, workout.sessionIndex]));
  const firstUpcomingDate = projected[0]?.localDate ?? null;

  const todayHasPendingSession = resolution?.status === 'SESSION_READY'
    || resolution?.status === 'MISSED_SESSION_DECISION_REQUIRED';

  return overview.days.map((day): TreinoWeekStripDayViewModel => {
    const glyph: TreinoWeekStripGlyph | null =
      day.status === 'COMPLETED' || day.status === 'TODAY_COMPLETED' ? 'COMPLETED' :
      day.status === 'MISSED' ? 'MISSED' :
      day.status === 'FULFILLED_EARLY' ? 'FULFILLED_EARLY' :
      null;

    const sessionIndex = glyph
      ? null
      : day.isToday && todayHasPendingSession
        ? nextSessionIndex
        : sessionIndexByDate.get(day.localDate) ?? null;

    const isNextSession = !glyph && (
      (day.isToday && todayHasPendingSession)
      || (!todayHasPendingSession && day.localDate === firstUpcomingDate)
    );

    return {
      localDate: day.localDate,
      weekday: day.weekday,
      isToday: day.isToday,
      dayNumber: day.localDate.slice(8, 10),
      isTrainingDay: TRAINING_STATUSES.has(day.status),
      glyph,
      sessionIndex,
      isNextSession,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/home/__tests__/treinoWeekStrip.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/home/treinoWeekStrip.ts src/home/__tests__/treinoWeekStrip.test.ts
git commit -m "feat(treino): add buildTreinoWeekStrip pure week-strip projection"
```

---

## Task 3: `TreinoWeekStrip` presentational component

**Files:**
- Create: `src/components/treino/TreinoWeekStrip.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/treino/TreinoWeekStrip.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import type { TreinoWeekStripDayViewModel } from '../../home/treinoWeekStrip';

const LETTER_FAINT = 'rgba(255,255,255,0.4)'; // spec §3.2.B letter on non-next training days
const SIGLA_FAINT = 'rgba(255,255,255,0.35)'; // spec §3.2.B weekday sigla on non-today days

function DayGlyph({ day }: { day: TreinoWeekStripDayViewModel }) {
  const { theme } = useTheme();

  if (day.glyph === 'COMPLETED') {
    return <Icon name="check" size={11} color={theme.colors.primaryEmphasis} stroke={2.6} />;
  }
  if (day.glyph === 'FULFILLED_EARLY') {
    return <Icon name="arrow-right" size={11} color={theme.colors.primaryEmphasis} stroke={2} />;
  }
  if (day.glyph === 'MISSED') {
    return <Icon name="x" size={11} color={theme.colors.textMuted} stroke={2} />;
  }
  if (day.sessionIndex != null) {
    return (
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 9,
          letterSpacing: 0.6,
          color: day.isNextSession ? theme.colors.primaryEmphasis : LETTER_FAINT,
        }}
      >
        {String.fromCharCode(65 + day.sessionIndex)}
      </Text>
    );
  }
  return null;
}

/**
 * "Faixa da semana" (Treino · Opção B §3.2.B). A single full-width
 * `Pressable` that opens the agenda editor — the week-summary count that
 * used to live in `WeeklyOverview`'s header is preserved in
 * `accessibilityLabel` only; the clean layout has no visual slot for it.
 */
export function TreinoWeekStrip({
  days,
  dimmed,
  disabled,
  weekSummaryLabel,
  onPress,
}: {
  days: TreinoWeekStripDayViewModel[];
  /** Flexible mode or workout-in-progress — visually de-emphasized, still pressable unless `disabled`. */
  dimmed: boolean;
  /** Workout in progress — the strip never opens the agenda while a session is running. */
  disabled: boolean;
  /** "{completed} de {scheduled} treinos esta semana" — folded into a11y only, see spec §9.3. */
  weekSummaryLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('treino');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('agenda.edit')} · ${weekSummaryLabel}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 22,
        flexDirection: 'row',
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      {days.map((day) => (
        <View key={day.localDate} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 8.5,
              letterSpacing: 0.8,
              color: day.isToday ? theme.colors.textPrimary : SIGLA_FAINT,
            }}
          >
            {t(`agenda.weekday.${day.weekday}`)}
          </Text>
          <View
            accessibilityLabel={t(`agenda.weekday.${day.weekday}`)}
            accessibilityRole="text"
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: day.isToday ? theme.colors.inverseSurface : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiSemi,
                fontSize: 14,
                color: day.isToday
                  ? theme.colors.inverseForeground
                  : day.isTrainingDay
                    ? theme.colors.textPrimary
                    : theme.colors.textFaint,
              }}
            >
              {day.dayNumber}
            </Text>
          </View>
          <View style={{ height: 12, alignItems: 'center', justifyContent: 'center' }}>
            <DayGlyph day={day} />
          </View>
        </View>
      ))}
    </Pressable>
  );
}
```

> **ERRATA (aplicada no commit `14b0b93`):** o código acima declarava `LETTER_FAINT = 'rgba(255,255,255,0.4)'` e `SIGLA_FAINT = 'rgba(255,255,255,0.35)'` como literais. Isso estava **errado** para uma tela theme-aware: branco semitransparente fica ilegível no tema claro. Ambas as constantes foram removidas e os dois usos passaram a ler `theme.colors.textFaint`. Veja a tabela no §9 item 5.

- [ ] **Step 2: Typecheck just this file's imports**

Run: `npx tsc --noEmit -p . 2>&1 | grep "TreinoWeekStrip"`
Expected: no output (no new errors, no unused-var warnings).

- [ ] **Step 3: Commit**

```bash
git add src/components/treino/TreinoWeekStrip.tsx
git commit -m "feat(treino): add TreinoWeekStrip presentational component"
```

---

## Task 4: `TreinoTodayBlock` presentational component

**Files:**
- Create: `src/components/treino/TreinoTodayBlock.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/treino/TreinoTodayBlock.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { BodyMuscleMap } from '../fitness/BodyMuscleMap';
import { useTheme } from '../../theme';
import type { Sex } from '../../state/AppState';
import type { MuscleId } from '../../types/exercise';

const SESSION_LABEL_FAINT = 'rgba(255,255,255,0.45)'; // spec §3.2.C — no exact 0.45 white token
const METRIC_LABEL_FAINT = 'rgba(255,255,255,0.45)';
const METRIC_UNIT_FAINT = 'rgba(255,255,255,0.45)';
const MUSCLE_SECONDARY_TEXT = 'rgba(255,255,255,0.55)'; // == alpha.white55 / theme.colors.textMuted exactly — kept literal here for locality with the dot-color scale below
const MUSCLE_DOT_FROM = '#4da3ff';
const MUSCLE_DOT_TO = '#1f6fd6';

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Linear RGB interpolation between two `#rrggbb` literals — purely visual, the 3-stop "intensity scale" from spec §3.1. */
function muscleDotColor(index: number, total: number): string {
  const t = total > 1 ? index / (total - 1) : 0;
  const from = parseInt(MUSCLE_DOT_FROM.slice(1), 16);
  const to = parseInt(MUSCLE_DOT_TO.slice(1), 16);
  const r = clampByte(((from >> 16) & 255) + (((to >> 16) & 255) - ((from >> 16) & 255)) * t);
  const g = clampByte(((from >> 8) & 255) + (((to >> 8) & 255) - ((from >> 8) & 255)) * t);
  const b = clampByte((from & 255) + ((to & 255) - (from & 255)) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export interface TreinoTodayBlockMuscleItem {
  id: MuscleId;
  name: string;
}

export interface TreinoTodayBlockMetric {
  value: string;
  unit?: string;
  label: string;
}

export function TreinoTodayBlock({
  kicker,
  sessionLabel,
  title,
  muscles,
  sex,
  primaryMuscles,
  secondaryMuscles,
  showBodyMap,
  bodyMapSize,
  frontOffsetX,
  metrics,
  ctaVisible,
  ctaLabel,
  ctaDisabled,
  onPressCta,
}: {
  kicker: string | null;
  sessionLabel: string | null;
  title: string;
  muscles: TreinoTodayBlockMuscleItem[];
  sex: Sex;
  primaryMuscles: readonly MuscleId[];
  secondaryMuscles: readonly MuscleId[];
  showBodyMap: boolean;
  bodyMapSize: number;
  frontOffsetX: number;
  metrics: TreinoTodayBlockMetric[];
  ctaVisible: boolean;
  ctaLabel: string;
  ctaDisabled: boolean;
  onPressCta: () => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 28, paddingTop: 24, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        {kicker ? <MonoLabel>{kicker}</MonoLabel> : <View />}
        {sessionLabel && (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: SESSION_LABEL_FAINT }}>
            {sessionLabel}
          </Text>
        )}
      </View>

      <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={2}
            style={{ fontFamily: theme.fonts.uiBold, fontSize: 30, lineHeight: 33, color: theme.colors.textPrimary }}
          >
            {title}
          </Text>

          {muscles.length > 0 && (
            <View style={{ marginTop: 18, gap: 6 }}>
              {muscles.map((muscle, index) => (
                <View key={muscle.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: muscleDotColor(index, muscles.length),
                    }}
                  />
                  <Text
                    style={{
                      fontFamily: theme.fonts.ui,
                      fontSize: 13,
                      color: index === 0 ? theme.colors.textPrimary : MUSCLE_SECONDARY_TEXT,
                    }}
                  >
                    {muscle.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {showBodyMap && (
          <View style={{ minHeight: 150, justifyContent: 'flex-end' }}>
            <BodyMuscleMap
              sex={sex}
              primaryMuscles={primaryMuscles}
              secondaryMuscles={secondaryMuscles}
              activeColor={theme.colors.primaryEmphasis}
              baseColor="transparent"
              outlineColor="rgba(255,255,255,0.85)"
              size={bodyMapSize}
              gap={12}
              frontOffsetX={frontOffsetX}
            />
          </View>
        )}
      </View>

      {metrics.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            marginTop: 22,
            paddingVertical: 14,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: theme.colors.divider,
          }}
        >
          {metrics.map((metric, index) => (
            <View
              key={metric.label}
              style={{
                flex: 1,
                alignItems: 'center',
                borderLeftWidth: index > 0 ? 1 : 0,
                borderLeftColor: theme.colors.divider,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.display, fontSize: 20, lineHeight: 20, color: theme.colors.textPrimary }}>
                {metric.value}
                {metric.unit && <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: METRIC_UNIT_FAINT }}> {metric.unit}</Text>}
              </Text>
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: METRIC_LABEL_FAINT, marginTop: 5 }}>
                {metric.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {ctaVisible && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaDisabled }}
          disabled={ctaDisabled}
          onPress={onPressCta}
          style={{
            marginTop: 20,
            paddingVertical: 17,
            borderRadius: 12,
            backgroundColor: theme.colors.primary,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            opacity: ctaDisabled ? 0.6 : 1,
          }}
        >
          <Icon name="play" size={13} color={theme.colors.primaryForeground} />
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 16, color: theme.colors.primaryForeground }}>
            {ctaLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
```

> **ERRATA (aplicada no commit `14b0b93`):** as constantes `SESSION_LABEL_FAINT`, `METRIC_LABEL_FAINT`, `METRIC_UNIT_FAINT` e `MUSCLE_SECONDARY_TEXT` acima, além do `outlineColor="rgba(255,255,255,0.85)"` do `BodyMuscleMap`, eram literais brancos e ficavam ilegíveis no tema claro. Foram substituídos por `theme.colors.textInactive` (os três primeiros), `theme.colors.textMuted` (músculo secundário) e `theme.colors.textEmphasis` (contorno). `MUSCLE_DOT_FROM`/`MUSCLE_DOT_TO` e `baseColor="transparent"` permanecem literais de propósito. Veja a tabela no §9 item 5.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep "TreinoTodayBlock"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/treino/TreinoTodayBlock.tsx
git commit -m "feat(treino): add TreinoTodayBlock presentational component"
```

---

## Task 5: `TreinoExerciseList` presentational component

**Files:**
- Create: `src/components/treino/TreinoExerciseList.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/treino/TreinoExerciseList.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';

export interface TreinoExerciseListItem {
  id: string;
  name: string;
}

function ExerciseRow({ index, name, isFirst }: { index: number; name: string; isFirst: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 13,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: theme.colors.divider,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textMuted }}>
          {String(index + 1).padStart(2, '0')}
        </Text>
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}>
        {name}
      </Text>
    </View>
  );
}

/**
 * "Exercícios" (Treino · Opção B §3.2.D). Shows the first `visibleCount`
 * exercises; the rest reveal with a 250ms fade + 14px rise (collapse is
 * instant — the spec only describes an entrance animation).
 */
export function TreinoExerciseList({
  title,
  exercises,
  visibleCount = 4,
  showAllLabel,
  showLessLabel,
}: {
  title: string;
  exercises: TreinoExerciseListItem[];
  visibleCount?: number;
  showAllLabel: (count: number) => string;
  showLessLabel: string;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const revealAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!expanded) return;
    Animated.timing(revealAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [expanded, revealAnim]);

  if (exercises.length === 0) return null;

  const visible = exercises.slice(0, visibleCount);
  const hidden = exercises.slice(visibleCount);

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 40 }}>
      <MonoLabel style={{ marginBottom: 16 }}>{title}</MonoLabel>
      {visible.map((exercise, index) => (
        <ExerciseRow key={exercise.id} index={index} name={exercise.name} isFirst={index === 0} />
      ))}
      {expanded && (
        <Animated.View
          style={{
            opacity: revealAnim,
            transform: [{ translateY: revealAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
          }}
        >
          {hidden.map((exercise, offset) => (
            <ExerciseRow key={exercise.id} index={visibleCount + offset} name={exercise.name} isFirst={false} />
          ))}
        </Animated.View>
      )}
      {hidden.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => {
            if (expanded) revealAnim.setValue(0);
            setExpanded((value) => !value);
          }}
          style={{ marginTop: 12, alignItems: 'center', paddingVertical: 6 }}
        >
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13.5, color: theme.colors.textSecondary }}>
            {expanded ? showLessLabel : showAllLabel(exercises.length)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep "TreinoExerciseList"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/treino/TreinoExerciseList.tsx
git commit -m "feat(treino): add TreinoExerciseList presentational component"
```

---

## Task 6: `TreinoUpcomingList` presentational component

**Files:**
- Create: `src/components/treino/TreinoUpcomingList.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/treino/TreinoUpcomingList.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';

export interface TreinoUpcomingListItem {
  key: string;
  /** "TER 06" (fixed mode) or the session letter (flexible mode) — already formatted by the caller. */
  dayLabel: string;
  title: string;
  meta: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/** "Próximos treinos" (Treino · Opção B §3.2.E) — plain rows, no card background, hairline between. */
export function TreinoUpcomingList({
  title,
  items,
}: {
  title: string;
  items: TreinoUpcomingListItem[];
}) {
  const { theme } = useTheme();
  if (items.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 40 }}>
      <MonoLabel style={{ marginBottom: 16 }}>{title}</MonoLabel>
      {items.map((item, index) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel}
          onPress={item.onPress}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 14,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.colors.divider,
          }}
        >
          <Text
            numberOfLines={1}
            style={{ width: 44, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1, color: theme.colors.textFaint }}
          >
            {item.dayLabel}
          </Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint, marginTop: 3 }}>
              {item.meta}
            </Text>
          </View>
          <Icon name="chevron-right" size={15} color={theme.colors.textFaint} />
        </Pressable>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep "TreinoUpcomingList"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/treino/TreinoUpcomingList.tsx
git commit -m "feat(treino): add TreinoUpcomingList presentational component"
```

---

## Task 7: i18n — add new keys to `treino.json` in all 3 locales, update one existing copy string

**Files:**
- Modify: `src/i18n/resources/pt-BR/treino.json`
- Modify: `src/i18n/resources/en/treino.json`
- Modify: `src/i18n/resources/es/treino.json`

- [ ] **Step 1: pt-BR**

In `src/i18n/resources/pt-BR/treino.json`:

Change:
```json
  "currentWorkout": {
    "continue": "Continuar treino"
  },
```
to:
```json
  "currentWorkout": {
    "continue": "Retomar treino"
  },
```

Add two new top-level keys (after `"detail"`'s closing `}`, before the file's final `}`):
```json
  ,
  "todayBlock": {
    "kickerToday": "Treino de hoje",
    "kickerNext": "Próximo · {{weekday}}",
    "sessionLabel": "Treino {{letter}}",
    "metrics": {
      "duration": "Duração",
      "durationUnit": "min",
      "exercises": "Exercícios",
      "sets": "Séries"
    }
  },
  "exercises": {
    "title": "Exercícios",
    "showAll": "Ver todos os {{count}}",
    "showLess": "Mostrar menos"
  }
```
(adjust surrounding commas so the JSON stays valid — `"detail": { ... }` is followed by `,` then the two new blocks, then the closing `}`).

- [ ] **Step 2: en**

Same structure in `src/i18n/resources/en/treino.json`:
```json
  "currentWorkout": {
    "continue": "Resume workout"
  },
```
```json
  "todayBlock": {
    "kickerToday": "Today's workout",
    "kickerNext": "Next · {{weekday}}",
    "sessionLabel": "Workout {{letter}}",
    "metrics": {
      "duration": "Duration",
      "durationUnit": "min",
      "exercises": "Exercises",
      "sets": "Sets"
    }
  },
  "exercises": {
    "title": "Exercises",
    "showAll": "View all {{count}}",
    "showLess": "Show less"
  }
```

- [ ] **Step 3: es**

Same structure in `src/i18n/resources/es/treino.json`:
```json
  "currentWorkout": {
    "continue": "Reanudar entreno"
  },
```
```json
  "todayBlock": {
    "kickerToday": "Entreno de hoy",
    "kickerNext": "Próximo · {{weekday}}",
    "sessionLabel": "Entreno {{letter}}",
    "metrics": {
      "duration": "Duración",
      "durationUnit": "min",
      "exercises": "Ejercicios",
      "sets": "Series"
    }
  },
  "exercises": {
    "title": "Ejercicios",
    "showAll": "Ver todos los {{count}}",
    "showLess": "Mostrar menos"
  }
```

- [ ] **Step 4: Validate JSON and parity**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/resources/pt-BR/treino.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/resources/en/treino.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/resources/es/treino.json','utf8')); console.log('ok')"`
Expected: `ok` (no `SyntaxError`).

Run: `npx vitest run src/i18n/__tests__/resourceParity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/resources/pt-BR/treino.json src/i18n/resources/en/treino.json src/i18n/resources/es/treino.json
git commit -m "feat(treino): add i18n keys for the clean Treino redesign"
```

---

## Task 8: Rewrite `TreinoScreen.tsx`

**Files:**
- Modify: `src/screens/TreinoScreen.tsx`

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `src/screens/TreinoScreen.tsx` with:

```tsx
import { useMemo, useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display, MonoLabel } from '../components/ui/Display';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useAuth } from '../state/AuthContext';
import { TreinoWeekStrip } from '../components/treino/TreinoWeekStrip';
import { TreinoTodayBlock, type TreinoTodayBlockMetric, type TreinoTodayBlockMuscleItem } from '../components/treino/TreinoTodayBlock';
import { TreinoExerciseList, type TreinoExerciseListItem } from '../components/treino/TreinoExerciseList';
import { TreinoUpcomingList, type TreinoUpcomingListItem } from '../components/treino/TreinoUpcomingList';
import { EvolutionTicker } from '../components/evolution/EvolutionTicker';
import { useTheme } from '../theme';
import { localDateInTimezone, weekdayOfLocalDate } from '../scheduleEngine';
import type { Sex } from '../state/AppState';
import { deriveSessionMuscles } from '../lib/sessionMuscles';
import { effectiveNextSessionIndex } from '../scheduleEngine/effectiveNextSessionIndex';
import { treinoCardSession } from './treinoCardSession';
import { buildUpcomingWorkouts, type UpcomingWorkoutViewModel } from '../home/upcomingWorkouts';
import { buildTreinoWeekStrip } from '../home/treinoWeekStrip';
import { estimateSessionMinutes } from '../home/sessionDuration';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import { TreinoWorkoutDetailSheet } from './TreinoWorkoutDetailSheet';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { logWarn } from '../lib/logger';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { ScheduleConfig, ScheduleResolution } from '../scheduleEngine/types';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import type { WeekOverviewViewModel } from '../home/weekOverview';

export type RepositionOutcome = 'OK' | 'BLOCKED_IN_PROGRESS' | 'ALREADY_COMPLETED_TODAY' | 'ERROR';

/**
 * TREINO hub (docs §Nova tela TREINO). The Schedule Engine's own resolution
 * is the only source for "what's next" — this screen never recomputes or
 * guesses it, only renders `resolution`/`plan.sessions` and forwards intent
 * (start / reposition / edit agenda) to callbacks the caller (`AppShell`)
 * wires to the real authoritative flows.
 */
export function TreinoScreen({
  sex,
  plan,
  resolution,
  completedTodaySessionIndex,
  scheduleConfig,
  workoutInProgress,
  startPending,
  onStart,
  onOpenAgendaEditor,
  onReposition,
  evolutionViewModel,
  weekOverview,
}: {
  sex: Sex;
  plan: FinalWorkoutPlan;
  resolution: ScheduleResolution;
  completedTodaySessionIndex: number | null;
  scheduleConfig: ScheduleConfig | null;
  workoutInProgress: boolean;
  startPending: boolean;
  onStart: () => void;
  onOpenAgendaEditor: () => void;
  onReposition: (targetSessionIndex: number) => Promise<RepositionOutcome>;
  evolutionViewModel: EvolutionViewModel;
  weekOverview: WeekOverviewViewModel | null;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('treino');
  const { t: tHome } = useTranslation('home');
  const { t: tWorkout } = useTranslation('workout');
  const tLoose = tHome as unknown as LooseTranslate;
  // Same avatar as Home's header (`src/screens/HomeScreen.tsx`) — real
  // photo/initials, never a fixed "AJ" placeholder.
  const { user, profile } = useAuth();
  const headerDisplayName = profile?.profile.name || user?.displayName || '';
  const [detailWorkout, setDetailWorkout] = useState<UpcomingWorkoutViewModel | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const bodyMuscleMapSize = windowWidth < 360 ? 84 : 104;
  const frontOffsetX = windowWidth < 360 ? 14 : 18;

  const nextIndex = effectiveNextSessionIndex(resolution);
  const displayedSession = treinoCardSession(plan.sessions, resolution, completedTodaySessionIndex);
  const displayedSessionIndex = resolution.status === 'TODAY_COMPLETED' ? completedTodaySessionIndex : nextIndex;
  // Same actionable-CTA set as Home's own "todayCard" (docs §Consistência com
  // Meu Plano): MISSED_SESSION_DECISION_REQUIRED keeps the normal "Iniciar
  // treino" affordance — the decision itself is only asked once the user
  // taps it (`requestStartWorkout`'s own branch), never surfaced here as a
  // second, competing flow.
  const canStartNow = workoutInProgress
    || resolution.status === 'SESSION_READY'
    || resolution.status === 'MISSED_SESSION_DECISION_REQUIRED';
  const isFlexible = (scheduleConfig?.scheduleMode ?? 'fixed') === 'flexible';

  const statusCopyKey =
    resolution.status === 'REST_DAY' ? 'restDay' :
    resolution.status === 'ACTIVE_RECOVERY_DAY' ? 'activeRecovery' :
    resolution.status === 'TODAY_COMPLETED' ? 'completedToday' :
    resolution.status === 'SCHEDULE_SETUP_REQUIRED' ? 'setupRequired' :
    resolution.status === 'MISSED_SESSION_DECISION_REQUIRED' ? 'missedDecision' :
    null;

  const exerciseCount = displayedSession?.exercises.length ?? 0;
  const setCount = displayedSession?.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 1), 0) ?? 0;
  const sessionMuscles = deriveSessionMuscles(displayedSession?.exercises.map((exercise) => exercise.exerciseId) ?? []);
  const showBodyMap = sessionMuscles.primary.length > 0;
  const todayLocalDate = localDateInTimezone(new Date(), scheduleConfig?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const nextWorkoutDate = 'nextWorkoutDate' in resolution ? resolution.nextWorkoutDate : null;
  const headerDateLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${todayLocalDate}T12:00:00Z`))
    .toUpperCase();

  const trainingDays = scheduleConfig?.trainingDays ?? [];
  const upcoming = buildUpcomingWorkouts({
    todayLocalDate,
    scheduleMode: scheduleConfig?.scheduleMode,
    trainingDays,
    sessions: plan.sessions,
    resolution,
    limit: 3,
  });

  // "TREINO DE HOJE" vs "PRÓXIMO · {DIA}" (spec §3.2.C). TODAY_COMPLETED
  // still names the finished session as "hoje" — it already happened today.
  const showsTodaySession = workoutInProgress
    || resolution.status === 'SESSION_READY'
    || resolution.status === 'MISSED_SESSION_DECISION_REQUIRED'
    || resolution.status === 'TODAY_COMPLETED';
  const nextWeekdayLabel = !showsTodaySession && nextWorkoutDate
    ? tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate(nextWorkoutDate)}`)
    : null;
  const todayBlockKicker = showsTodaySession
    ? t('todayBlock.kickerToday')
    : nextWeekdayLabel
      ? t('todayBlock.kickerNext', { weekday: nextWeekdayLabel })
      : null;
  const sessionLetter = displayedSessionIndex != null ? String.fromCharCode(65 + displayedSessionIndex) : null;
  const todayBlockSessionLabel = sessionLetter ? t('todayBlock.sessionLabel', { letter: sessionLetter }) : null;
  const todayBlockTitle = displayedSession
    ? resolveSessionDisplayName(tLoose, displayedSession.name, displayedSession.type, displayedSession.displayName)
    : statusCopyKey
      ? tHome(`schedule.${statusCopyKey}.title`)
      : '';

  const muscleListItems: TreinoTodayBlockMuscleItem[] = showBodyMap
    ? [
        ...sessionMuscles.primary.map((id) => ({ id, name: tWorkout(`muscleGroups.${id}`) })),
        ...sessionMuscles.secondary.map((id) => ({ id, name: tWorkout(`muscleGroups.${id}`) })),
      ].slice(0, 5)
    : [];

  const sessionMinutes = displayedSession ? estimateSessionMinutes(displayedSession) : 0;
  const metrics: TreinoTodayBlockMetric[] = displayedSession
    ? [
        {
          value: sessionMinutes > 0 ? String(sessionMinutes) : '—',
          unit: sessionMinutes > 0 ? t('todayBlock.metrics.durationUnit') : undefined,
          label: t('todayBlock.metrics.duration'),
        },
        { value: String(exerciseCount), label: t('todayBlock.metrics.exercises') },
        { value: String(setCount), label: t('todayBlock.metrics.sets') },
      ]
    : [];

  const ctaLabel = workoutInProgress ? t('currentWorkout.continue') : tHome('todayCard.start');

  const exerciseListItems: TreinoExerciseListItem[] = useMemo(() => {
    if (displayedSessionIndex == null) return [];
    try {
      return workoutExercisesFromPlan(plan, i18n.language, displayedSessionIndex)
        .map((exercise) => ({ id: exercise.id, name: exercise.name }));
    } catch (error) {
      logWarn('treino', 'today_exercises_unavailable', { sessionIndex: displayedSessionIndex, error });
      return [];
    }
  }, [plan, displayedSessionIndex, i18n.language]);

  const weekStripDays = weekOverview
    ? buildTreinoWeekStrip({
        overview: weekOverview,
        todayLocalDate,
        scheduleMode: scheduleConfig?.scheduleMode,
        trainingDays,
        sessions: plan.sessions,
        resolution,
        nextSessionIndex: nextIndex,
      })
    : [];
  const weekSummaryLabel = weekOverview
    ? tHome('activity.week.summary', { completed: weekOverview.completedCount, scheduled: weekOverview.scheduledCount })
    : '';

  const upcomingItems: TreinoUpcomingListItem[] = upcoming.map((workout) => {
    const a11yWeekday = workout.flexible
      ? tHome('upcoming.flexible')
      : tLoose(`quiz:trainingDays.options.${workout.weekday}`);
    const dayLabel = workout.flexible
      ? String.fromCharCode(65 + workout.sessionIndex)
      : `${t(`agenda.weekday.${workout.weekday}`)} ${workout.localDate.slice(8, 10)}`;
    const sessionLabel = resolveSessionDisplayName(tLoose, workout.sessionName, workout.sessionType, workout.sessionDisplayName);
    const meta = workout.estimatedMinutes > 0
      ? tHome('upcoming.meta', { minutes: workout.estimatedMinutes, count: workout.exerciseCount })
      : tHome('upcoming.metaNoEstimate', { count: workout.exerciseCount });
    return {
      key: `${workout.localDate}:${workout.sessionIndex}`,
      dayLabel,
      title: sessionLabel,
      meta,
      accessibilityLabel: tHome('upcoming.open', { weekday: a11yWeekday, session: sessionLabel }),
      onPress: () => setDetailWorkout(workout),
    };
  });

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 112 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Same header geometry as Home's (`src/screens/HomeScreen.tsx`) —
              22px gutter, 50px total top offset, 12px bottom gap before the
              ticker — so every tab's header/ticker block lines up at an
              identical height. */}
          <View style={{ paddingHorizontal: 22, paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <MonoLabel color={theme.colors.textFaint}>{headerDateLabel}</MonoLabel>
              <Display size={34} style={{ marginTop: 8 }}>{t('header.title')}</Display>
            </View>
            <ProfileAvatar
              displayName={headerDisplayName}
              photoURL={profile?.profile.photoURL}
              photoVersion={profile?.profile.photoVersion}
              size={46}
            />
          </View>

          <View style={{ marginTop: 22, marginBottom: 18 }}>
            <EvolutionTicker viewModel={evolutionViewModel} />
          </View>

          {weekOverview && (
            <View style={{ marginTop: 24 }}>
              <TreinoWeekStrip
                days={weekStripDays}
                dimmed={isFlexible || workoutInProgress}
                disabled={workoutInProgress}
                weekSummaryLabel={weekSummaryLabel}
                onPress={onOpenAgendaEditor}
              />
            </View>
          )}

          <TreinoTodayBlock
            kicker={todayBlockKicker}
            sessionLabel={todayBlockSessionLabel}
            title={todayBlockTitle}
            muscles={muscleListItems}
            sex={sex}
            primaryMuscles={sessionMuscles.primary}
            secondaryMuscles={sessionMuscles.secondary}
            showBodyMap={showBodyMap}
            bodyMapSize={bodyMuscleMapSize}
            frontOffsetX={frontOffsetX}
            metrics={metrics}
            ctaVisible={canStartNow}
            ctaLabel={ctaLabel}
            ctaDisabled={startPending}
            onPressCta={onStart}
          />

          <TreinoExerciseList
            title={t('exercises.title')}
            exercises={exerciseListItems}
            showAllLabel={(count) => t('exercises.showAll', { count })}
            showLessLabel={t('exercises.showLess')}
          />

          <TreinoUpcomingList
            title={isFlexible ? t('upcoming.titleFlexible') : tHome('upcoming.title')}
            items={upcomingItems}
          />
        </ScrollView>
      </SafeAreaView>

      {detailWorkout && (
        <TreinoWorkoutDetailSheet
          workout={detailWorkout}
          plan={plan}
          nextSessionIndex={nextIndex}
          completedTodaySessionIndex={completedTodaySessionIndex}
          workoutInProgress={workoutInProgress}
          onClose={() => setDetailWorkout(null)}
          onStart={onStart}
          onReposition={onReposition}
        />
      )}
    </ScreenBg>
  );
}
```

Note: `View` is used but not imported above — add `View` to the `react-native` import at the top (`import { ScrollView, View, useWindowDimensions } from 'react-native';`).

- [ ] **Step 2: Verify no leftover references to removed imports**

Run: `grep -n "LinearGradient\|HudCorners\|WeeklyOverview\|TODAY_WORKOUT_THEME\|darkTheme\|Pressable\|Slash\|Icon\b" src/screens/TreinoScreen.tsx`
Expected: no matches (all of these were either removed or moved into the new presentational components).

- [ ] **Step 3: Commit**

```bash
git add src/screens/TreinoScreen.tsx
git commit -m "refactor(treino): migrate TreinoScreen to the clean Opção B visual layout"
```

---

## Task 9: Validation (Etapa D)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors. If there are pre-existing unrelated errors from the other uncommitted files in this working tree (`ExerciseGif.tsx`, `FrequencyHeatmap.tsx`, `onboardingVideoPreload.ts`, `silentDemoVideo.ts`, etc. — not part of this task), confirm with `git stash push --keep-index -- <those files>` is NOT appropriate here since they're already modified pre-existing work; instead just confirm none of the errors reference `TreinoScreen.tsx`, `TreinoWeekStrip.tsx`, `TreinoTodayBlock.tsx`, `TreinoExerciseList.tsx`, `TreinoUpcomingList.tsx`, `treinoWeekStrip.ts`, or `BodyMuscleMap.tsx`.

- [ ] **Step 2: Lint**

Run: `npx eslint src/screens/TreinoScreen.tsx src/components/treino src/home/treinoWeekStrip.ts src/components/fitness/BodyMuscleMap.tsx`
Expected: no errors (warnings only if the existing config already allows them elsewhere).

- [ ] **Step 3: Run the targeted test files**

Run: `npx vitest run src/home/__tests__/treinoWeekStrip.test.ts src/components/fitness/__tests__/bodyMuscleMapArchitecture.test.ts src/i18n/__tests__/resourceParity.test.ts`
Expected: all PASS. The architecture test's `expect(tags).toHaveLength(5)` confirms no new `<BodyMuscleMap>` call site was introduced.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (or only pre-existing failures unrelated to this change — confirm by checking `git stash` and re-running if any failure looks suspicious).

- [ ] **Step 5: Confirm the screen renders in each required state**

This repo has no RN component-render test harness, so this step is manual (Expo Go / simulator), per the plan's spec §7:
  - `SESSION_READY` (today has a session, CTA "Iniciar treino")
  - `MISSED_SESSION_DECISION_REQUIRED` (CTA still visible; the decision sheet only appears after tapping it, unchanged)
  - `REST_DAY` / `ACTIVE_RECOVERY_DAY` (kicker "PRÓXIMO · {dia}", no CTA)
  - `TODAY_COMPLETED` (kicker "Treino de hoje", shows the completed session, no CTA)
  - `SCHEDULE_SETUP_REQUIRED` (no session, no muscles/body map/metrics/CTA)
  - `workoutInProgress = true` (CTA "Retomar treino", week strip dimmed + disabled)
  - `isFlexible = true` (week strip dimmed but still pressable, "PRÓXIMOS NA SEQUÊNCIA" title, upcoming rows show session letters)
  - `startPending = true` (CTA disabled, opacity 0.6)
  - window width < 360 (body map 84px, front offset 14px)
  - both `sex` values (front/back silhouettes correct)
  - light theme and dark theme (today block legible in both)
  - 5 exercises or more (expand/collapse works, animates on expand only)

---

## Task 10: Final report (spec §9 — deliverable, not code)

Write a summary covering, in order:

1. **Files changed/created** — one line each: `BodyMuscleMap.tsx` (added `frontOffsetX`), `src/home/treinoWeekStrip.ts` (new), `src/home/__tests__/treinoWeekStrip.test.ts` (new), `TreinoWeekStrip.tsx` / `TreinoTodayBlock.tsx` / `TreinoExerciseList.tsx` / `TreinoUpcomingList.tsx` (new), 3 `treino.json` locale files, `TreinoScreen.tsx` (rewritten).
2. **"elemento do design → fonte real" table**, copying the mapping table from the spec's §4 and flagging the divergences this plan already identified (muscle focus line, progress bar, week-summary count, upcoming row's "· Foco").
3. **Funcionalidades que mudaram de lugar**: week-summary count → `TreinoWeekStrip`'s `accessibilityLabel` only; "Editar agenda" → the whole week strip is now the touch target.
4. **Itens omitidos por falta de dado real**: session focus/description, in-progress sets-done progress bar, week-summary visual count, upcoming row's focus suffix.
5. **Literais de cor sem token** — **revisado durante a execução (commit `14b0b93`)**. A versão original deste plano permitia literais `rgba(255,255,255,0.xx)` para os textos apagados e para o contorno do body map, sob a justificativa de que "não existe token exato". Essa justificativa estava incompleta: como esta tela é **theme-aware** por decisão aprovada (§ item 6 abaixo) e o §5 do spec exige que "o tema claro deve continuar legível", branco semitransparente ficava ilegível sobre o fundo claro (`#E7E7E7`). Todos foram trocados pelo token semântico mais próximo, que é quase exato no escuro e correto no claro:

   | Literal original | Token adotado | Escuro | Claro | Delta no escuro |
   |---|---|---|---|---|
   | `rgba(255,255,255,0.35)` / `0.4` | `theme.colors.textFaint` | `rgba(255,255,255,0.32)` | `#5D6676` | 0.03 / 0.08 |
   | `rgba(255,255,255,0.45)` | `theme.colors.textInactive` | `rgba(255,255,255,0.50)` | `#6B7280` | 0.05 |
   | `rgba(255,255,255,0.55)` | `theme.colors.textMuted` | `rgba(255,255,255,0.55)` | `#5B6475` | exato |
   | `rgba(255,255,255,0.85)` (contorno do body map) | `theme.colors.textEmphasis` | `rgba(255,255,255,0.82)` | `#273142` | 0.03 |

   **Literais remanescentes, intencionais:** a escala decorativa de intensidade das bolinhas de músculo (`#4da3ff` → `#1f6fd6`) — é acento de marca, legível sobre os dois fundos, e não é texto apagado; e `transparent` para o `baseColor` do body map, correto nos dois temas.
6. **Theme behavior change (flagged for explicit user approval, already obtained)**: Treino's Today block no longer forces `TODAY_WORKOUT_THEME = darkTheme` — it now follows the live theme. Home's own forced-dark poster is untouched.
7. **Resultados de `tsc`, `lint` e testes** — paste the actual command output from Task 9.
8. **Capturas** — attach manual screenshots from Task 9 Step 5's four required states (livre, em andamento, concluído hoje, lista expandida).

# Exercise Evolution Detail Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping an exercise (from "Recordes recentes" or from the "Evolução por exercício" search/list, in the Cargas tab of the Evolution screen) opens a dedicated full screen with that exercise's current load, delta, chart and period selector — instead of swapping an inline block further down the same scrolling page.

**Architecture:** Extract the existing inline "selected exercise" block out of `LoadsEvolutionView` into a new standalone component, `ExerciseEvolutionDetail`. `ProgressScreen` (which already owns the load-progress data via `useLoadProgressState()`) gets a new piece of state for which exercise is open, and swaps its entire body for the new component when one is selected — the same technique it already uses to swap in `ProgressPhotosScreen` for the Photos tab. No router is introduced.

**Tech Stack:** React Native, TypeScript, react-i18next, Vitest (structural/source-string tests — this codebase's established convention for these presentational components, not RTL rendering).

**Spec:** `docs/superpowers/specs/2026-10-16-exercise-evolution-detail-screen-design.md`

---

## Before you start

Read these two files in full — every step below references exact line numbers from them and assumes you've seen the surrounding code:
- `src/components/fitness/LoadsEvolutionView.tsx` (814 lines)
- `src/screens/ProgressScreen.tsx` (416 lines)

Run `git status --short` first. This repo currently has unrelated work-in-progress files already staged (from an ongoing Treino/Evolução redesign) — do not touch, unstage, or commit anything beyond what each task below explicitly names. When committing, always commit by exact pathspec (`git commit -m "..." -- <files>`), never `git commit -a` or a bare `git commit` after `git add -A`.

---

### Task 1: New component `ExerciseEvolutionDetail`

**Files:**
- Create: `src/components/fitness/ExerciseEvolutionDetail.tsx`
- Test: `src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts`

This component is self-contained — it doesn't need `LoadsEvolutionView` or `ProgressScreen` to exist yet to be tested, since the test only reads its own source file.

- [ ] **Step 1: Write the failing test**

Create `src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/fitness/ExerciseEvolutionDetail.tsx', 'utf8');

describe('ExerciseEvolutionDetail', () => {
  it('accepts exercise/todayLocalDate/onBack and renders no extra header chrome', () => {
    expect(source).toContain('exercise: ExerciseLoadProgress');
    expect(source).toContain('todayLocalDate: string');
    expect(source).toContain('onBack: () => void');
  });

  it('renders a back button using the shared common:actions.back label, not a title bar', () => {
    expect(source).toContain("useTranslation(['home', 'common'])");
    expect(source).toContain("t('common:actions.back')");
    expect(source).toContain('<Icon name="arrow-left"');
    expect(source).toContain('onPress={onBack}');
  });

  it('reuses the exact chart/period-selector pattern the Cargas panel uses', () => {
    expect(source).toContain('<EvolutionAreaChart');
    expect(source).toContain('LOAD_PROGRESS_PERIODS.map');
    expect(source).toContain("useState<LoadProgressPeriod>(90)");
    expect(source).toContain('loadHistoryForPeriod(exercise.history, period, todayLocalDate)');
  });

  it('consumes ThemeProvider visual state like every other fitness component', () => {
    expect(source).toContain('useTheme');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'src/components/fitness/ExerciseEvolutionDetail.tsx'`

- [ ] **Step 3: Write the component**

Create `src/components/fitness/ExerciseEvolutionDetail.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  LOAD_PROGRESS_PERIODS,
  loadHistoryForPeriod,
  type ExerciseLoadProgress,
  type LoadProgressPeriod,
} from '../../loadProgress/loadProgress';
import { exerciseDisplayName } from '../../services/exerciseSubstitutionCandidates';
import { useUnits } from '../../state/UnitsContext';
import { radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import {
  formatWorkoutLoadFromKg,
  workoutLoadFromKg,
  workoutLoadUnit,
} from '../../units/workoutLoadConversions';
import { Display, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { EvolutionAreaChart } from './EvolutionAreaChart';

/**
 * Full-screen detail for a single exercise's load history — opened from
 * "Recordes recentes" or the exercise search/list in `LoadsEvolutionView`.
 * Presentation only: same content that block used to render inline, just
 * given its own screen so the chart has room to breathe. `ProgressScreen`
 * owns when this is mounted (swapping its whole body for this component,
 * the same technique it already uses for the Photos tab) and which
 * `ExerciseLoadProgress` to hand it.
 */

const GUTTER = sizes.screenGutter;

function localDateAsDate(localDate: string): Date {
  return new Date(`${localDate}T12:00:00`);
}

/** Small date caption under a chart's left/right edge. Mirrors `LoadsEvolutionView`'s own. */
function AxisDate({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint }}>
      {children}
    </Text>
  );
}

interface Props {
  exercise: ExerciseLoadProgress;
  todayLocalDate: string;
  onBack: () => void;
}

export function ExerciseEvolutionDetail({ exercise, todayLocalDate, onBack }: Props) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['home', 'common']);
  const { resolvedUnits } = useUnits();
  const [period, setPeriod] = useState<LoadProgressPeriod>(90);

  const catalogLocale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';
  const exerciseName = exerciseDisplayName(exercise.exerciseId, catalogLocale);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    [i18n.language, i18n.resolvedLanguage],
  );

  const periodHistory = loadHistoryForPeriod(exercise.history, period, todayLocalDate);
  const first = periodHistory[0] ?? null;
  const latest = periodHistory[periodHistory.length - 1] ?? null;
  const deltaKg = first && latest ? latest.loadKg - first.loadKg : null;
  const unit = workoutLoadUnit(resolvedUnits);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing[8] }}>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[3] }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.back')}
          style={{
            width: 44,
            height: 44,
            borderRadius: radii.control,
            backgroundColor: theme.colors.surfaceRaised,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrow-left" size={17} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: GUTTER, marginTop: spacing[6] }}>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 18, color: theme.colors.textPrimary }}>
          {exerciseName}
        </Text>

        {latest ? (
          <>
            <View style={{ marginTop: spacing[4] }}>
              <MonoLabel size={10} style={{ letterSpacing: 1.6 }}>
                {t('progress.loads.currentLoad').toUpperCase()}
              </MonoLabel>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: spacing[1.5] }}>
                <Display size={52}>{formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits)}</Display>
                <Text
                  style={{
                    marginLeft: spacing[1.5],
                    fontFamily: theme.fonts.ui,
                    fontSize: 15,
                    color: theme.colors.textMuted,
                  }}
                >
                  {unit}
                </Text>
              </View>
              <Text
                style={{
                  marginTop: spacing[2],
                  fontFamily: theme.fonts.ui,
                  fontSize: 13,
                  color: theme.colors.textMuted,
                }}
              >
                {deltaKg != null && periodHistory.length > 1 ? (
                  <>
                    <Text
                      style={{
                        fontFamily: theme.fonts.uiSemi,
                        color: deltaKg >= 0 ? theme.colors.primaryEmphasis : theme.colors.dangerText,
                      }}
                    >
                      {`${deltaKg >= 0 ? '+' : '−'}${formatWorkoutLoadFromKg(Math.abs(deltaKg), resolvedUnits)} ${unit}`}
                    </Text>
                    {` ${t('progress.loads.periodDifference', { days: period })}`}
                  </>
                ) : (
                  t('progress.loads.noComparison')
                )}
              </Text>
            </View>

            {periodHistory.length > 1 ? (
              <View style={{ marginTop: spacing[5] }}>
                <EvolutionAreaChart
                  variant="line"
                  height={150}
                  points={periodHistory.map((point) => ({
                    value: workoutLoadFromKg(point.loadKg, resolvedUnits),
                    displayValue: `${formatWorkoutLoadFromKg(point.loadKg, resolvedUnits)} ${unit.toUpperCase()}`,
                    label: dateFormatter.format(localDateAsDate(point.localDate)),
                  }))}
                  formatAxisValue={(value) => String(Math.round(value))}
                  accessibilityLabel={t('progress.loads.accessibility.chart', {
                    exercise: exerciseName,
                    value: formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits),
                    unit,
                  })}
                  accessibilityHint={t('progress.chartInteractionHint')}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                  <AxisDate>{dateFormatter.format(localDateAsDate(first!.localDate))}</AxisDate>
                  <AxisDate>{dateFormatter.format(localDateAsDate(latest.localDate))}</AxisDate>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: spacing[7], gap: spacing[2] }}>
            <Icon name="chart" size={23} color={theme.colors.textFaint} />
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' }}>
              {t('progress.loads.noDataForPeriod')}
            </Text>
          </View>
        )}

        {/* Segmented period selector, under the chart it drives. */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: spacing[4],
            padding: 3,
            borderRadius: radii.control,
            backgroundColor: theme.colors.surfaceElevated,
          }}
        >
          {LOAD_PROGRESS_PERIODS.map((value) => {
            const active = period === value;
            return (
              <Pressable
                key={value}
                onPress={() => setPeriod(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 38,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radii.sm,
                  backgroundColor: active ? theme.colors.borderStrong : 'transparent',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <MonoLabel size={9} color={active ? theme.colors.textPrimary : theme.colors.textFaint}>
                  {t(`progress.loads.ranges.${value}`)}
                </MonoLabel>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}
```

This is the exact JSX/logic that currently lives at `LoadsEvolutionView.tsx:674-795` (the `{selected ? (...) : null}` block), with `selected` renamed to the required `exercise` prop (never `null` here — the caller only mounts this component once it has a match), plus the new back button using the identical pattern `AssessmentScreen.tsx:240-256` uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/fitness/ExerciseEvolutionDetail.tsx src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts
git commit -m "Adiciona ExerciseEvolutionDetail, tela cheia de evolução por exercício" -- src/components/fitness/ExerciseEvolutionDetail.tsx src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts
```

---

### Task 2: Strip the inline block out of `LoadsEvolutionView` and wire `onSelectExercise`

**Files:**
- Modify: `src/components/fitness/LoadsEvolutionView.tsx`
- Modify: `src/components/fitness/__tests__/evolutionChartInteraction.test.ts`
- Modify: `src/loadProgress/__tests__/loadProgressWiring.test.ts`

- [ ] **Step 1: Update the existing tests to describe the new end state (red first)**

In `src/components/fitness/__tests__/evolutionChartInteraction.test.ts`, replace the `'wires every Evolution-page chart with real values, dates and units'` test body:

```ts
  it('wires every Evolution-page chart with real values, dates and units', () => {
    expect(bodyView.match(/<EvolutionAreaChart/g)).toHaveLength(2);
    expect(bodyView.match(/accessibilityHint=\{t\('progress\.chartInteractionHint'\)\}/g))
      .toHaveLength(2);
    expect(bodyView).toContain('displayValue: `${formatWeightFromKg(entry.weightKg, resolvedUnits)}');
    expect(bodyView).toContain('displayValue: `${formatMeasurement(point.value)}');

    // The per-exercise chart moved to its own screen — Cargas itself no
    // longer renders a chart directly.
    expect(loadsView.match(/<EvolutionAreaChart/g)).toBeNull();

    const exerciseDetail = readFileSync('src/components/fitness/ExerciseEvolutionDetail.tsx', 'utf8');
    expect(exerciseDetail.match(/<EvolutionAreaChart/g)).toHaveLength(1);
    expect(exerciseDetail).toContain('displayValue: `${formatWorkoutLoadFromKg(point.loadKg');
    expect(exerciseDetail).toContain('label: dateFormatter.format(localDateAsDate(point.localDate))');
  });
```

Add the new `readFileSync` call for `exerciseDetail` either inline (as above) or alongside the existing top-level `const areaChart = ...` / `const bodyView = ...` / `const loadsView = ...` declarations — either placement is fine since it's a plain `const`.

In `src/loadProgress/__tests__/loadProgressWiring.test.ts`, replace the `'offers the requested search, record list and four time ranges'` test body:

```ts
  it('offers the requested search, record list and four time ranges', () => {
    expect(loadsView).toContain('recordsLast90Days.slice(0, 3)');
    expect(loadsView).toContain('progress.loads.seeAllRecords');
    expect(loadsView).toContain('<TextInput');

    const exerciseDetail = readFileSync('src/components/fitness/ExerciseEvolutionDetail.tsx', 'utf8');
    expect(exerciseDetail).toContain('LOAD_PROGRESS_PERIODS.map');
  });
```

Add a `const exerciseDetail = readFileSync(...)` near the existing top-level `const loadsView = ...` in that file, or inline as above.

- [ ] **Step 2: Run both tests to verify they fail**

Run: `npx vitest run src/components/fitness/__tests__/evolutionChartInteraction.test.ts src/loadProgress/__tests__/loadProgressWiring.test.ts`
Expected: the two edited tests FAIL (`loadsView` still has exactly 1 `<EvolutionAreaChart>` and still contains `LOAD_PROGRESS_PERIODS.map` at this point, since `LoadsEvolutionView.tsx` hasn't been touched yet). Other tests in `loadProgressWiring.test.ts` may already be failing for unrelated, pre-existing reasons (ongoing WIP elsewhere in this repo, not part of this task) — ignore those, only the two tests just edited matter here.

- [ ] **Step 3: Edit `LoadsEvolutionView.tsx` — imports**

At the top of the file (`LoadsEvolutionView.tsx:1-31`):

Change the `'../../loadProgress/loadProgress'` import (lines 5-12) from:
```ts
import {
  LOAD_PROGRESS_PERIODS,
  loadHistoryForPeriod,
  normalizeExerciseSearch,
  type ExerciseLoadProgress,
  type LoadPersonalRecord,
  type LoadProgressPeriod,
} from '../../loadProgress/loadProgress';
```
to:
```ts
import {
  normalizeExerciseSearch,
  type ExerciseLoadProgress,
  type LoadPersonalRecord,
  type LoadProgressPeriod,
} from '../../loadProgress/loadProgress';
```
(`LoadProgressPeriod` stays — it still types `MUSCLE_GROUP_PERIOD` below.)

Change the `'../../units/workoutLoadConversions'` import (lines 21-25) from:
```ts
import {
  formatWorkoutLoadFromKg,
  workoutLoadFromKg,
  workoutLoadUnit,
} from '../../units/workoutLoadConversions';
```
to:
```ts
import {
  formatWorkoutLoadFromKg,
  workoutLoadUnit,
} from '../../units/workoutLoadConversions';
```

Delete line 29 entirely: `import { EvolutionAreaChart } from './EvolutionAreaChart';`

- [ ] **Step 4: Edit `LoadsEvolutionView.tsx` — props**

Add `onSelectExercise` to the props type (right after `onStartWorkout?: () => void;` around line 152):

```ts
  /** Starts a workout. Absent when the host cannot drive that flow. */
  onStartWorkout?: () => void;
  /** Opens the full-screen detail for one exercise. */
  onSelectExercise: (exerciseId: string) => void;
```

And to the destructured parameter list (right after `onStartWorkout,` around line 142):

```ts
  onStartWorkout,
  onSelectExercise,
  sex,
```

- [ ] **Step 5: Edit `LoadsEvolutionView.tsx` — remove `selectedId` state and its auto-select effect**

Delete this line (was line 166):
```ts
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

Delete this effect (was lines 231-234):
```ts
  useEffect(() => {
    if (selectedId && displayExercises.some((exercise) => exercise.exerciseId === selectedId)) return;
    setSelectedId(orderedExercises[0]?.exerciseId ?? null);
  }, [displayExercises, orderedExercises, selectedId]);
```

Delete these derived values (was lines 254, 259-265 partially — keep `unit`, delete the rest):
```ts
  const selected = displayExercises.find((exercise) => exercise.exerciseId === selectedId) ?? null;
```
and
```ts
  const periodHistory = selected
    ? loadHistoryForPeriod(selected.history, period, todayLocalDate)
    : [];
  const first = periodHistory[0] ?? null;
  const latest = periodHistory[periodHistory.length - 1] ?? null;
  const deltaKg = first && latest ? latest.loadKg - first.loadKg : null;
```

Keep `const unit = workoutLoadUnit(resolvedUnits);` — still used by the muscle section and the records list.

Delete the `period` state (was line 168):
```ts
  const [period, setPeriod] = useState<LoadProgressPeriod>(90);
```

(`useState` import stays — still used for `selectedMuscle`, `query`, `searchFocused`, `showAllRecords`, `sort`. `useEffect` import stays too — still used for the muscle-group auto-select effect.)

- [ ] **Step 6: Edit `LoadsEvolutionView.tsx` — records row `onPress`**

Around line 459, change:
```ts
            onPress={() => setSelectedId(record.exerciseId)}
```
to:
```ts
            onPress={() => onSelectExercise(record.exerciseId)}
```

- [ ] **Step 7: Edit `LoadsEvolutionView.tsx` — exercise list row**

Around lines 611-668, remove the `isSelected` concept (nothing is "currently previewed" anymore — tapping navigates away immediately). Change:

```tsx
          ) : searchResults.map((exercise, index) => {
            const isSelected = selectedId === exercise.exerciseId;
            const latestPoint = exercise.history[exercise.history.length - 1]!;
            const muscle = getExerciseTarget(exercise.exerciseId)?.primaryMuscle;
            // Each chip reports the figure it ordered by — never a number
            // the list isn't actually sorted on.
            const meta = sort === 'mostTrained'
              ? t('progress.loads.sessionsCount', { count: exercise.history.length })
              : sort === 'heaviest'
                ? `${formatWorkoutLoadFromKg(exerciseMaxLoadKg(exercise), resolvedUnits)} ${unit}`
                : dateFormatter.format(localDateAsDate(latestPoint.localDate));
            return (
              <Pressable
                key={exercise.exerciseId}
                onPress={() => { setSelectedId(exercise.exerciseId); setQuery(''); }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t('progress.loads.accessibility.selectExercise', { exercise: exerciseName(exercise.exerciseId) })}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  paddingVertical: spacing[3],
                  borderTopWidth: index ? sizes.hairline : 0,
                  borderTopColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: theme.fonts.uiSemi,
                      fontSize: 14.5,
                      color: isSelected ? theme.colors.primaryEmphasis : theme.colors.textPrimary,
                    }}
                  >
                    {exerciseName(exercise.exerciseId)}
                  </Text>
```

to:

```tsx
          ) : searchResults.map((exercise, index) => {
            const latestPoint = exercise.history[exercise.history.length - 1]!;
            const muscle = getExerciseTarget(exercise.exerciseId)?.primaryMuscle;
            // Each chip reports the figure it ordered by — never a number
            // the list isn't actually sorted on.
            const meta = sort === 'mostTrained'
              ? t('progress.loads.sessionsCount', { count: exercise.history.length })
              : sort === 'heaviest'
                ? `${formatWorkoutLoadFromKg(exerciseMaxLoadKg(exercise), resolvedUnits)} ${unit}`
                : dateFormatter.format(localDateAsDate(latestPoint.localDate));
            return (
              <Pressable
                key={exercise.exerciseId}
                onPress={() => { onSelectExercise(exercise.exerciseId); setQuery(''); }}
                accessibilityRole="button"
                accessibilityLabel={t('progress.loads.accessibility.selectExercise', { exercise: exerciseName(exercise.exerciseId) })}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  paddingVertical: spacing[3],
                  borderTopWidth: index ? sizes.hairline : 0,
                  borderTopColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: theme.fonts.uiSemi,
                      fontSize: 14.5,
                      color: theme.colors.textPrimary,
                    }}
                  >
                    {exerciseName(exercise.exerciseId)}
                  </Text>
```

(The rest of that row — the muscle caption, the meta text, the trailing chevron icon — is unchanged.)

- [ ] **Step 8: Edit `LoadsEvolutionView.tsx` — delete the moved block and the now-dead `AxisDate`**

Delete the entire `{selected ? (...) : null}` block (was lines 674-795 — everything between the exercise list's closing `</View>` at line 672/673 and the `</View></View>);` that closes `panel` at lines 796-798). After deletion, the end of `panel`'s JSX should read:

```tsx
        </View>

      </View>
    </View>
  );
```

(i.e. the exercise-list `<View>` closes, then `panel`'s own two wrapping `<View>`s close, matching what was already there below the deleted block.)

Delete the now-unused `AxisDate` helper (was lines 126-133):
```tsx
/** Small date caption under a chart's left/right edge. */
function AxisDate({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint }}>
      {children}
    </Text>
  );
}
```

- [ ] **Step 9: Run the two edited test files again**

Run: `npx vitest run src/components/fitness/__tests__/evolutionChartInteraction.test.ts src/loadProgress/__tests__/loadProgressWiring.test.ts`
Expected: the two tests edited in Step 1 now PASS.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (confirms no leftover reference to `selectedId`, `period`, `selected`, `periodHistory`, `first`, `latest`, `deltaKg`, `EvolutionAreaChart`, `workoutLoadFromKg`, `LOAD_PROGRESS_PERIODS`, `loadHistoryForPeriod`, or `AxisDate` remains in this file, and that `onSelectExercise` is a required prop not yet satisfied by its one remaining caller — that caller is fixed in Task 3, so a "missing prop" error on `ProgressScreen.tsx`'s existing `<LoadsEvolutionView ...>` call is expected and fine at this point; every other error must be fixed before moving on)

- [ ] **Step 11: Commit**

```bash
git add src/components/fitness/LoadsEvolutionView.tsx src/components/fitness/__tests__/evolutionChartInteraction.test.ts src/loadProgress/__tests__/loadProgressWiring.test.ts
git commit -m "Move o bloco de exercício selecionado da Cargas para a tela dedicada" -- src/components/fitness/LoadsEvolutionView.tsx src/components/fitness/__tests__/evolutionChartInteraction.test.ts src/loadProgress/__tests__/loadProgressWiring.test.ts
```

---

### Task 3: Wire `ProgressScreen` to open/close the detail screen

**Files:**
- Modify: `src/screens/ProgressScreen.tsx`
- Test: `src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen exercise detail navigation', () => {
  it('owns which exercise is open and looks it up from the real load-progress list', () => {
    expect(screen).toContain('const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)');
    expect(screen).toContain(
      'loadExercises.find((exercise) => exercise.exerciseId === selectedExerciseId)',
    );
  });

  it('swaps the whole screen body for the detail screen, same technique as the Photos tab', () => {
    expect(screen).toContain("import { ExerciseEvolutionDetail } from '../components/fitness/ExerciseEvolutionDetail'");
    expect(screen).toContain('selectedExercise ? (');
    expect(screen).toContain('<ExerciseEvolutionDetail');
    expect(screen).toContain('onBack={() => setSelectedExerciseId(null)}');
  });

  it('passes the open handler to LoadsEvolutionView and resets it on tab switch', () => {
    expect(screen).toContain('onSelectExercise={setSelectedExerciseId}');
    expect(screen).toContain('setSelectedExerciseId(null)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts`
Expected: FAIL — none of the strings exist yet in `ProgressScreen.tsx`

- [ ] **Step 3: Add the import and state**

In `ProgressScreen.tsx`, add the import next to the other fitness component imports (after line 18, `import { LoadsEvolutionView } from '../components/fitness/LoadsEvolutionView';`):

```ts
import { ExerciseEvolutionDetail } from '../components/fitness/ExerciseEvolutionDetail';
```

Add new state right after `const [view, setView] = useState<ProgressView>('body');` (line 66):

```ts
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
```

- [ ] **Step 4: Add the lookup**

After the `useLoadProgressState()` destructure (after line 89, before the `tabs` declaration), add:

```ts
  const selectedExercise = selectedExerciseId
    ? loadExercises.find((exercise) => exercise.exerciseId === selectedExerciseId) ?? null
    : null;
```

- [ ] **Step 5: Reset the detail screen when the tab changes**

In `panelHeader` (around line 203), change:

```tsx
      <PillTabs
        tabs={tabs}
        view={view}
        onSelect={setView}
```

to:

```tsx
      <PillTabs
        tabs={tabs}
        view={view}
        onSelect={(next) => { setView(next); setSelectedExerciseId(null); }}
```

- [ ] **Step 6: Pass `onSelectExercise` to `LoadsEvolutionView`**

Around line 258, inside the existing `<LoadsEvolutionView ... />` call, add the new prop (right after `onStartWorkout={onStartWorkout}`):

```tsx
                  onStartWorkout={onStartWorkout}
                  onSelectExercise={setSelectedExerciseId}
```

- [ ] **Step 7: Swap the whole body when an exercise is selected**

Leave every other line inside the return statement exactly as it is — this step only touches the single line where the existing three-way layout ternary begins. The rest of that ternary (the `ScrollView` branch with `panelHeader`, `PanelFade`, `BodyEvolutionView`/`LoadsEvolutionView`, and its own closing `)}`) is untouched and does not need to be retyped.

Find this line (currently line 218):
```tsx
        {view === 'photos' ? (
```

Replace it with:
```tsx
        {selectedExercise ? (
          <ExerciseEvolutionDetail
            exercise={selectedExercise}
            todayLocalDate={todayLocalDate}
            onBack={() => setSelectedExerciseId(null)}
          />
        ) : view === 'photos' ? (
```

That's the entire edit for this step: one line becomes six. Everything from `<ProgressPhotosScreen pageHeader={pageHeader} />` down to the matching `)}` (currently lines 219-264) needs no changes at all — the existing `) : (` / `)}` pair that used to close a two-way ternary now closes the `view === 'photos'` tier of a three-way one, which is valid as-is.

- [ ] **Step 8: Run the new test**

Run: `npx vitest run src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Run the other two `ProgressScreen`-reading test files to confirm no regression**

Run: `npx vitest run src/screens/__tests__/progressScreenOnStartWorkout.test.ts src/i18n/__tests__/progressConsistency.test.ts`
Expected: PASS (none of their asserted substrings were touched — `view === 'photos' ? (`, `scrollEnabled={!isCurrentViewLocked}`, `fillHeight={isCurrentViewLocked}`, `onStartWorkout={onStartWorkout}`, etc. all still appear verbatim)

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add src/screens/ProgressScreen.tsx src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts
git commit -m "Abre a evolução de um exercício em tela cheia a partir da aba Cargas" -- src/screens/ProgressScreen.tsx src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts
```

---

### Task 4: Register the new component in the shared theme-coverage test

**Files:**
- Modify: `src/theme/__tests__/sharedComponentsTheme.test.ts`

- [ ] **Step 1: Add the new file to `PHASE_3_THEME_AWARE_AREAS`**

In `src/theme/__tests__/sharedComponentsTheme.test.ts`, add a line right after `'src/components/fitness/LoadsEvolutionView.tsx',` (around line 35):

```ts
  'src/components/fitness/LoadsEvolutionView.tsx',
  'src/components/fitness/ExerciseEvolutionDetail.tsx',
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/theme/__tests__/sharedComponentsTheme.test.ts`
Expected: PASS — `ExerciseEvolutionDetail.tsx` already calls `useTheme()` and imports no static `colors`/`fonts` from `theme/tokens` (Task 1 built it that way), so this passes without touching the component again.

- [ ] **Step 3: Commit**

```bash
git add src/theme/__tests__/sharedComponentsTheme.test.ts
git commit -m "Inclui ExerciseEvolutionDetail na cobertura de tema compartilhada" -- src/theme/__tests__/sharedComponentsTheme.test.ts
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run every test file touched or read by this plan**

Run:
```bash
npx vitest run \
  src/components/fitness/__tests__/exerciseEvolutionDetailStructure.test.ts \
  src/components/fitness/__tests__/evolutionChartInteraction.test.ts \
  src/loadProgress/__tests__/loadProgressWiring.test.ts \
  src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts \
  src/screens/__tests__/progressScreenOnStartWorkout.test.ts \
  src/i18n/__tests__/progressConsistency.test.ts \
  src/theme/__tests__/sharedComponentsTheme.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Manual walkthrough (if a device/simulator is available)**

Start the app, go to Evolução → Cargas. Confirm:
- Tapping a card in "Recordes recentes" opens the full-screen detail for that exercise (back arrow top-left, no title bar, hero load + delta + chart + 30/60/90/365 selector).
- Tapping an exercise in the search/list below does the same.
- The back arrow returns to the Cargas tab's list (not to Corpo, not to Photos).
- Switching to Corpo or Fotos and back to Cargas never leaves you stuck on a stale detail screen.

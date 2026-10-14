# Evolução Blurred Preview Empty States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain "no data" blocks on the Evolução screen's Corpo and Cargas tabs with a blurred, dimmed preview of the real component tree fed by local demo data, topped by a centered lock message with a CTA to the real unlocking flow.

**Architecture:** A new shared `EvolutionLockedPreview` wrapper (built on `expo-blur`, the same technique already used by `PhotoVaultLockedState`) sits around the existing filled-state JSX in `BodyEvolutionView`/`LoadsEvolutionView`, fed by two new pure demo-data generator modules instead of the real (empty) arrays. No change to any domain logic, hook, or persisted data.

**Tech Stack:** React Native, Expo, `expo-blur`, TypeScript, Vitest (Node-only test suite — this codebase's tests for these files are source-text "architecture" assertions and pure-function unit tests, never RTL rendering).

**Spec:** `docs/superpowers/specs/2026-10-09-evolucao-blurred-preview-empty-states-design.md`

---

### Task 1: Demo assessment data module

**Files:**
- Create: `src/components/fitness/demoAssessmentData.ts`
- Test: `src/components/fitness/__tests__/demoAssessmentData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildDemoAssessments } from '../demoAssessmentData';

describe('buildDemoAssessments', () => {
  it('returns at least two chronologically-ordered points, newest first', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const assessments = buildDemoAssessments(now);

    expect(assessments.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i + 1 < assessments.length; i += 1) {
      const newer = assessments[i]!.measuredAt.toDate().getTime();
      const older = assessments[i + 1]!.measuredAt.toDate().getTime();
      expect(newer).toBeGreaterThan(older);
    }
  });

  it('never dates a demo entry in the future relative to the given "now"', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const assessments = buildDemoAssessments(now);
    assessments.forEach((assessment) => {
      expect(assessment.measuredAt.toDate().getTime()).toBeLessThanOrEqual(now.getTime());
    });
  });

  it('provides guided folds so the measurements sub-chart has data to show', () => {
    const assessments = buildDemoAssessments(new Date('2026-10-09T12:00:00Z'));
    assessments.forEach((assessment) => {
      expect(assessment.source).toBe('guided');
      if (assessment.source === 'guided') {
        expect(assessment.folds.chest).not.toBeNull();
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/demoAssessmentData.test.ts`
Expected: FAIL with "Cannot find module '../demoAssessmentData'"

- [ ] **Step 3: Write the implementation**

```ts
import { Timestamp } from 'firebase/firestore';

import type { AssessmentView } from '../../hooks/useAssessments';

/**
 * Demonstrative data only — never persisted, never sent to any backend.
 * Used exclusively by `BodyEvolutionView` to feed the blurred preview shown
 * when the real account has no assessments yet (see `EvolutionLockedPreview`).
 *
 * Dates are relative to `now` (rather than fixed calendar dates) so the
 * preview always looks current, no matter when it's viewed.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface DemoAssessmentSpec {
  weeksAgo: number;
  weight: number;
  bodyFat: number;
  bmi: number;
  leanMass: number;
  fatMass: number;
  chest: number;
  abdom: number;
  thigh: number;
}

// Newest first, matching the real hook's contract. Weight/body-fat/folds all
// trend down from oldest to newest — a believable short progression.
const DEMO_ENTRIES: readonly DemoAssessmentSpec[] = [
  { weeksAgo: 0, weight: 79.5, bodyFat: 19.6, bmi: 26.0, leanMass: 63.9, fatMass: 15.6, chest: 12, abdom: 20, thigh: 22 },
  { weeksAgo: 1, weight: 80.9, bodyFat: 20.8, bmi: 26.4, leanMass: 64.1, fatMass: 16.8, chest: 14, abdom: 22, thigh: 24 },
  { weeksAgo: 2, weight: 82.4, bodyFat: 22.0, bmi: 26.9, leanMass: 64.3, fatMass: 18.1, chest: 16, abdom: 24, thigh: 26 },
  { weeksAgo: 3, weight: 84.0, bodyFat: 23.5, bmi: 27.4, leanMass: 64.3, fatMass: 19.7, chest: 18, abdom: 26, thigh: 28 },
];

export function buildDemoAssessments(now: Date = new Date()): AssessmentView[] {
  return DEMO_ENTRIES.map((entry, index) => ({
    id: `demo-assessment-${index}`,
    source: 'guided' as const,
    measuredAt: Timestamp.fromDate(new Date(now.getTime() - entry.weeksAgo * WEEK_MS)),
    createdAt: null,
    weight: entry.weight,
    height: 175,
    bodyFat: entry.bodyFat,
    calculatorVersion: 1 as const,
    protocol: 'jp3' as const,
    sex: 'm' as const,
    age: 30,
    folds: { chest: entry.chest, abdom: entry.abdom, thigh: entry.thigh },
    bmi: entry.bmi,
    leanMass: entry.leanMass,
    fatMass: entry.fatMass,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/demoAssessmentData.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/fitness/demoAssessmentData.ts src/components/fitness/__tests__/demoAssessmentData.test.ts
git commit -m "feat: add demo assessment data for the Evolução locked preview"
```

---

### Task 2: Demo load-progress data module

**Files:**
- Create: `src/components/fitness/demoLoadProgressData.ts`
- Test: `src/components/fitness/__tests__/demoLoadProgressData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildDemoLoadExercises, buildDemoLoadRecords } from '../demoLoadProgressData';

describe('buildDemoLoadExercises', () => {
  it('returns real exercise ids with at least two ascending, chronologically-ordered points', () => {
    const exercises = buildDemoLoadExercises('2026-10-09');

    expect(exercises.length).toBeGreaterThan(0);
    exercises.forEach((exercise) => {
      expect(exercise.history.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i + 1 < exercise.history.length; i += 1) {
        expect(exercise.history[i]!.localDate < exercise.history[i + 1]!.localDate).toBe(true);
        expect(exercise.history[i]!.loadKg).toBeLessThanOrEqual(exercise.history[i + 1]!.loadKg);
      }
    });
  });

  it('never dates a point after the given "today"', () => {
    const exercises = buildDemoLoadExercises('2026-10-09');
    exercises.forEach((exercise) => {
      exercise.history.forEach((point) => {
        expect(point.localDate <= '2026-10-09').toBe(true);
      });
    });
  });
});

describe('buildDemoLoadRecords', () => {
  it('returns one record per demo exercise, each strictly beating its previous best', () => {
    const records = buildDemoLoadRecords('2026-10-09');
    expect(records.length).toBeGreaterThan(0);
    records.forEach((record) => {
      expect(record.loadKg).toBeGreaterThan(record.previousBestKg);
      expect(record.localDate <= '2026-10-09').toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/demoLoadProgressData.test.ts`
Expected: FAIL with "Cannot find module '../demoLoadProgressData'"

- [ ] **Step 3: Write the implementation**

```ts
import { addDaysLocal, type LocalDate } from '../../scheduleEngine/calendar';
import type { ExerciseLoadProgress, LoadPersonalRecord } from '../../loadProgress/loadProgress';

/**
 * Demonstrative data only — never persisted, never sent to any backend.
 * Used exclusively by `LoadsEvolutionView` to feed the blurred preview shown
 * when the real account has no load history yet (see `EvolutionLockedPreview`).
 *
 * All three exercise ids are real catalog entries (`exercisesSeedData.ts`),
 * so `exerciseDisplayName` resolves a real translated name instead of
 * falling back to the raw id. Dates are relative to `todayLocalDate` so the
 * preview always looks current, no matter when it's viewed.
 */

interface DemoExerciseSpec {
  exerciseId: string;
  loadsKgOldestToNewest: readonly number[];
}

const DEMO_EXERCISES: readonly DemoExerciseSpec[] = [
  { exerciseId: 'barbell-back-squat', loadsKgOldestToNewest: [60, 65, 70, 75] },
  { exerciseId: 'conventional-deadlift', loadsKgOldestToNewest: [80, 85, 92, 100] },
  { exerciseId: 'machine-flat-bench-press', loadsKgOldestToNewest: [40, 42, 45, 48] },
];

export function buildDemoLoadExercises(todayLocalDate: LocalDate): ExerciseLoadProgress[] {
  return DEMO_EXERCISES.map(({ exerciseId, loadsKgOldestToNewest }) => ({
    exerciseId,
    history: loadsKgOldestToNewest.map((loadKg, index) => {
      const daysAgo = (loadsKgOldestToNewest.length - 1 - index) * 7;
      return {
        executionId: `demo-execution-${exerciseId}-${index}`,
        localDate: addDaysLocal(todayLocalDate, -daysAgo),
        loadKg,
      };
    }),
  }));
}

export function buildDemoLoadRecords(todayLocalDate: LocalDate): LoadPersonalRecord[] {
  return DEMO_EXERCISES.map(({ exerciseId, loadsKgOldestToNewest }) => {
    const latest = loadsKgOldestToNewest[loadsKgOldestToNewest.length - 1]!;
    const previous = loadsKgOldestToNewest[loadsKgOldestToNewest.length - 2]!;
    return {
      executionId: `demo-execution-${exerciseId}-${loadsKgOldestToNewest.length - 1}`,
      exerciseId,
      localDate: todayLocalDate,
      loadKg: latest,
      previousBestKg: previous,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/demoLoadProgressData.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/fitness/demoLoadProgressData.ts src/components/fitness/__tests__/demoLoadProgressData.test.ts
git commit -m "feat: add demo load-progress data for the Evolução locked preview"
```

---

### Task 3: `EvolutionLockedPreview` component

**Files:**
- Create: `src/components/fitness/EvolutionLockedPreview.tsx`
- Test: `src/components/fitness/__tests__/evolutionLockedPreview.test.ts`

This file is new, so there's no pre-existing behavior to pin with a string-architecture test the way the other two tasks' logic was pinned with real unit tests — the demo-data modules are pure functions testable directly, but this component's correctness (blur rendering, touch-blocking, centering) can only really be confirmed visually. Per the existing convention in this codebase (`bodyMeasurementsEvolution.test.ts`, `evolutionChartInteraction.test.ts`), write a source-text architecture test asserting the structural invariants that matter (no interaction leaking through, CTA always reachable), then verify the rest with manual QA in Task 9.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync('src/components/fitness/EvolutionLockedPreview.tsx', 'utf8');

describe('EvolutionLockedPreview', () => {
  it('disables interaction with the demo content behind the blur', () => {
    expect(component).toContain("pointerEvents=\"none\"");
    expect(component).toContain('accessibilityElementsHidden');
    expect(component).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it('keeps the CTA reachable through the blur layer', () => {
    expect(component).toContain('pointerEvents="box-none"');
  });

  it('uses the same Android blur workaround as the photo vault locked state', () => {
    expect(component).toContain('BlurTargetView');
    expect(component).toContain('blurMethod="dimezisBlurViewSdk31Plus"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/evolutionLockedPreview.test.ts`
Expected: FAIL with "ENOENT" (file does not exist)

- [ ] **Step 3: Write the implementation**

```tsx
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';

import { Display } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';

/**
 * Wraps a real (but demo-data-fed) panel with a blurred, dimmed preview and a
 * centered unlock message — used by `BodyEvolutionView`/`LoadsEvolutionView`
 * when the account has no real data yet for that panel.
 *
 * The demo content behind the blur is never interactive and never announced
 * to a screen reader: it exists purely to show the shape of the real feature,
 * not to be touched. Only the message card (icon, title, description, CTA)
 * is ever at full opacity and tappable.
 */

const BLUR_INTENSITY = 26;

interface Props {
  title: string;
  description: string;
  ctaLabel?: string;
  onPress?: () => void;
  children: React.ReactNode;
}

export function EvolutionLockedPreview({ title, description, ctaLabel, onPress, children }: Props) {
  const { theme } = useTheme();
  const blurTargetRef = useRef<View | null>(null);

  return (
    <View style={{ position: 'relative' }} accessibilityLabel={title}>
      <BlurTargetView ref={blurTargetRef}>
        <View
          style={{ opacity: 0.45 }}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {children}
        </View>
      </BlurTargetView>

      <BlurView
        blurTarget={blurTargetRef}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={BLUR_INTENSITY}
        tint={theme.mode === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.center} pointerEvents="box-none">
        <View
          style={{
            maxWidth: 280,
            alignItems: 'center',
            gap: spacing[3],
            paddingVertical: spacing[6],
            paddingHorizontal: spacing[6],
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
            backgroundColor: theme.colors.surfaceElevated,
          }}
        >
          <Icon name="lock" size={26} color={theme.colors.primaryEmphasis} />
          <Display size={18} style={{ textAlign: 'center' }}>{title}</Display>
          <Text
            style={{
              fontFamily: theme.fonts.ui,
              fontSize: 13,
              lineHeight: 19,
              color: theme.colors.textMuted,
              textAlign: 'center',
            }}
          >
            {description}
          </Text>
          {ctaLabel && onPress ? (
            <Pressable
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              style={{
                marginTop: spacing[1],
                minHeight: sizes.controlMd,
                justifyContent: 'center',
                paddingHorizontal: spacing[5],
                borderRadius: radii.control,
                backgroundColor: theme.colors.primary,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.primaryForeground }}>
                {ctaLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sizes.screenGutter,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/evolutionLockedPreview.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/fitness/EvolutionLockedPreview.tsx src/components/fitness/__tests__/evolutionLockedPreview.test.ts
git commit -m "feat: add EvolutionLockedPreview blurred-preview wrapper"
```

---

### Task 4: Wire `BodyEvolutionView` to the locked preview

**Files:**
- Modify: `src/components/fitness/BodyEvolutionView.tsx`
- Test: `src/components/fitness/__tests__/bodyMeasurementsEvolution.test.ts` (extend existing file in place)

Current structure (`BodyEvolutionView.tsx:394-434`) returns a plain empty block when `!latest`, and the filled-state JSX below it (`:436-571`) is a separate return keyed off the real `assessments`/`latest`/`evolutionSincePrevious`. To avoid duplicating that whole JSX tree, introduce `displayAssessments`/`displayLatest`/`displayEvolution` computed once, fed by demo data only when real data is empty, and render the existing filled-state JSX unconditionally from those — wrapping it in `EvolutionLockedPreview` only when real data is actually empty. The "ver avaliação completa" row stays gated on the real `onOpenAssessment`/`latest`, never on the demo fallback, since there's nothing real to open from the locked preview.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/components/fitness/__tests__/bodyMeasurementsEvolution.test.ts`:

```ts
describe('body evolution locked preview', () => {
  it('wraps the real panel in EvolutionLockedPreview, fed by demo data, only when there is no real assessment', () => {
    expect(view).toContain("import { EvolutionLockedPreview } from './EvolutionLockedPreview'");
    expect(view).toContain("import { buildDemoAssessments } from './demoAssessmentData'");
    expect(view).toContain('const displayLatest = latest ?? demoAssessments[0]');
    expect(view).toContain('<EvolutionLockedPreview');
    expect(view).toContain("title={t('progress.body.empty.title')}");
    expect(view).toContain("description={t('progress.body.empty.description')}");
    // The "open full assessment" row must stay gated on the REAL latest, not the demo fallback.
    expect(view).toContain('{onOpenAssessment && latest ?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/bodyMeasurementsEvolution.test.ts`
Expected: FAIL (new `describe` block's `expect`s don't match current source)

- [ ] **Step 3: Write the implementation**

Replace `BodyEvolutionView.tsx:1-14` imports with:

```tsx
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EvolutionAreaChart } from './EvolutionAreaChart';
import { EvolutionLockedPreview } from './EvolutionLockedPreview';
import { buildDemoAssessments } from './demoAssessmentData';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { AssessmentDelta, AssessmentView } from '../../hooks/useAssessments';
import type { SiteKey } from '../../lib/skinfoldCalculator';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';
```

Replace the body of the exported `BodyEvolutionView` function (`BodyEvolutionView.tsx:314-571`, from `export function BodyEvolutionView({` through its closing `}`) with:

```tsx
export function BodyEvolutionView({
  assessments,
  loading,
  error,
  latest,
  evolutionSincePrevious,
  onRetry,
  onOpenAssessment,
}: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    [],
  );

  // No real assessments yet: feed the exact same panel with local,
  // non-persisted demo data instead of a plain "no data" block. Never
  // computed when real data exists, and never mixed with it.
  const demoAssessments = useMemo(() => (latest ? [] : buildDemoAssessments()), [latest]);
  const displayAssessments = latest ? assessments : demoAssessments;
  const displayLatest = latest ?? demoAssessments[0] ?? null;
  const displayEvolution = latest ? evolutionSincePrevious : null;

  // The hook returns newest first; a chart reads oldest to newest.
  const weightPoints = useMemo(
    () =>
      [...displayAssessments]
        .reverse()
        .map((entry) => ({
          value: weightFromKg(entry.weight, resolvedUnits),
          displayValue: `${formatWeightFromKg(entry.weight, resolvedUnits)} ${unit.toUpperCase()}`,
          label: dateFormatter.format(entry.measuredAt.toDate()),
        })),
    [displayAssessments, dateFormatter, resolvedUnits, unit],
  );

  const bounds = useMemo(() => {
    if (displayAssessments.length < 2) return null;
    const oldest = displayAssessments[displayAssessments.length - 1]!;
    const newest = displayAssessments[0]!;
    return {
      from: dateFormatter.format(oldest.measuredAt.toDate()),
      to: dateFormatter.format(newest.measuredAt.toDate()),
    };
  }, [displayAssessments, dateFormatter]);

  if (loading) {
    return (
      <CenteredState>
        <ActivityIndicator color={theme.colors.textFaint} />
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondary }}>
          {t('progress.body.loading')}
        </Text>
      </CenteredState>
    );
  }

  if (error) {
    return (
      <CenteredState>
        <Text
          style={{
            fontFamily: theme.fonts.ui,
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: 'center',
          }}
        >
          {t('progress.body.error')}
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('progress.body.retry')}
          style={{ paddingVertical: spacing[2.5], paddingHorizontal: spacing[4.5] }}
        >
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
            {t('progress.body.retry')}
          </Text>
        </Pressable>
      </CenteredState>
    );
  }

  if (!displayLatest) {
    // Still possible in principle (demo data is non-empty by construction),
    // but keeps the component total if that ever changes.
    return null;
  }

  const measuredAt = dateFormatter.format(displayLatest.measuredAt.toDate());

  const panel = (
    <View>
      {/* Hero: one number carries the screen. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[3] }}>
          {t('progress.body.currentWeight').toUpperCase()}
        </Slash>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
          <Display size={54}>{formatWeightFromKg(displayLatest.weight, resolvedUnits)}</Display>
          <MonoLabel size={12}>{unit.toUpperCase()}</MonoLabel>
          {displayEvolution ? (
            <View style={{ marginLeft: spacing[1] }}>
              <Delta value={weightFromKg(displayEvolution.weightDelta, resolvedUnits)} />
            </View>
          ) : null}
        </View>
        <MonoLabel size={9} style={{ marginTop: spacing[1.5] }}>
          {t('progress.body.measuredAt', { date: measuredAt })}
        </MonoLabel>
      </View>

      {/* Chart, or an honest note when a single point cannot draw a curve. */}
      <View style={{ marginTop: spacing[6] }}>
        {weightPoints.length >= 2 ? (
          <>
            <View style={{ paddingHorizontal: GUTTER }}>
              <EvolutionAreaChart
                points={weightPoints}
                accessibilityLabel={t('progress.body.currentWeight')}
                accessibilityHint={t('progress.chartInteractionHint')}
              />
            </View>
            {bounds ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: GUTTER,
                  marginTop: spacing[2],
                }}
              >
                <MonoLabel size={9}>{bounds.from}</MonoLabel>
                <MonoLabel size={9}>{bounds.to}</MonoLabel>
              </View>
            ) : null}
          </>
        ) : (
          <Text
            style={{
              paddingHorizontal: GUTTER,
              fontFamily: theme.fonts.ui,
              fontSize: 12.5,
              color: theme.colors.textFaint,
            }}
          >
            {t('progress.body.singleEntry')}
          </Text>
        )}
      </View>

      <Rule />

      {/* Composition. Only what the domain actually reports for this entry. */}
      <View style={{ paddingHorizontal: GUTTER, marginBottom: spacing[1] }}>
        <Slash>{t('progress.body.composition').toUpperCase()}</Slash>
      </View>

      {displayLatest.bodyFat != null ? (
        <MetricRow
          label={t('progress.body.metrics.bodyFat')}
          value={displayLatest.bodyFat.toFixed(1)}
          unit="%"
          delta={displayEvolution?.bodyFatDelta ?? null}
        />
      ) : null}
      {displayLatest.leanMass != null ? (
        <MetricRow
          label={t('progress.body.metrics.leanMass')}
          value={formatWeightFromKg(displayLatest.leanMass, resolvedUnits)}
          unit={unit}
          delta={
            displayEvolution?.leanMassDelta != null
              ? weightFromKg(displayEvolution.leanMassDelta, resolvedUnits)
              : null
          }
        />
      ) : null}
      {displayLatest.fatMass != null ? (
        <MetricRow
          label={t('progress.body.metrics.fatMass')}
          value={formatWeightFromKg(displayLatest.fatMass, resolvedUnits)}
          unit={unit}
          delta={
            displayEvolution?.fatMassDelta != null
              ? weightFromKg(displayEvolution.fatMassDelta, resolvedUnits)
              : null
          }
        />
      ) : null}
      {displayLatest.bmi != null ? (
        <MetricRow
          label={t('progress.body.metrics.bmi')}
          value={displayLatest.bmi.toFixed(1)}
          unit=""
        />
      ) : null}

      <Rule />
      <BodyMeasurementsChart assessments={displayAssessments} />

      {onOpenAssessment && latest ? (
        <>
          <Rule />
          <Pressable
            onPress={onOpenAssessment}
            accessibilityRole="button"
            accessibilityLabel={t('progress.body.openAssessment')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginHorizontal: GUTTER,
              paddingVertical: spacing[3.5],
            }}
          >
            <MonoLabel color={theme.colors.textPrimary}>
              {t('progress.body.openAssessment').toUpperCase()}
            </MonoLabel>
            <Icon name="chevron-right" size={16} color={theme.colors.primaryEmphasis} />
          </Pressable>
        </>
      ) : null}
    </View>
  );

  if (!latest) {
    return (
      <EvolutionLockedPreview
        title={t('progress.body.empty.title')}
        description={t('progress.body.empty.description')}
        ctaLabel={onOpenAssessment ? t('progress.body.empty.cta') : undefined}
        onPress={onOpenAssessment}
      >
        {panel}
      </EvolutionLockedPreview>
    );
  }

  return panel;
}
```

Note: `CenteredState`, `MetricRow`, `Delta`, `Rule`, `BodyMeasurementsChart`, `GUTTER`, `Props`, and `MEASUREMENT_SITE_KEYS` (lines 15-129, 131-312 of the original file) are unchanged — only the exported `BodyEvolutionView` function body and the import block change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/bodyMeasurementsEvolution.test.ts src/components/fitness/__tests__/evolutionChartInteraction.test.ts`
Expected: PASS — including the pre-existing `evolutionChartInteraction.test.ts` assertions (`<EvolutionAreaChart` appears exactly twice, etc.), since the chart-rendering JSX itself didn't change, only what feeds it.

- [ ] **Step 5: Commit**

```bash
git add src/components/fitness/BodyEvolutionView.tsx src/components/fitness/__tests__/bodyMeasurementsEvolution.test.ts
git commit -m "feat: show blurred demo preview on Corpo tab when there are no assessments"
```

---

### Task 5: Wire `LoadsEvolutionView` to the locked preview

**Files:**
- Modify: `src/components/fitness/LoadsEvolutionView.tsx`
- Test: `src/components/fitness/__tests__/evolutionChartInteraction.test.ts` (extend existing file in place)

Same technique as Task 4: compute `displayExercises`/`displayRecords` once (demo-fed only when `exercises.length === 0`), render the existing filled-state JSX unconditionally from those, and wrap it in `EvolutionLockedPreview` only when real `exercises.length === 0`. Also add the new `onStartWorkout?: () => void` prop for the CTA.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/components/fitness/__tests__/evolutionChartInteraction.test.ts`:

```ts
describe('loads evolution locked preview', () => {
  it('wraps the real panel in EvolutionLockedPreview, fed by demo data, only when there is no real load history', () => {
    expect(loadsView).toContain("import { EvolutionLockedPreview } from './EvolutionLockedPreview'");
    expect(loadsView).toContain(
      "import { buildDemoLoadExercises, buildDemoLoadRecords } from './demoLoadProgressData'",
    );
    expect(loadsView).toContain('const displayExercises = exercises.length ? exercises : demoExercises');
    expect(loadsView).toContain('<EvolutionLockedPreview');
    expect(loadsView).toContain("title={t('progress.loads.empty.title')}");
    expect(loadsView).toContain("description={t('progress.loads.empty.description')}");
    expect(loadsView).toContain('onPress={onStartWorkout}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/evolutionChartInteraction.test.ts`
Expected: FAIL (new `describe` block's `expect`s don't match current source)

- [ ] **Step 3: Write the implementation**

Replace `LoadsEvolutionView.tsx:1-24` imports with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  LOAD_PROGRESS_PERIODS,
  loadHistoryForPeriod,
  normalizeExerciseSearch,
  type ExerciseLoadProgress,
  type LoadPersonalRecord,
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
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { EvolutionAreaChart } from './EvolutionAreaChart';
import { EvolutionLockedPreview } from './EvolutionLockedPreview';
import { buildDemoLoadExercises, buildDemoLoadRecords } from './demoLoadProgressData';
```

Replace the function signature and body (`LoadsEvolutionView.tsx:46-357`, from `export function LoadsEvolutionView({` through the end of the file) with:

```tsx
export function LoadsEvolutionView({
  exercises,
  recordsLast90Days,
  todayLocalDate,
  loading,
  error,
  onRetry,
  onStartWorkout,
}: {
  exercises: ExerciseLoadProgress[];
  recordsLast90Days: LoadPersonalRecord[];
  todayLocalDate: string;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Starts a workout. Absent when the host cannot drive that flow. */
  onStartWorkout?: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<LoadProgressPeriod>(90);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showAllRecords, setShowAllRecords] = useState(false);

  // No real load history yet: feed the exact same panel with local,
  // non-persisted demo data instead of a plain "no data" block. Never
  // computed when real data exists, and never mixed with it.
  const demoExercises = useMemo(
    () => (exercises.length ? [] : buildDemoLoadExercises(todayLocalDate)),
    [exercises.length, todayLocalDate],
  );
  const demoRecords = useMemo(
    () => (exercises.length ? [] : buildDemoLoadRecords(todayLocalDate)),
    [exercises.length, todayLocalDate],
  );
  const displayExercises = exercises.length ? exercises : demoExercises;
  const displayRecords = exercises.length ? recordsLast90Days : demoRecords;

  const catalogLocale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';
  const exerciseName = (exerciseId: string) => exerciseDisplayName(exerciseId, catalogLocale);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    [i18n.language, i18n.resolvedLanguage],
  );

  const orderedExercises = useMemo(
    () => displayExercises.slice().sort((a, b) => {
      const aLatest = a.history[a.history.length - 1]?.localDate ?? '';
      const bLatest = b.history[b.history.length - 1]?.localDate ?? '';
      return bLatest.localeCompare(aLatest) || exerciseName(a.exerciseId).localeCompare(exerciseName(b.exerciseId));
    }),
    // The translated catalog name changes with i18n.language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayExercises, i18n.language],
  );

  useEffect(() => {
    if (selectedId && displayExercises.some((exercise) => exercise.exerciseId === selectedId)) return;
    setSelectedId(orderedExercises[0]?.exerciseId ?? null);
  }, [displayExercises, orderedExercises, selectedId]);

  const selected = displayExercises.find((exercise) => exercise.exerciseId === selectedId) ?? null;
  const normalizedQuery = normalizeExerciseSearch(query);
  const searchResults = orderedExercises
    .filter((exercise) => normalizeExerciseSearch(exerciseName(exercise.exerciseId)).includes(normalizedQuery))
    .slice(0, 8);
  const periodHistory = selected
    ? loadHistoryForPeriod(selected.history, period, todayLocalDate)
    : [];
  const first = periodHistory[0] ?? null;
  const latest = periodHistory[periodHistory.length - 1] ?? null;
  const deltaKg = first && latest ? latest.loadKg - first.loadKg : null;
  const unit = workoutLoadUnit(resolvedUnits);
  const visibleRecords = showAllRecords ? displayRecords : displayRecords.slice(0, 3);

  if (loading && exercises.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: spacing[10] }}>
        <ActivityIndicator color={theme.colors.primaryEmphasis} />
        <MonoLabel size={9} style={{ marginTop: spacing[3] }}>
          {t('progress.loads.loading').toUpperCase()}
        </MonoLabel>
      </View>
    );
  }

  if (error && exercises.length === 0) {
    return (
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[6] }}>
        <Slash>{t('progress.loads.eyebrow').toUpperCase()}</Slash>
        <View style={{ alignItems: 'center', paddingVertical: spacing[9], gap: spacing[3] }}>
          <Icon name="alert-triangle" size={25} color={theme.colors.dangerText} />
          <Display size={20} style={{ textAlign: 'center' }}>{t('progress.loads.error.title')}</Display>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, textAlign: 'center' }}>
            {t('progress.loads.error.description')}
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: sizes.controlMd,
              justifyContent: 'center',
              paddingHorizontal: spacing[5],
              borderRadius: radii.control,
              backgroundColor: theme.colors.primary,
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <MonoLabel size={9} color={theme.colors.primaryForeground}>{t('progress.loads.error.retry')}</MonoLabel>
          </Pressable>
        </View>
      </View>
    );
  }

  const panel = (
    <View>
      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[4] }}>{t('progress.loads.records90Title').toUpperCase()}</Slash>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
          <Display size={54}>{displayRecords.length}</Display>
          <MonoLabel size={10} color={theme.colors.textMuted}>
            {t('progress.loads.recordsCount', { count: displayRecords.length }).toUpperCase()}
          </MonoLabel>
        </View>

        <Slash style={{ marginTop: spacing[6], marginBottom: spacing[2] }}>
          {t('progress.loads.topRecords').toUpperCase()}
        </Slash>
        {visibleRecords.length === 0 ? (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, color: theme.colors.textMuted }}>
            {t('progress.loads.noRecentRecords')}
          </Text>
        ) : visibleRecords.map((record) => (
          <View
            key={`${record.executionId}:${record.exerciseId}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3.5], paddingVertical: spacing[3], borderBottomWidth: sizes.hairline, borderBottomColor: theme.colors.border }}
          >
            <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, backgroundColor: theme.colors.primarySoft }}>
              <Icon name="trophy" size={17} color={theme.colors.primaryEmphasis} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
                {exerciseName(record.exerciseId)}
              </Text>
              <MonoLabel size={8.5} style={{ marginTop: spacing[1] }}>
                {t('progress.loads.recordedAt', { date: dateFormatter.format(localDateAsDate(record.localDate)) })}
              </MonoLabel>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: theme.fonts.display, fontSize: 18, color: theme.colors.textPrimary }}>
                {formatWorkoutLoadFromKg(record.loadKg, resolvedUnits)}{' '}
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textFaint }}>{unit.toUpperCase()}</Text>
              </Text>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.primaryEmphasis }}>
                {t('progress.loads.recordGain', {
                  value: formatWorkoutLoadFromKg(record.loadKg - record.previousBestKg, resolvedUnits),
                  unit,
                })}
              </Text>
            </View>
          </View>
        ))}

        {displayRecords.length > 3 ? (
          <Pressable
            onPress={() => setShowAllRecords((current) => !current)}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: sizes.controlMd, marginTop: spacing[3], alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, borderWidth: 1, borderColor: theme.colors.border, opacity: pressed ? 0.78 : 1 })}
          >
            <MonoLabel size={9} color={theme.colors.primaryEmphasis}>
              {t(showAllRecords ? 'progress.loads.showLess' : 'progress.loads.seeAllRecords').toUpperCase()}
            </MonoLabel>
          </Pressable>
        ) : null}
      </View>

      <Rule />

      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[3] }}>{t('progress.loads.exerciseEvolution').toUpperCase()}</Slash>
        <View style={{ height: 52, borderRadius: radii.lg, borderWidth: 1, borderColor: searchFocused ? theme.colors.inputBorderFocusStrong : theme.colors.inputBorder, backgroundColor: theme.colors.inputBackground, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], gap: spacing[2.5] }}>
          <Icon name="search" size={18} color={searchFocused ? theme.colors.primaryEmphasis : theme.colors.inputIcon} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t('progress.loads.searchPlaceholder')}
            placeholderTextColor={theme.colors.inputPlaceholder}
            selectionColor={theme.colors.inputSelection}
            autoCorrect={false}
            style={{ flex: 1, color: theme.colors.inputText, fontFamily: theme.fonts.uiMed, fontSize: 14 }}
          />
        </View>

        <View style={{ marginTop: spacing[2] }}>
          {searchResults.length === 0 ? (
            <MonoLabel size={9} style={{ paddingVertical: spacing[3] }}>{t('progress.loads.noExerciseFound')}</MonoLabel>
          ) : searchResults.map((exercise) => {
            const isSelected = selectedId === exercise.exerciseId;
            const latestPoint = exercise.history[exercise.history.length - 1]!;
            return (
              <Pressable
                key={exercise.exerciseId}
                onPress={() => { setSelectedId(exercise.exerciseId); setQuery(''); }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t('progress.loads.accessibility.selectExercise', { exercise: exerciseName(exercise.exerciseId) })}
                style={({ pressed }) => ({ minHeight: 48, paddingVertical: spacing[2.5], flexDirection: 'row', alignItems: 'center', borderBottomWidth: sizes.hairline, borderBottomColor: theme.colors.border, opacity: pressed ? 0.75 : 1 })}
              >
                <Text style={{ flex: 1, fontFamily: isSelected ? theme.fonts.uiSemi : theme.fonts.ui, fontSize: 13.5, color: isSelected ? theme.colors.primaryEmphasis : theme.colors.textPrimary }}>
                  {exerciseName(exercise.exerciseId)}
                </Text>
                <MonoLabel size={9} color={theme.colors.textMuted}>
                  {formatWorkoutLoadFromKg(latestPoint.loadKg, resolvedUnits)} {unit.toUpperCase()}
                </MonoLabel>
                <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
              </Pressable>
            );
          })}
        </View>

        {selected ? (
          <View style={{ marginTop: spacing[6] }}>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 18, color: theme.colors.textPrimary }}>
              {exerciseName(selected.exerciseId)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
              {LOAD_PROGRESS_PERIODS.map((value) => {
                const active = period === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setPeriod(value)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => ({ flex: 1, minHeight: sizes.controlSm, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, borderWidth: 1, borderColor: active ? theme.colors.primaryEmphasis : theme.colors.border, backgroundColor: active ? theme.colors.surfaceSelected : theme.colors.surface, opacity: pressed ? 0.8 : 1 })}
                  >
                    <MonoLabel size={8.5} color={active ? theme.colors.textPrimary : theme.colors.textFaint}>
                      {t(`progress.loads.ranges.${value}`)}
                    </MonoLabel>
                  </Pressable>
                );
              })}
            </View>

            {latest ? (
              <>
                <View style={{ marginTop: spacing[5] }}>
                  <MonoLabel size={9}>{t('progress.loads.currentLoad').toUpperCase()}</MonoLabel>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2], marginTop: spacing[1] }}>
                    <Display size={48}>{formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits)}</Display>
                    <MonoLabel size={11}>{unit.toUpperCase()}</MonoLabel>
                    {deltaKg != null && periodHistory.length > 1 ? (
                      <Text style={{ marginLeft: spacing[1], fontFamily: theme.fonts.mono, fontSize: 10.5, color: deltaKg >= 0 ? theme.colors.primaryEmphasis : theme.colors.dangerText }}>
                        {deltaKg >= 0 ? '↑' : '↓'} {deltaKg >= 0 ? '+' : '-'}
                        {formatWorkoutLoadFromKg(Math.abs(deltaKg), resolvedUnits)} {unit}
                      </Text>
                    ) : null}
                  </View>
                  <MonoLabel size={9} style={{ marginTop: spacing[1] }}>
                    {periodHistory.length > 1 ? t('progress.loads.periodDifference', { days: period }) : t('progress.loads.noComparison')}
                  </MonoLabel>
                </View>

                {periodHistory.length > 1 ? (
                  <View
                    style={{ marginTop: spacing[5] }}
                  >
                    <EvolutionAreaChart
                      points={periodHistory.map((point) => ({
                        value: workoutLoadFromKg(point.loadKg, resolvedUnits),
                        displayValue: `${formatWorkoutLoadFromKg(point.loadKg, resolvedUnits)} ${unit.toUpperCase()}`,
                        label: dateFormatter.format(localDateAsDate(point.localDate)),
                      }))}
                      accessibilityLabel={t('progress.loads.accessibility.chart', {
                        exercise: exerciseName(selected.exerciseId),
                        value: formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits),
                        unit,
                      })}
                      accessibilityHint={t('progress.chartInteractionHint')}
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                      <MonoLabel size={9}>{dateFormatter.format(localDateAsDate(first!.localDate))}</MonoLabel>
                      <MonoLabel size={9}>{dateFormatter.format(localDateAsDate(latest.localDate))}</MonoLabel>
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
          </View>
        ) : null}
      </View>
    </View>
  );

  if (exercises.length === 0) {
    return (
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[6] }}>
        <Slash style={{ marginBottom: spacing[5] }}>{t('progress.loads.eyebrow').toUpperCase()}</Slash>
        <EvolutionLockedPreview
          title={t('progress.loads.empty.title')}
          description={t('progress.loads.empty.description')}
          ctaLabel={onStartWorkout ? t('progress.loads.empty.cta') : undefined}
          onPress={onStartWorkout}
        >
          {panel}
        </EvolutionLockedPreview>
      </View>
    );
  }

  return panel;
}
```

`GUTTER`, `Rule`, and `localDateAsDate` (original lines 26-44) are unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/evolutionChartInteraction.test.ts`
Expected: PASS — including the pre-existing assertion that `<EvolutionAreaChart` appears exactly once in `loadsView`, since the chart-rendering JSX didn't change, only what feeds it.

- [ ] **Step 5: Commit**

```bash
git add src/components/fitness/LoadsEvolutionView.tsx src/components/fitness/__tests__/evolutionChartInteraction.test.ts
git commit -m "feat: show blurred demo preview on Cargas tab when there is no load history"
```

---

### Task 6: Update i18n copy (en, es, pt-BR)

**Files:**
- Modify: `src/i18n/resources/pt-BR/home.json`
- Modify: `src/i18n/resources/en/home.json`
- Modify: `src/i18n/resources/es/home.json`
- Test: `src/i18n/__tests__/evolucaoEmptyStateCopy.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

describe('Evolução locked-preview copy', () => {
  it('matches the required pt-BR copy exactly', () => {
    expect(ptBR.progress.body.empty.title).toBe('Desbloqueie sua evolução corporal');
    expect(ptBR.progress.body.empty.description).toBe(
      'Faça sua primeira avaliação física para acompanhar suas mudanças ao longo do tempo.',
    );
    expect(ptBR.progress.body.empty.cta).toBe('Fazer avaliação');
    expect(ptBR.progress.loads.empty.title).toBe('Sua evolução começa aqui');
    expect(ptBR.progress.loads.empty.description).toBe(
      'Registre as cargas dos seus exercícios para acompanhar sua força e seus recordes pessoais.',
    );
    expect(ptBR.progress.loads.empty.cta).toBe('Iniciar treino');
  });

  it('removes the now-orphaned loads.empty.hint key everywhere', () => {
    expect((ptBR.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
    expect((en.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
    expect((es.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
  });

  it('keeps all three locales structurally parallel for the touched keys', () => {
    [en, es, ptBR].forEach((locale) => {
      expect(typeof locale.progress.body.empty.title).toBe('string');
      expect(typeof locale.progress.body.empty.description).toBe('string');
      expect(typeof locale.progress.body.empty.cta).toBe('string');
      expect(typeof locale.progress.loads.empty.title).toBe('string');
      expect(typeof locale.progress.loads.empty.description).toBe('string');
      expect(typeof locale.progress.loads.empty.cta).toBe('string');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/i18n/__tests__/evolucaoEmptyStateCopy.test.ts`
Expected: FAIL on the pt-BR copy assertions (current text is the old "Nenhuma avaliação registrada" / "Ainda sem histórico de cargas" wording, and `loads.empty.cta` doesn't exist yet)

- [ ] **Step 3: Edit the three locale files**

In `src/i18n/resources/pt-BR/home.json`, change:

```json
    "empty": {
      "title": "Nenhuma avaliação registrada",
      "description": "Registre sua primeira avaliação física para acompanhar peso e composição corporal ao longo do tempo.",
      "cta": "Fazer avaliação"
    }
```

to:

```json
    "empty": {
      "title": "Desbloqueie sua evolução corporal",
      "description": "Faça sua primeira avaliação física para acompanhar suas mudanças ao longo do tempo.",
      "cta": "Fazer avaliação"
    }
```

(this is the `progress.body.empty` block). And change the `progress.loads.empty` block from:

```json
    "empty": {
      "title": "Ainda sem histórico de cargas",
      "description": "As cargas concluídas durante seus treinos aparecerão aqui automaticamente.",
      "hint": "Registre uma série com carga para começar"
    },
```

to:

```json
    "empty": {
      "title": "Sua evolução começa aqui",
      "description": "Registre as cargas dos seus exercícios para acompanhar sua força e seus recordes pessoais.",
      "cta": "Iniciar treino"
    },
```

In `src/i18n/resources/en/home.json`, apply the equivalent English copy to the same two blocks:

```json
    "empty": {
      "title": "Unlock your body evolution",
      "description": "Complete your first physical assessment to track your changes over time.",
      "cta": "Take assessment"
    }
```

```json
    "empty": {
      "title": "Your evolution starts here",
      "description": "Log your exercise loads to track your strength and personal records.",
      "cta": "Start workout"
    },
```

In `src/i18n/resources/es/home.json`, apply the equivalent Spanish copy to the same two blocks:

```json
    "empty": {
      "title": "Desbloquea tu evolución corporal",
      "description": "Haz tu primera evaluación física para seguir tus cambios a lo largo del tiempo.",
      "cta": "Hacer evaluación"
    }
```

```json
    "empty": {
      "title": "Tu evolución empieza aquí",
      "description": "Registra las cargas de tus ejercicios para seguir tu fuerza y tus récords personales.",
      "cta": "Iniciar entrenamiento"
    },
```

In each of the three files, keep every other key in `progress.body.empty`/`progress.loads.empty` and all surrounding keys exactly as they are — only the `title`/`description` text, the removal of `loads.empty.hint`, and the addition of `loads.empty.cta` change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/i18n/__tests__/evolucaoEmptyStateCopy.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full i18n structural-parity test (if one exists) to confirm no other key got out of sync**

Run: `npx vitest run src/i18n`
Expected: PASS — the project already has structural-parity tests across locales (see `src/i18n/__tests__`); this confirms the edits didn't accidentally drop/duplicate a sibling key.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json src/i18n/__tests__/evolucaoEmptyStateCopy.test.ts
git commit -m "feat: update Evolução empty-state copy for the blurred locked preview"
```

---

### Task 7: Thread `onStartWorkout` through `ProgressScreen`

**Files:**
- Modify: `src/screens/ProgressScreen.tsx`
- Test: `src/screens/__tests__/progressScreenOnStartWorkout.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen onStartWorkout wiring', () => {
  it('accepts an optional onStartWorkout prop and passes it to LoadsEvolutionView', () => {
    expect(screen).toContain('onStartWorkout?: () => void;');
    expect(screen).toContain('onStartWorkout={onStartWorkout}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/__tests__/progressScreenOnStartWorkout.test.ts`
Expected: FAIL (prop doesn't exist yet)

- [ ] **Step 3: Write the implementation**

In `src/screens/ProgressScreen.tsx`, change the component signature (`:38-43`):

```tsx
export function ProgressScreen({
  onOpenAssessment,
  onStartWorkout,
}: {
  /** Opens the full assessment area. Optional so the screen stands alone. */
  onOpenAssessment?: () => void;
  /** Starts a workout. Optional so the screen stands alone. */
  onStartWorkout?: () => void;
} = {}) {
```

And update the `LoadsEvolutionView` call site (`:174-182`), including its doc comment, from:

```tsx
              ) : (
                <LoadsEvolutionView
                  exercises={loadExercises}
                  recordsLast90Days={recordsLast90Days}
                  todayLocalDate={todayLocalDate}
                  loading={loadsLoading}
                  error={loadsError}
                  onRetry={handleLoadsRetry}
                />
              )}
```

to:

```tsx
              ) : (
                <LoadsEvolutionView
                  exercises={loadExercises}
                  recordsLast90Days={recordsLast90Days}
                  todayLocalDate={todayLocalDate}
                  loading={loadsLoading}
                  error={loadsError}
                  onRetry={handleLoadsRetry}
                  onStartWorkout={onStartWorkout}
                />
              )}
```

Also update the stale comment above the `'body'` branch (`:160-164`), which currently says Corpo "shows the user's own assessments and nothing else... with no preview data behind it... never a fabricated history" — this is no longer accurate. Replace it with:

```tsx
              {view === 'body' ? (
                // Corpo shows the user's own assessments when there are any.
                // With none yet, BodyEvolutionView shows a blurred preview of
                // this same panel fed by local demo data (never persisted,
                // never real) with a CTA to the assessment flow — see
                // EvolutionLockedPreview.
                <BodyEvolutionView
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/__tests__/progressScreenOnStartWorkout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/ProgressScreen.tsx src/screens/__tests__/progressScreenOnStartWorkout.test.ts
git commit -m "feat: thread onStartWorkout through ProgressScreen to the Cargas tab"
```

---

### Task 8: Wire `AppShell` to pass `onStartWorkout`

**Files:**
- Modify: `src/screens/AppShell.tsx:2179`
- Test: `src/screens/__tests__/appShellProgressWiring.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');

describe('AppShell Progress tab wiring', () => {
  it('wires the same single start-workout entry point into the Progress tab', () => {
    expect(appShell).toContain(
      '<ProgressScreen onOpenAssessment={() => setShowAssessment(true)} onStartWorkout={requestStartWorkout} />',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/__tests__/appShellProgressWiring.test.ts`
Expected: FAIL (current line only passes `onOpenAssessment`)

- [ ] **Step 3: Write the implementation**

In `src/screens/AppShell.tsx:2179`, change:

```tsx
          <ProgressScreen onOpenAssessment={() => setShowAssessment(true)} />
```

to:

```tsx
          <ProgressScreen onOpenAssessment={() => setShowAssessment(true)} onStartWorkout={requestStartWorkout} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/__tests__/appShellProgressWiring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/AppShell.tsx src/screens/__tests__/appShellProgressWiring.test.ts
git commit -m "feat: wire the Cargas tab's unlock CTA to requestStartWorkout"
```

---

### Task 9: Full test suite, typecheck, and manual QA

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, zero failures (includes every pre-existing test plus all new ones from Tasks 1-8)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Pay particular attention to `BodyEvolutionView.tsx`/`LoadsEvolutionView.tsx` — `displayAssessments`/`displayExercises` etc. must type-check against the same types the real arrays use (`AssessmentView[]`, `ExerciseLoadProgress[]`), since the demo builders are typed to return exactly those types.

- [ ] **Step 3: Manual QA via the `/run` skill, covering every data combination in both themes**

Use the `run` skill to launch the app in the simulator and sign into (or create) test accounts covering:

1. No assessments, no load history → both Corpo and Cargas tabs show the blurred demo preview with their respective lock card, title, description and CTA; tapping "Fazer avaliação" opens the assessment flow; tapping "Iniciar treino" starts the workout-start flow; no fake data is tappable underneath the blur (search box, period tabs, exercise rows in Cargas do not respond to touch).
2. Only assessments, no load history → Corpo shows real data unblurred (including the "ver avaliação completa" row); Cargas shows the blurred demo preview.
3. Only load history, no assessments → inverse of (2).
4. Both present → neither tab is ever blurred.
5. Repeat the no-data case in light mode and dark mode — the blur tint, card colors, and text all read correctly in both.
6. While assessments/load data is loading, or a refresh fails with an error, confirm the existing loading spinner / error-with-retry UI still appears instead of the locked preview (loading and error must take priority over "no data").

Expected: all six scenarios match the spec in `docs/superpowers/specs/2026-10-09-evolucao-blurred-preview-empty-states-design.md`.

- [ ] **Step 4: Report results**

Summarize, in chat, which of the six scenarios were checked, in which theme, and any deviation found — fix forward in a new task if anything doesn't match the spec, rather than silently shipping a known gap.

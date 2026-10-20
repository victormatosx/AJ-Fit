# Evolução Shared Header + Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Evolução screen the same header geometry Treino/Dieta/Home already share (date eyebrow + title + profile avatar — title text becomes "Evolução." instead of "Treino."/"Dieta.") and a new ticker band of its own, same visual contract as the existing tickers, carrying 4 real evolution metrics (weight delta since last assessment, days since last assessment, 90-day load records, total assessments logged) — each individually hidden when its backing data doesn't exist yet. The existing blue pill tab selector (Corpo/Cargas/Fotos) is functionally untouched — it just now sits below the new ticker, inside the same shared `panelHeader` block already used by all three tabs.

**Architecture:** No shared `<Header>`/`<Ticker>` component is introduced — matches this codebase's established convention (Treino/Home/Dieta each build their own header block and their own ticker, same visual contract, independent data). Two new small files (`evolutionProgressTickerItems.ts`, pure logic; `EvolutionProgressTicker.tsx`, presentation) plus edits to `ProgressScreen.tsx` and the three `home.json` locale files.

**Tech Stack:** React Native, TypeScript, react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-evolution-shared-header-ticker-design.md`

---

## Before you start

Read `src/screens/ProgressScreen.tsx` in full (403 lines) and `src/components/evolution/EvolutionTicker.tsx` (182 lines) before starting — every step below assumes you've seen both. `git status --short` first; this repo has unrelated work-in-progress already staged — never touch, unstage, or bundle it into a commit from this plan. Commit every task by exact pathspec (`git commit -m "..." -- <files>`), never `git commit -a` or a bare `git commit` after a broad `git add`.

---

### Task 1: Pure ticker-content builder — `evolutionProgressTickerItems.ts`

**Files:**
- Create: `src/components/fitness/evolutionProgressTickerItems.ts`
- Test: `src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts`

This is plain TypeScript with no React/React Native dependency, so it gets a real behavioral unit test (calling the function, asserting its return value) rather than this codebase's usual source-string structural test for presentational components.

- [ ] **Step 1: Write the failing tests**

Create `src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEvolutionProgressTickerItems } from '../evolutionProgressTickerItems';

const translate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

const baseInput = {
  weightDeltaKg: null,
  lastAssessmentMeasuredAt: null,
  recordsLast90DaysCount: null,
  assessmentsCount: null,
  resolvedUnits: 'metric' as const,
  t: translate,
};

describe('buildEvolutionProgressTickerItems', () => {
  it('returns no items when every input is absent', () => {
    expect(buildEvolutionProgressTickerItems(baseInput)).toEqual([]);
  });

  it('shows a signed, unit-converted weight delta only when one exists', () => {
    const lost = buildEvolutionProgressTickerItems({ ...baseInput, weightDeltaKg: -1.2 });
    expect(lost).toEqual([{ label: 'progress.ticker.weightSince', value: '−1.2 kg' }]);

    const gained = buildEvolutionProgressTickerItems({ ...baseInput, weightDeltaKg: 0.8 });
    expect(gained).toEqual([{ label: 'progress.ticker.weightSince', value: '+0.8 kg' }]);
  });

  it('converts the weight delta for imperial units', () => {
    const items = buildEvolutionProgressTickerItems({ ...baseInput, weightDeltaKg: -1, resolvedUnits: 'imperial' });
    expect(items).toEqual([{ label: 'progress.ticker.weightSince', value: '−2.2 lb' }]);
  });

  it('labels "today" for an assessment measured today, and pluralizes otherwise', () => {
    const today = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: new Date() });
    expect(today).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.today' }]);

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const days = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: threeDaysAgo });
    expect(days).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.days:{"count":3}' }]);

    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const weeks = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: twoWeeksAgo });
    expect(weeks).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.weeks:{"count":2}' }]);

    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const months = buildEvolutionProgressTickerItems({ ...baseInput, lastAssessmentMeasuredAt: twoMonthsAgo });
    expect(months).toEqual([{ label: 'progress.ticker.lastAssessment', value: 'progress.loads.ago.months:{"count":2}' }]);
  });

  it('shows a real zero for 90-day records once load history exists, but omits it entirely with none', () => {
    const noHistory = buildEvolutionProgressTickerItems({ ...baseInput, recordsLast90DaysCount: null });
    expect(noHistory).toEqual([]);

    const zeroRecords = buildEvolutionProgressTickerItems({ ...baseInput, recordsLast90DaysCount: 0 });
    expect(zeroRecords).toEqual([{ label: 'progress.ticker.records90d', value: '0' }]);

    const threeRecords = buildEvolutionProgressTickerItems({ ...baseInput, recordsLast90DaysCount: 3 });
    expect(threeRecords).toEqual([{ label: 'progress.ticker.records90d', value: '3' }]);
  });

  it('omits the assessments-logged item when there are none, shows the count otherwise', () => {
    expect(buildEvolutionProgressTickerItems({ ...baseInput, assessmentsCount: null })).toEqual([]);
    expect(buildEvolutionProgressTickerItems({ ...baseInput, assessmentsCount: 5 }))
      .toEqual([{ label: 'progress.ticker.assessmentsLogged', value: '5' }]);
  });

  it('combines every available item in a fixed order: weight, last assessment, records, assessments', () => {
    const items = buildEvolutionProgressTickerItems({
      weightDeltaKg: -1.2,
      lastAssessmentMeasuredAt: new Date(),
      recordsLast90DaysCount: 2,
      assessmentsCount: 5,
      resolvedUnits: 'metric',
      t: translate,
    });
    expect(items.map((item) => item.label)).toEqual([
      'progress.ticker.weightSince',
      'progress.ticker.lastAssessment',
      'progress.ticker.records90d',
      'progress.ticker.assessmentsLogged',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts`
Expected: FAIL — `Cannot find module '../evolutionProgressTickerItems'` (or similar resolution error)

- [ ] **Step 3: Write the implementation**

Create `src/components/fitness/evolutionProgressTickerItems.ts`:

```ts
import { weightFromKg, weightUnit } from '../../units/weightConversions';
import type { ResolvedUnits } from '../../types/units';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `label` is the faint half, `value` is the accent/bold half — same split every existing ticker (Treino/Home/Dieta) uses. */
export interface EvolutionProgressTickerItem {
  label: string;
  value: string;
}

/**
 * Evolução's own ticker content — purely derived from data `ProgressScreen`
 * already loads (assessments, imported weights, load progress). Each item
 * is independently omitted when its backing real data doesn't exist yet;
 * never a fabricated placeholder. A real `0` (e.g. no PR in the last 90
 * days despite having load history) is shown as `0`, not omitted — that's
 * a true fact, not an absence of data.
 */
export function buildEvolutionProgressTickerItems({
  weightDeltaKg,
  lastAssessmentMeasuredAt,
  recordsLast90DaysCount,
  assessmentsCount,
  resolvedUnits,
  t,
}: {
  /** From `evolutionSincePrevious.weightDelta` — null when there's no previous assessment to compare against. */
  weightDeltaKg: number | null;
  /** From `latest.measuredAt.toDate()` — null when there's no assessment at all. */
  lastAssessmentMeasuredAt: Date | null;
  /** From `recordsLast90Days.length` — null when the account has no load history at all (never shown as a fabricated `0`). */
  recordsLast90DaysCount: number | null;
  /** From `assessments.length` — null when zero. */
  assessmentsCount: number | null;
  resolvedUnits: ResolvedUnits;
  t: (key: string, options?: Record<string, unknown>) => string;
}): EvolutionProgressTickerItem[] {
  const items: EvolutionProgressTickerItem[] = [];

  if (weightDeltaKg != null) {
    const unit = weightUnit(resolvedUnits);
    const magnitude = Math.abs(weightFromKg(weightDeltaKg, resolvedUnits)).toFixed(1);
    items.push({
      label: t('progress.ticker.weightSince'),
      value: `${weightDeltaKg >= 0 ? '+' : '−'}${magnitude} ${unit}`,
    });
  }

  if (lastAssessmentMeasuredAt) {
    const days = Math.max(0, Math.floor((Date.now() - lastAssessmentMeasuredAt.getTime()) / MS_PER_DAY));
    const value = days === 0
      ? t('progress.loads.ago.today')
      : days < 7
        ? t('progress.loads.ago.days', { count: days })
        : days < 28
          ? t('progress.loads.ago.weeks', { count: Math.floor(days / 7) })
          : t('progress.loads.ago.months', { count: Math.floor(days / 30) });
    items.push({ label: t('progress.ticker.lastAssessment'), value });
  }

  if (recordsLast90DaysCount != null) {
    items.push({ label: t('progress.ticker.records90d'), value: String(recordsLast90DaysCount) });
  }

  if (assessmentsCount != null) {
    items.push({ label: t('progress.ticker.assessmentsLogged'), value: String(assessmentsCount) });
  }

  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/fitness/evolutionProgressTickerItems.ts src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts
git commit -m "Adiciona builder de conteúdo do ticker de evolução" -- src/components/fitness/evolutionProgressTickerItems.ts src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts
```

---

### Task 2: Ticker component — `EvolutionProgressTicker.tsx`

**Files:**
- Create: `src/components/fitness/EvolutionProgressTicker.tsx`
- Test: `src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts`
- Modify: `src/theme/__tests__/sharedComponentsTheme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/fitness/EvolutionProgressTicker.tsx', 'utf8');

describe('EvolutionProgressTicker', () => {
  it('renders nothing when there are no items — never an empty bordered band', () => {
    expect(source).toContain('if (items.length === 0) return null');
  });

  it('matches the existing tickers\' hairline-border/marquee visual contract', () => {
    expect(source).toContain('borderTopWidth: 1');
    expect(source).toContain('borderBottomWidth: 1');
    expect(source).toContain('theme.colors.settingsGroupBorder');
    expect(source).toContain('LOOP_DURATION_MS = 18000');
    expect(source).toContain('ITEM_GAP = 36');
    expect(source).toContain('useIsScreenActive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'src/components/fitness/EvolutionProgressTicker.tsx'`

- [ ] **Step 3: Write the component**

Create `src/components/fitness/EvolutionProgressTicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useIsScreenActive } from '../../state/ScreenActivity';
import type { EvolutionProgressTickerItem } from './evolutionProgressTickerItems';

const LOOP_DURATION_MS = 18000;
const ITEM_GAP = 36;

/**
 * Evolução's own compact info band — same visual contract as
 * `EvolutionTicker` (Treino/Home) and Dieta's `NutritionTicker`: hairline
 * border, infinite marquee, label (faint)/value (accent) pairs. Not a
 * shared import — each screen's ticker is built from that screen's own
 * real data, by established convention (see `EvolutionTicker.tsx`'s own
 * doc comment).
 */
export function EvolutionProgressTicker({ items }: { items: EvolutionProgressTickerItem[] }) {
  const { theme } = useTheme();
  if (items.length === 0) return null;

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.settingsGroupBorder,
        paddingVertical: 8,
        overflow: 'hidden',
      }}
    >
      <TickerMarquee items={items} />
    </View>
  );
}

function TickerMarquee({ items }: { items: EvolutionProgressTickerItem[] }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  // Evolução is kept alive while inactive, same as Home/Treino — without
  // this guard the native-driven loop would keep running forever on an
  // invisible screen whenever another tab is active.
  const isActive = useIsScreenActive();

  useEffect(() => {
    if (width === 0 || !isActive) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -width,
        duration: LOOP_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [width, x, isActive]);

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width) : undefined}
      style={{ flexDirection: 'row', gap: ITEM_GAP, paddingRight: ITEM_GAP }}
    >
      {items.map(({ label, value }, i) => (
        <Text
          key={i}
          style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, color: theme.colors.textFaint }}
        >
          {label.toUpperCase()}{' '}
          <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.monoBold }}>
            {value.toUpperCase()}
          </Text>
        </Text>
      ))}
    </View>
  );

  return (
    <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: x }], paddingLeft: 22 }}>
      {row((w) => setWidth(w))}
      {row()}
    </Animated.View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Register the component in the shared theme-coverage test**

In `src/theme/__tests__/sharedComponentsTheme.test.ts`, add a line right after `'src/components/fitness/ExerciseEvolutionDetail.tsx',`:

```ts
  'src/components/fitness/ExerciseEvolutionDetail.tsx',
  'src/components/fitness/EvolutionProgressTicker.tsx',
```

- [ ] **Step 6: Run that test too**

Run: `npx vitest run src/theme/__tests__/sharedComponentsTheme.test.ts`
Expected: the new `EvolutionProgressTicker.tsx` row of the `it.each(PHASE_3_THEME_AWARE_AREAS)` suite passes (it calls `useTheme` and imports no static `colors`/`fonts` from `theme/tokens`). Ignore any unrelated pre-existing failure elsewhere in this file if one is already present before this change — not in scope here.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/components/fitness/EvolutionProgressTicker.tsx src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts src/theme/__tests__/sharedComponentsTheme.test.ts
git commit -m "Adiciona EvolutionProgressTicker, faixa de evolução" -- src/components/fitness/EvolutionProgressTicker.tsx src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts src/theme/__tests__/sharedComponentsTheme.test.ts
```

---

### Task 3: i18n — new ticker copy, drop the unused eyebrow key

**Files:**
- Modify: `src/i18n/resources/pt-BR/home.json`
- Modify: `src/i18n/resources/en/home.json`
- Modify: `src/i18n/resources/es/home.json`
- Modify: `src/i18n/__tests__/progressConsistency.test.ts`

- [ ] **Step 1: Update the test first (red)**

In `src/i18n/__tests__/progressConsistency.test.ts`, replace the `'ships complete copy in every supported language'` test body:

```ts
  it('ships complete copy in every supported language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(Object.values(resource.progress.tabs).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.body.metrics).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.body.empty).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.loads.empty).every(Boolean)).toBe(true);
      expect(resource.progress.body.measuredAt).toContain('{{date}}');

      // The header no longer has a separate static eyebrow line — it now
      // shows today's date, same as Treino/Dieta/Home — and gained its own
      // ticker copy instead.
      expect((resource.progress.header as { eyebrow?: string }).eyebrow).toBeUndefined();
      expect(Object.values(resource.progress.ticker).every(Boolean)).toBe(true);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/i18n/__tests__/progressConsistency.test.ts`
Expected: FAIL — `resource.progress.ticker` is `undefined` (`Cannot convert undefined or null to object` from `Object.values`), and `resource.progress.header.eyebrow` is still `"Seu progresso"`/`"Your progress"`/`"Tu progreso"` (not `undefined`)

- [ ] **Step 3: Edit `pt-BR/home.json`**

Change:
```json
    "header": {
      "eyebrow": "Seu progresso",
      "title": "Evolução"
    },
    "tabs": {
```
to:
```json
    "header": {
      "title": "Evolução"
    },
    "ticker": {
      "weightSince": "Peso",
      "lastAssessment": "Última avaliação",
      "records90d": "Recordes (90d)",
      "assessmentsLogged": "Avaliações"
    },
    "tabs": {
```

- [ ] **Step 4: Edit `en/home.json`**

Change:
```json
    "header": {
      "eyebrow": "Your progress",
      "title": "Evolution"
    },
    "tabs": {
```
to:
```json
    "header": {
      "title": "Evolution"
    },
    "ticker": {
      "weightSince": "Weight",
      "lastAssessment": "Last assessment",
      "records90d": "Records (90d)",
      "assessmentsLogged": "Assessments"
    },
    "tabs": {
```

- [ ] **Step 5: Edit `es/home.json`**

Change:
```json
    "header": {
      "eyebrow": "Tu progreso",
      "title": "Evolución"
    },
    "tabs": {
```
to:
```json
    "header": {
      "title": "Evolución"
    },
    "ticker": {
      "weightSince": "Peso",
      "lastAssessment": "Última evaluación",
      "records90d": "Récords (90d)",
      "assessmentsLogged": "Evaluaciones"
    },
    "tabs": {
```

- [ ] **Step 6: Run the test again**

Run: `npx vitest run src/i18n/__tests__/progressConsistency.test.ts`
Expected: PASS (all tests in this file)

- [ ] **Step 7: Commit**

```bash
git add src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json src/i18n/__tests__/progressConsistency.test.ts
git commit -m "Adiciona copy do ticker de evolução e remove o eyebrow fixo não usado" -- src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json src/i18n/__tests__/progressConsistency.test.ts
```

---

### Task 4: Wire the new header + ticker into `ProgressScreen.tsx`

**Files:**
- Modify: `src/screens/ProgressScreen.tsx`
- Test: `src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

describe('ProgressScreen shared header + ticker', () => {
  it('uses the exact same header geometry as Treino/Dieta/Home', () => {
    expect(screen).toContain("paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between'");
    expect(screen).toContain("t('meta.todayLine'");
    expect(screen).toContain('<ProfileAvatar');
    expect(screen).toContain("{t('progress.header.title')}.");
  });

  it('feeds the avatar and date line from data the screen already has access to', () => {
    expect(screen).toContain('const { user, questionnaire, profile } = useAuth()');
    expect(screen).toContain('const headerDisplayName = profile?.profile.name || user?.displayName');
  });

  it('builds and renders the evolution ticker from already-loaded data, no new hooks', () => {
    expect(screen).toContain("from '../state/UnitsContext'");
    expect(screen).toContain('buildEvolutionProgressTickerItems({');
    expect(screen).toContain('<EvolutionProgressTicker items={evolutionTickerItems} />');
  });

  it('keeps the single shared panelHeader (header + ticker + selector) handed to all three tabs', () => {
    expect(screen).not.toContain('const title = (');
    expect(screen).toContain('<ProgressPhotosScreen pageHeader={panelHeader} />');
    expect(screen).toContain('{panelHeader}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts`
Expected: FAIL — none of the new strings exist yet

- [ ] **Step 3: Update imports**

Change (`ProgressScreen.tsx:1-27`):
```ts
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { ProgressPhotosScreen } from './ProgressPhotosScreen';
import { BodyEvolutionView } from '../components/fitness/BodyEvolutionView';
import { LoadsEvolutionView } from '../components/fitness/LoadsEvolutionView';
import { ExerciseEvolutionDetail } from '../components/fitness/ExerciseEvolutionDetail';
import { Display, Slash } from '../components/ui/Display';
import { motion, radii, sizes, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useAssessments } from '../hooks/useAssessments';
import { useHealthWeightSamples } from '../hooks/useHealthWeightSamples';
import { useLoadProgressState } from '../loadProgress/LoadProgressContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';
```
to:
```ts
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { ProgressPhotosScreen } from './ProgressPhotosScreen';
import { BodyEvolutionView } from '../components/fitness/BodyEvolutionView';
import { LoadsEvolutionView } from '../components/fitness/LoadsEvolutionView';
import { ExerciseEvolutionDetail } from '../components/fitness/ExerciseEvolutionDetail';
import { EvolutionProgressTicker } from '../components/fitness/EvolutionProgressTicker';
import { buildEvolutionProgressTickerItems } from '../components/fitness/evolutionProgressTickerItems';
import { Display, MonoLabel } from '../components/ui/Display';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { motion, radii, sizes, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useAssessments } from '../hooks/useAssessments';
import { useHealthWeightSamples } from '../hooks/useHealthWeightSamples';
import { useLoadProgressState } from '../loadProgress/LoadProgressContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import { useUnits } from '../state/UnitsContext';
```
(`Slash` is dropped — nothing else in this file uses it once the header is rewritten below.)

- [ ] **Step 4: Add `i18n`, `profile` and `resolvedUnits`**

Change:
```ts
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const { user, questionnaire } = useAuth();
```
to:
```ts
  const { t, i18n } = useTranslation('home');
  const { theme } = useTheme();
  const { user, questionnaire, profile } = useAuth();
  const { resolvedUnits } = useUnits();
```

- [ ] **Step 5: Build the ticker items**

Right after the `useLoadProgressState()` destructure (after the closing `} = useLoadProgressState();` and before `const selectedExercise = ...`), add:

```ts
  const evolutionTickerItems = useMemo(
    () => buildEvolutionProgressTickerItems({
      weightDeltaKg: evolutionSincePrevious?.weightDelta ?? null,
      lastAssessmentMeasuredAt: latest ? latest.measuredAt.toDate() : null,
      recordsLast90DaysCount: loadExercises.length > 0 ? recordsLast90Days.length : null,
      assessmentsCount: assessments.length > 0 ? assessments.length : null,
      resolvedUnits,
      t,
    }),
    [evolutionSincePrevious, latest, loadExercises.length, recordsLast90Days, assessments.length, resolvedUnits, t],
  );
```

- [ ] **Step 6: Replace `title` + `panelHeader` with the new combined block**

Change:
```tsx
  const title = (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[3], paddingBottom: spacing[5] }}>
      <Slash style={{ marginBottom: spacing[2.5] }}>
        {t('progress.header.eyebrow').toUpperCase()}
      </Slash>
      <Display size={40}>{t('progress.header.title').toUpperCase()}</Display>
    </View>
  );

  /** Shared header for all three Evolution tabs: eyebrow/title plus the blue pill selector. */
  const panelHeader = (
    <View>
      {title}
      <PillTabs
        tabs={tabs}
        view={view}
        previousView={previousViewRef.current}
        onSelect={(next) => { setView(next); setSelectedExerciseId(null); }}
        // Zero when the active panel is a locked preview: that gap would
        // otherwise leave a clean, un-blurred strip between the selector
        // and the blurred content. The blur must start right below it.
        style={{ marginBottom: isCurrentViewLocked ? 0 : spacing[5] }}
      />
    </View>
  );
```
to:
```tsx
  // Same date-line eyebrow + avatar Treino/Dieta/Home already use — only
  // the title text differs ("Evolução." instead of "Treino."/"Dieta.").
  const headerDisplayName = profile?.profile.name || user?.displayName || '';
  const headerDateLabel = t('meta.todayLine', {
    weekday: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
    day: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { day: '2-digit', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
    month: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
  }).toUpperCase();

  /** Shared by all three Evolution tabs: header, evolution ticker, and the blue pill selector. */
  const panelHeader = (
    <View>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <MonoLabel color={theme.colors.textFaint}>{headerDateLabel}</MonoLabel>
          <Display size={34} style={{ marginTop: 8 }}>{t('progress.header.title')}.</Display>
        </View>
        <ProfileAvatar
          displayName={headerDisplayName}
          photoURL={profile?.profile.photoURL}
          photoVersion={profile?.profile.photoVersion}
          size={46}
        />
      </View>

      <View style={{ marginTop: 4, marginBottom: 18 }}>
        <EvolutionProgressTicker items={evolutionTickerItems} />
      </View>

      <PillTabs
        tabs={tabs}
        view={view}
        previousView={previousViewRef.current}
        onSelect={(next) => { setView(next); setSelectedExerciseId(null); }}
        // Zero when the active panel is a locked preview: that gap would
        // otherwise leave a clean, un-blurred strip between the selector
        // and the blurred content. The blur must start right below it.
        style={{ marginBottom: isCurrentViewLocked ? 0 : spacing[5] }}
      />
    </View>
  );
```

- [ ] **Step 7: Run the new test**

Run: `npx vitest run src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: Run the full set of `ProgressScreen`-adjacent tests to confirm no regression**

Run:
```bash
npx vitest run \
  src/i18n/__tests__/progressConsistency.test.ts \
  src/screens/__tests__/progressScreenOnStartWorkout.test.ts \
  src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts \
  src/screens/__tests__/progressTabIndicatorMountPosition.test.ts \
  src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts
```
Expected: all PASS. None of these files' asserted substrings (`view === 'photos' ? (`, `scrollEnabled={!isCurrentViewLocked}`, `onSelectExercise={setSelectedExerciseId}`, `previousViewRef`, `onStartWorkout={onStartWorkout}`, etc.) were touched by this task's edits.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (in particular: confirms `GUTTER`/`spacing` are still used elsewhere so no new unused-import issue, `Slash` is no longer imported anywhere it'd be flagged missing, and `Intl`/`Date` usage type-checks with `i18n.resolvedLanguage`)

- [ ] **Step 10: Commit**

```bash
git add src/screens/ProgressScreen.tsx src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts
git commit -m "Aplica o header e o ticker compartilhados na tela de Evolução" -- src/screens/ProgressScreen.tsx src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run every test file created or touched by this plan**

Run:
```bash
npx vitest run \
  src/components/fitness/__tests__/evolutionProgressTickerItems.test.ts \
  src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts \
  src/theme/__tests__/sharedComponentsTheme.test.ts \
  src/i18n/__tests__/progressConsistency.test.ts \
  src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts \
  src/screens/__tests__/progressScreenOnStartWorkout.test.ts \
  src/screens/__tests__/progressScreenExerciseDetailNavigation.test.ts \
  src/screens/__tests__/progressTabIndicatorMountPosition.test.ts
```
Expected: all PASS (ignore any single pre-existing, unrelated failure already present in `sharedComponentsTheme.test.ts` before this plan started — confirm by checking it's not one of the rows this plan added).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Manual walkthrough (if a device/simulator is available)**

Open Evolução. Confirm:
- Header shows today's date (e.g. "QUA · 16 OUT") on the left, "EVOLUÇÃO." as the title below it, and the real profile photo/initials avatar on the right — same spacing/size as Treino and Dieta's headers.
- Directly below, a scrolling ticker appears (if the account has at least one assessment or any load history) showing whichever of the 4 items have real data, same border/animation/typography as Treino's or Home's ticker.
- The blue pill selector still works exactly as before (Corpo/Cargas/Fotos, including the Fotos-remount indicator fix from the previous task).
- On an account with zero assessments and zero load history, the ticker area shows nothing (no empty bordered strip) and everything else (header, selector, locked previews) still renders normally.

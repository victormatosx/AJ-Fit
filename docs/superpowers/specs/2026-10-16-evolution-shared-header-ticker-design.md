# Evolução — Shared Header + Evolution Ticker

## Goal

The Treino, Dieta and Home screens already share one header geometry (date eyebrow + screen title + profile avatar) and each has its own scrolling "ticker" band directly below it (same hairline-border/marquee visual contract, different content per screen — there is no single shared component, each screen builds its own, by established convention: "build your own version rather than reshape a shared one"). The Evolução screen currently has neither: a bespoke static-text header ("Seu progresso" / "Evolução") and no ticker at all.

This task gives Evolução the exact same header geometry (only the title text differs: "Evolução." instead of "Treino."/"Dieta."), and a new ticker of its own carrying evolution-specific information, built from data the screen already loads (no new hooks, no new Firestore reads). The existing blue pill tab selector (Corpo/Cargas/Fotos) is untouched in behavior — it just moves to sit below the new ticker instead of below the old static header, and (as already established by the prior fix) stays shared identically across all three tabs, including Fotos.

## Confirmed ticker content (4 items, each independently omitted when its backing data doesn't exist yet — never a fabricated placeholder)

1. **Peso** — signed weight delta since the previous assessment (`evolutionSincePrevious.weightDelta`, already computed by `useAssessments`). Omitted when there's no previous assessment to compare against (fewer than 2 assessments).
2. **Última avaliação** — relative time since the latest assessment's `measuredAt` ("hoje" / "há 3 dias" / "há 2 semanas" / "há 3 meses"). Omitted when there's no assessment at all.
3. **Recordes (90d)** — `recordsLast90Days.length`. Omitted (not shown as `0`) when the account has no load history at all (`loadExercises.length === 0`) — a real `0` is shown once there IS load history but no PR in the window, since that's a true fact, not a placeholder.
4. **Avaliações** — total count of assessments logged (`assessments.length`). Omitted when zero.

If all four are omitted (brand-new account, nothing logged anywhere yet), the whole ticker renders nothing (same `HIDDEN` behavior as the existing `EvolutionTicker` on Treino/Home) — no border, no empty band.

## Architecture

### 1. Header — rebuilt inline in `ProgressScreen.tsx`, matching `TreinoScreen.tsx`/`NutritionHomeScreen.tsx`/`HomeScreen.tsx` exactly

Current (to be replaced):
```tsx
const title = (
  <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[3], paddingBottom: spacing[5] }}>
    <Slash style={{ marginBottom: spacing[2.5] }}>
      {t('progress.header.eyebrow').toUpperCase()}
    </Slash>
    <Display size={40}>{t('progress.header.title').toUpperCase()}</Display>
  </View>
);
```

New geometry (copied verbatim from `TreinoScreen.tsx:289-300`, only the title key/text differs):
```tsx
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
```

`headerDateLabel` and `headerDisplayName` computed exactly like `TreinoScreen.tsx:77` and `:131-135`:
```tsx
const headerDisplayName = profile?.profile.name || user?.displayName || '';
const headerDateLabel = t('meta.todayLine', {
  weekday: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
  day: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { day: '2-digit', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
  month: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
}).toUpperCase();
```
`meta.todayLine` already exists in `home.json` (the same namespace `ProgressScreen` already uses) — no new key needed for this part. `todayLocalDate` is already destructured from `useLoadProgressState()`; `t`/`i18n` just need `i18n` added to the existing `useTranslation('home')` destructure (currently only `{ t }`). `profile` needs adding to the existing `useAuth()` destructure (currently `{ user, questionnaire }` — `profile: UserProfile | null` is already exposed by that same hook, confirmed in `src/state/AuthContext.tsx:85`).

`progress.header.title` keeps its current value ("Evolução"/"Evolution"/"Evolución") — only the trailing `.` is added in JSX (matching `Treino.`/exactly how `Display`'s own `textTransform: 'uppercase'` style already handles the casing, so no `.toUpperCase()` call is needed at this call site, same as Treino's). `progress.header.eyebrow` becomes unused — delete it from all three `home.json` locale files (pt-BR/en/es).

Imports: drop `Slash` (no longer used anywhere in this file), add `MonoLabel` (from the same `'../components/ui/Display'` import `Display` already comes from) and `ProfileAvatar` (from `'../components/ui/ProfileAvatar'`).

### 2. New ticker — `src/components/fitness/EvolutionProgressTicker.tsx` + `src/components/fitness/evolutionProgressTickerItems.ts`

Same split as the existing `EvolutionTicker.tsx` / `tickerItems.ts` pair, and same visual contract (hairline top/bottom border in `theme.colors.settingsGroupBorder`, `paddingVertical: 8`, two-copy infinite marquee at `LOOP_DURATION_MS = 18000` driven by a native `Animated.Value`, gated by `useIsScreenActive()` so it stops animating while the Evolução tab isn't the active one, `ITEM_GAP = 36`, left gutter `22`, label in faint mono 10/letterSpacing 2, value in bold accent, both uppercased). Simpler than `EvolutionTicker` because Evolução's ticker only ever has one presentation mode (a marquee, or nothing) — no `ACTION`/`STATIC` modes, since there's no "take action" CTA concept here and nothing is ever "loading" independently of the screen's own loading states.

`evolutionProgressTickerItems.ts`:
```ts
import { weightFromKg, weightUnit } from '../../units/weightConversions';
import type { ResolvedUnits } from '../../types/units';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EvolutionProgressTickerItem {
  label: string;
  value: string;
}

export function buildEvolutionProgressTickerItems({
  weightDeltaKg,
  lastAssessmentMeasuredAt,
  recordsLast90DaysCount,
  assessmentsCount,
  resolvedUnits,
  t,
}: {
  weightDeltaKg: number | null;
  lastAssessmentMeasuredAt: Date | null;
  recordsLast90DaysCount: number | null;
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
(The signed delta is computed via `weightFromKg` + manual sign/formatting — the same pattern `BodyEvolutionView`'s `Delta` component already uses for "signed weight change" — rather than `formatWeightFromKg`, which is built for an absolute, unsigned reading and isn't needed here.)

The relative-time phrasing reuses the **existing** `progress.loads.ago.*` i18n keys (today/days/weeks/months — already defined for `LoadsEvolutionView`'s "há 3 dias" record ages). The text is generic relative-time phrasing, not loads-specific despite its key path, so reusing it avoids duplicating the same three-language plural set a third time. No new i18n needed for this piece.

`EvolutionProgressTicker.tsx`:
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
 * `EvolutionTicker` (Treino/Home) and `NutritionTicker` (Dieta): hairline
 * border, infinite marquee, label (faint)/value (accent) pairs. Not a shared
 * import — each screen's ticker is built from that screen's own real data,
 * by established convention (see `EvolutionTicker.tsx`'s own doc comment).
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
(This is `EvolutionTicker.tsx`'s `TickerMarquee` copied verbatim, minus the `onLayout`-driven width state's dependency on an imported `TickerItem` type — using the new local `EvolutionProgressTickerItem` type instead.)

### 3. `ProgressScreen.tsx` wiring

- `useAuth()` destructure gains `profile`.
- `useTranslation('home')` destructure gains `i18n`.
- New `const { resolvedUnits } = useUnits();` (import from `'../state/UnitsContext'` — not currently imported in this file).
- New `const evolutionTickerItems = useMemo(() => buildEvolutionProgressTickerItems({...}), [...])`, placed after the `useAssessments`/`useLoadProgressState` destructures (needs `evolutionSincePrevious`, `latest`, `assessments.length`, `loadExercises.length`, `recordsLast90Days`, `resolvedUnits`, `t`):
  ```tsx
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
- The old standalone `title` constant is removed; `panelHeader` becomes the single block containing header + ticker + `PillTabs`, in that order:
  ```tsx
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
        style={{ marginBottom: isCurrentViewLocked ? 0 : spacing[5] }}
      />
    </View>
  );
  ```
  This single `panelHeader` is still handed to both render branches exactly as today (`<ProgressPhotosScreen pageHeader={panelHeader} />` and inline above `PanelFade` in the `ScrollView` branch) — Fotos gets the new header/ticker/selector automatically, with zero Photos-specific code touched, continuing the pattern established by the previous fix.

### 4. i18n changes (pt-BR/en/es `home.json`)

Remove (now unused):
```json
"header": {
  "eyebrow": "Seu progresso",
  "title": "Evolução"
}
```
→
```json
"header": {
  "title": "Evolução"
}
```
(analogous "Your progress"/"Tu progreso" removed in en/es; `title` keeps its existing value in all three).

Add, alongside the existing `loads`/`body`/`tabs` keys under `progress`:
```json
"ticker": {
  "weightSince": "Peso",
  "lastAssessment": "Última avaliação",
  "records90d": "Recordes (90d)",
  "assessmentsLogged": "Avaliações"
}
```
EN: `"weightSince": "Weight", "lastAssessment": "Last assessment", "records90d": "Records (90d)", "assessmentsLogged": "Assessments"`.
ES: `"weightSince": "Peso", "lastAssessment": "Última evaluación", "records90d": "Récords (90d)", "assessmentsLogged": "Evaluaciones"`.

## Testing

Following this codebase's established convention for these presentational components (source-string structural tests, not full RTL rendering):
- New `src/components/fitness/__tests__/evolutionProgressTickerStructure.test.ts`: asserts the hairline border/marquee contract exists (`borderTopWidth: 1`, `LOOP_DURATION_MS`, `useIsScreenActive`), and that the component returns `null` when given an empty items array (`if (items.length === 0) return null`).
- New `src/screens/__tests__/progressScreenHeaderTickerWiring.test.ts`: asserts `ProgressScreen.tsx` contains the new header geometry (`paddingTop: 50 - 10`, `<ProfileAvatar`, `t('meta.todayLine'`), the ticker wiring (`<EvolutionProgressTicker items={evolutionTickerItems} />`), and that `panelHeader` (not a separate `title`) is what's handed to both `<ProgressPhotosScreen pageHeader={...} />` and the `ScrollView` branch.
- Update `src/i18n/__tests__/progressConsistency.test.ts`: the existing `'ships complete copy in every supported language'` test already loops `[ptBR, en, es]` checking `resource.progress.*` blocks — extend it to also assert `Object.values(resource.progress.ticker).every(Boolean)` for all three, and that `resource.progress.header.eyebrow` is `undefined` (confirming the dead key was actually removed, not just left stale).
- Run the full existing `ProgressScreen`-adjacent suite afterward (`progressConsistency`, `progressScreenOnStartWorkout`, `progressScreenExerciseDetailNavigation`, `progressTabIndicatorMountPosition`, `sharedComponentsTheme`) to confirm no regression — none of their asserted substrings (`view === 'photos' ? (`, `scrollEnabled={!isCurrentViewLocked}`, `onSelectExercise={setSelectedExerciseId}`, `previousViewRef`, etc.) are touched by this change.
- Add `EvolutionProgressTicker.tsx` to `sharedComponentsTheme.test.ts`'s `PHASE_3_THEME_AWARE_AREAS` list, same as `ExerciseEvolutionDetail.tsx` was added for the previous feature.

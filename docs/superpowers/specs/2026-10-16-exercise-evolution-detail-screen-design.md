# Exercise Evolution — Dedicated Detail Screen

## Goal

In the Cargas (loads) panel of the Evolution screen, tapping an exercise — from "Recordes recentes" or from the "Evolução por exercício" search/list — currently swaps an inline block further down the same scrolling screen (current load, delta, chart, period selector). The user wants that block to open as its own full screen instead, for easier visualization. The chart/metrics content itself stays exactly as it is today — only *where* it's shown changes.

Both existing entry points (records list, exercise search/list) navigate to the new screen. No new content is added to it: same hero number, same delta line, same `EvolutionAreaChart`, same 30/60/90/365 period selector. The only screen chrome is a back button — no title bar, since the exercise name already renders inside the moved block.

Out of scope: the muscle-group section (map + per-muscle list) above the records — that's a different selection mechanism (`selectedMuscle`) and is untouched.

## Architecture

No real router exists in this app — secondary screens are either `AppShell`-level overlays (`PersistentScreen`, for things like Assessment/Settings) or a plain conditional swap local to a screen (e.g. `ProgressScreen` already swaps its whole body for `ProgressPhotosScreen` when `view === 'photos'`). This feature fits the second pattern: `ProgressScreen` already owns `loadExercises`/`todayLocalDate` via `useLoadProgressState()`, so it can own the new screen's visibility and data lookup directly — no `AppShell` wiring needed.

### 1. `LoadsEvolutionView.tsx` changes

Remove entirely:
- State: `selectedId`, `period` (the local one driving the inline block — the muscle section's `selectedMuscle` stays).
- The `useEffect` that auto-selects the first exercise on mount/list-change (lines ~231-234).
- Derived values that only fed the inline block: `selected`, `periodHistory`, `first`, `latest`, `deltaKg`.
- The entire `{selected ? (...) : null}` JSX block (hero load, delta text, chart, period selector) at the bottom of `panel`.
- The `isSelected`/highlight styling on record rows and list rows that referenced `selectedId` (rows no longer carry a "currently previewed" visual state, since tapping now navigates away immediately).

Add:
- New required prop `onSelectExercise: (exerciseId: string) => void`.
- Records row `onPress` (currently `setSelectedId(record.exerciseId)`) → `onSelectExercise(record.exerciseId)`.
- Exercise list row `onPress` (currently `setSelectedId(exercise.exerciseId); setQuery('')`) → `onSelectExercise(exercise.exerciseId); setQuery('')`.

Everything else (muscle map/section, records list, search box, sort chips, exercise list) stays as-is — this view still renders all of it; only the trailing detail block is gone.

### 2. New component: `src/components/fitness/ExerciseEvolutionDetail.tsx`

```ts
interface Props {
  exercise: ExerciseLoadProgress;
  todayLocalDate: LocalDate;
  onBack: () => void;
}
```

Contents: exactly the removed block from `LoadsEvolutionView`, moved verbatim —
- Local `period` state (`useState<LoadProgressPeriod>(90)`).
- `periodHistory = loadHistoryForPeriod(exercise.history, period, todayLocalDate)`, `first`/`latest`/`deltaKg` derived the same way.
- Same `useTranslation(['home', 'common'])` (the extra `common` namespace is only for the back button's label below), `useUnits()`, `exerciseDisplayName` (via `i18n.language` → `catalogLocale`), `dateFormatter`.
- Exercise name title, current-load hero (`Display size={52}` + unit), delta line, `EvolutionAreaChart` (when `periodHistory.length > 1`, else the existing "no data for period" empty state), and the segmented period selector — identical markup to what's being removed.

New chrome: a back button at the top, matching `AssessmentScreen.tsx`'s exact pattern — `Pressable` 44×44, `radii.control`, `theme.colors.surfaceRaised` background, `theme.colors.border` border, centered `Icon name="arrow-left" size={17}`, `accessibilityLabel={t('common:actions.back')}` (existing shared key, same cross-namespace call `AssessmentScreen.tsx` already uses — no new i18n strings needed). No title/header row next to it — just the button, left-aligned, above the hero.

Wrapped in a `ScrollView` with the same `GUTTER`/`spacing` conventions as the rest of the panel (no new `SafeAreaView` — it renders inside `ProgressScreen`'s existing one).

### 3. `ProgressScreen.tsx` changes

- New state: `const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)`.
- Look up the exercise: `const selectedExercise = selectedExerciseId ? loadExercises.find(e => e.exerciseId === selectedExerciseId) ?? null : null`.
- Render: when `selectedExercise` is non-null, render `<ExerciseEvolutionDetail exercise={selectedExercise} todayLocalDate={todayLocalDate} onBack={() => setSelectedExerciseId(null)} />` **instead of** the tab pill header + `ScrollView` (the whole `view === 'photos' ? ... : (<ScrollView>...)` branch gets a third case, or an early return above it — whichever reads cleaner once written). Tabs are hidden while the detail screen is open, same as Photos hides the pill row in favor of its own header.
- Pass `onSelectExercise={setSelectedExerciseId}` to `LoadsEvolutionView`.
- Switching tabs away from Cargas (or back to it) while a detail screen is open: reset `selectedExerciseId` to `null` on tab change, so returning to Cargas always lands back on the list, never stuck mid-detail on the wrong tab. (Simplest correct behavior; nothing in the request asks for the detail screen to persist across tab switches.)

### Edge case

If `selectedExerciseId` no longer matches anything in `loadExercises` (e.g. a focus-triggered refresh changed the set — unlikely but possible), `selectedExercise` resolves to `null` and the branch above simply falls through to the normal tab content, which self-heals the state without needing an extra effect.

## Testing

- Structural test (mirrors existing `bodyMeasurementsEvolution.test.ts`/`bodyMuscleMapArchitecture.test.ts` style — source-string assertions, not full RTL rendering, matching this codebase's convention for these presentational components): confirm `LoadsEvolutionView` no longer imports/uses `selectedId` for the inline block, confirm both the records row and the exercise list row call `onSelectExercise`, confirm `ExerciseEvolutionDetail` renders the back button and the period selector.
- No new demo-data concerns: `onSelectExercise` is wired the same way regardless of real vs. demo data, but demo content stays behind `pointerEvents="none"` in the locked preview, so it's already unreachable — no test needed for that path beyond what already exists.

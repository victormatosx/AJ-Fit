# Evolução — Blurred Preview Empty States

## Goal

When the user has no physical assessments (Corpo tab) or no exercise load history (Cargas tab), show a blurred, reduced-opacity preview of the *real* component tree — fed with local, non-persisted demo data — instead of a plain "no data" block. A centered, fully-opaque message (lock icon, title, description, CTA) sits on top, directing the user to the action that unlocks the real view. Each tab locks independently, based only on its own data.

Loading and error states are untouched and take priority over this new locked-preview state, exactly as they do today.

Out of scope: the Photos tab, which already has its own locked-state pattern (`PhotoVaultLockedState`) for a different concern (vault auth).

## Existing convention being superseded

`ProgressScreen.tsx` currently has an explicit comment: "Corpo shows the user's own assessments and nothing else... never a fabricated history." This task deliberately changes that — the user has explicitly requested a demonstrative preview. The comment will be updated to describe the new behavior instead of removed silently.

## Architecture

### 1. `EvolutionLockedPreview` (new shared component)

`src/components/fitness/EvolutionLockedPreview.tsx`

A presentational wrapper, used by both `BodyEvolutionView` and `LoadsEvolutionView`:

```ts
interface Props {
  title: string;
  description: string;
  ctaLabel?: string;
  onPress?: () => void;
  children: React.ReactNode; // the real view tree, fed with demo data
}
```

Rendering, following the same technique already used by `PhotoVaultLockedState.tsx` (`expo-blur`'s `BlurTargetView`/`BlurView`, same Android `blurMethod="dimezisBlurViewSdk31Plus"` workaround):

- `children` are rendered inside a `BlurTargetView`, wrapped in a `View` with `opacity: 0.45`, `pointerEvents="none"` (so none of the demo content's interactive elements — search box, period tabs, exercise rows — can be tapped), and `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"` (so a screen reader never reads fabricated data as real).
- A `BlurView` (`StyleSheet.absoluteFill`, `pointerEvents="none"`, static `intensity` — no animation needed here, unlike the photo vault's unlock transition) sits on top for the visual blur.
- A centered `View` (`StyleSheet.absoluteFill`, `pointerEvents="box-none"`) holds the message card: `Icon name="lock"`, title (`Display`), description (`Text`), and — when both `ctaLabel` and `onPress` are given — a `Pressable` CTA button, all at full opacity so the card itself is always legible and tappable regardless of the blur layer.
- The outer wrapper has no fixed height — it sizes to `children`'s natural height (same as the real filled view), so no large empty space is introduced and card sizes are unchanged, per the requirements.

### 2. Demo data modules (new, local-only, typed against real domain types)

- `src/components/fitness/demoAssessmentData.ts` — exports `DEMO_ASSESSMENTS: AssessmentView[]`: ~4 fabricated guided assessments, weekly cadence, weight/body-fat trending down, built with real `Timestamp.fromDate(...)` instances (so `.toDate()` works exactly like production data) but never written anywhere.
- `src/components/fitness/demoLoadProgressData.ts` — exports `DEMO_LOAD_EXERCISES: ExerciseLoadProgress[]` and `DEMO_LOAD_RECORDS: LoadPersonalRecord[]`: 3 real catalog exercise ids (`barbell-back-squat`, `conventional-deadlift`, `machine-flat-bench-press`) with a few weeks of ascending load history, and matching personal records.
- Both files are clearly commented as demo-only (`// Demonstrative data only — never persisted, never sent to any backend.`) and are imported *only* by `BodyEvolutionView`/`LoadsEvolutionView`, guarded behind the same "no real data" check that gates the whole locked branch, so they can never leak into a real-data render path.

### 3. `BodyEvolutionView.tsx` changes

Where today `if (!latest)` returns the plain empty block (lines 394-434): keep the loading/error early returns untouched above it, then replace that branch with:

```tsx
if (!latest) {
  return (
    <EvolutionLockedPreview
      title={t('progress.body.empty.title')}
      description={t('progress.body.empty.description')}
      ctaLabel={onOpenAssessment ? t('progress.body.empty.cta') : undefined}
      onPress={onOpenAssessment}
    >
      {/* same JSX tree as the filled-state return below, fed by DEMO_ASSESSMENTS */}
    </EvolutionLockedPreview>
  );
}
```

The simplest correct way to get "the same JSX tree" without duplicating the whole render body: restructure so the component computes `displayAssessments = assessments.length ? assessments : DEMO_ASSESSMENTS` and `displayLatest = latest ?? DEMO_ASSESSMENTS[0]`, renders the existing filled-state JSX unconditionally from those, and only the outer wrapper differs (`EvolutionLockedPreview` around it when `!latest`, a plain `View` when real data exists). This avoids a second, drifting copy of the chart/metrics markup.

The "ver avaliação completa" row at the bottom (lines 548-569) must **not** appear inside the locked preview (there is nothing real to open yet) — kept conditioned on real `latest`, not `displayLatest`.

### 4. `LoadsEvolutionView.tsx` changes

Same shape: where today `if (exercises.length === 0)` returns the plain empty block (lines 151-167), compute `displayExercises = exercises.length ? exercises : DEMO_LOAD_EXERCISES`, `displayRecords = exercises.length ? recordsLast90Days : DEMO_LOAD_RECORDS`, render the existing filled JSX from those, and wrap the whole thing in `EvolutionLockedPreview` only when `exercises.length === 0` (loading/error branches unaffected, checked before this).

New prop needed: `onStartWorkout?: () => void`, threaded through for the CTA (mirrors `onOpenAssessment`'s existing optionality).

### 5. Wiring `onStartWorkout` end to end

- `ProgressScreen.tsx`: accept a new optional `onStartWorkout?: () => void` prop, pass it to `LoadsEvolutionView`.
- `AppShell.tsx:2179`: change `<ProgressScreen onOpenAssessment={() => setShowAssessment(true)} />` to also pass `onStartWorkout={requestStartWorkout}` — the exact same single entry point already used elsewhere (e.g. `AppShell.tsx:1998`, `2061`) for "iniciar treino", with no wrapper needed since `requestStartWorkout` already handles tab switching internally.

### 6. i18n

Update copy in place for the existing keys (all three locales, `home.json`), since the new locked preview fully replaces the old plain empty block — no new parallel keys:

- `progress.body.empty.title` → "Desbloqueie sua evolução corporal"
- `progress.body.empty.description` → "Faça sua primeira avaliação física para acompanhar suas mudanças ao longo do tempo."
- `progress.body.empty.cta` → "Fazer avaliação" (unchanged)
- `progress.loads.empty.title` → "Sua evolução começa aqui"
- `progress.loads.empty.description` → "Registre as cargas dos seus exercícios para acompanhar sua força e seus recordes pessoais."
- New `progress.loads.empty.cta` → "Iniciar treino" (the key didn't exist before — Loads never had a CTA)
- `progress.loads.empty.hint` is removed outright (not just unused in code) in all three locale files — it has no other reader, and this codebase already treats orphaned i18n keys as something to delete (see `cbc5d0e Remove chave de i18n diff.replacements, orfa desde a Task 17`), not leave behind.

en/es get translated equivalents of the same copy; pt-BR gets the literal text above.

### 7. Theme / accessibility

- Blur tint: `theme.mode === 'light' ? 'light' : 'dark'`, same as `PhotoVaultLockedState`.
- Card background: `theme.colors.surfaceElevated` with `theme.colors.borderStrong` border (same vocabulary as the existing empty-state CTA button and `AssessmentActionCard`'s overlay).
- Icon: `Icon name="lock"` (already exists in `IconName`), matching the premium/locked vocabulary used elsewhere (`AssessmentActionCard.tsx:74`).
- Whole locked region gets a single `accessibilityLabel` (the title) on the outer wrapper, same pattern as `PhotoVaultLockedState.tsx:217`, so a screen reader announces the lock state once rather than wading through blurred decorative content.

## Testing

- `demoAssessmentData.test.ts` / `demoLoadProgressData.test.ts`: shape checks — ≥2 chronological points (satisfies `EvolutionAreaChart`'s `points.length < 2` guard), valid real `exerciseId`s, `Timestamp` instances with working `.toDate()`.
- `BodyEvolutionView.test.tsx` (extend existing or add): 0 assessments → locked preview renders with demo chart, CTA calls `onOpenAssessment`; 1+ assessments → real data, no locked preview (existing "singleEntry" sub-state behavior untouched); loading/error unaffected.
- `LoadsEvolutionView.test.tsx`: 0 exercises → locked preview + demo chart, CTA calls `onStartWorkout`; 1+ exercises → real data, no locked preview; loading/error unaffected.
- Manual QA in the simulator (`/run`): fresh account (both tabs locked independently), account with only assessments (Corpo real, Cargas locked), account with only load history (inverse), account with both (neither locked), light and dark mode.

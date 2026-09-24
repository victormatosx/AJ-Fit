# Home initial-load overlay — design

Date: 2026-09-22
Branch: `perf-consolidation`

## Problem

Today: global loading disappears → `AppShell`/`HomeScreen` mount → `Today`,
`Evolution`, week overview and frequency cards each finish loading at their
own pace → cards pop in and the layout shifts after the user is already
looking at the screen.

## Goal

The user should only ever see the Home screen once every section required
for its first viewport has reached a **final initial state** (success,
real error, or legitimately-not-applicable). Data fetching must keep
starting immediately on mount — the overlay only changes *when* Home is
revealed, never *when* its requests start.

## Non-goals

- No new full-screen loading UI — reuse `FullScreenLoading` exactly as it
  renders today (bare spinner, no message).
- No change to lifecycle/progression/pending/outstanding/schedule rules,
  recovery, `installActiveWorkoutProgram`, Functions, App Check, Firestore
  Rules, RevenueCat/SubscriptionContext/billing/entitlement.
- No timeouts or artificial delays anywhere in the gate.
- Not a general error-handling redesign — only closes the two "loading
  could hang forever" gaps found during the audit (below), because an
  overlay gate that can get stuck forever is unacceptable by definition.

## Architecture

### Where the gate lives

`AppShellContent` (`src/screens/AppShell.tsx`) already owns every raw
signal needed: `prescriptionLoading`, `schedule` (resolution + loading +
refreshError), `generatingWorkout`, `evolution.viewModel`,
`activitySnapshot`, `frequencyWindow`. A new pure hook,
`useHomeInitialReady`, composes them there — no new props threaded through
`HomeScreen`, no signals duplicated.

### First-bootstrap-per-identity, for free

`AppShell()` already wraps `AppShellContent` in
`<RestSessionProvider key={user?.uid ?? 'signed-out'}>`
(`AppShell.tsx:179`). Changing that key fully unmounts/remounts
`AppShellContent` on login/logout/account-switch. `useHomeInitialReady`'s
internal `useState(false)` therefore re-arms automatically on identity
change, and does **not** reset on tab switches, background/foreground, or
post-workout return — none of those remount `AppShellContent`. No new
bootstrap-tracking flag needed.

### Latch

`homeInitialReady` only ever flips `false → true`, never back. Evolution's
later silent background refresh, or any other post-reveal state change,
cannot reopen the overlay.

## The generalized "settled" concept

Every section in the gate must reach **settled** — success, real error, or
"does not apply to this user" — never only success. A signal that can only
become true on the happy path is a latent infinite-spinner bug, so each
section below was audited individually rather than assuming the existing
success-oriented booleans were sufficient.

| Section | Settled expression | Notes |
|---|---|---|
| Today (prescription + schedule + generation) | `!prescriptionLoading && !schedule.loading && !generatingWorkout && (todayReadyCondition \|\| schedule.refreshError !== null)` | `todayReadyCondition` is the exact boolean already driving `home_today_ready` (`HomeScreen.tsx:129-134`). **Gap found:** if `resolveTodaysSchedule` throws on the very first call after prescription resolves to `SUCCESS`, `scheduleResolution.status` stays pinned at the initial `PROGRAM_NOT_AVAILABLE` placeholder forever (`applyScheduleReloadOutcome` preserves the previous resolution on failure — `scheduleRefreshState.ts:23-33`), so the existing condition never fires. Adding `\|\| schedule.refreshError !== null` closes it without touching schedule rules — it only reads a field the hook already exposes. |
| Evolution | `evolutionViewModel.kind !== 'LOADING' && evolutionViewModel.kind !== 'SUMMARY_READY'` | Confirmed via the full `kind` union (`workoutEvolution/types.ts:45-72`: `LOADING \| UNAVAILABLE \| ERROR \| SUMMARY_READY \| PROGRESSING \| EVOLUTION_READY \| EVOLUTION_DEFERRED \| AUTO_ACTIVATION_NOTICE`) that this already settles on `ERROR` and on `UNAVAILABLE` (the legitimate "doesn't apply to this user" terminal). No hook change needed. The existing `home_evolution_ready` mark/condition (success-only, excludes `ERROR`) is untouched and keeps its current meaning everywhere else it's used. |
| Week overview (activitySnapshot) | `!activitySnapshot.loading` | `useWorkoutActivitySnapshot.ts` clears `loading` in a `finally`, and backfills empty `Set`s on first failure rather than leaving state uninitialized — already safe. Always applicable for a signed-in user; no "doesn't apply" case. |
| Frequency card | `!frequencyWindow.loading` | **Gap found and being fixed** (see below) — `loadingRequestId` clears in a `finally`, but `displayedOffset` only promotes via `coveredFromRef`, which today is mutated only on the success path inside `ensureCovered`, never in its `catch`. If the very first fetch throws, `loading` stays `true` forever. Fix: mirror `useWorkoutActivitySnapshot`'s pattern — on catch, also advance `coveredFromRef` / mark the window covered with empty data, so `loading` reliably settles on both success and error. Always applicable (runs unconditionally per authenticated user); no "doesn't apply" case. |

```
homeInitialReady = todaySettled && evolutionSettled && activitySnapshotSettled && frequencySettled
```

### In-scope hook fix: `useFrequencyWindow.ts`

Small, contained change to the `catch` branch of `ensureCovered`: on
fetch failure, advance `coveredFromRef` (and populate the window with
empty/fallback data) the same way `useWorkoutActivitySnapshot` already
does on its first-failure path, instead of leaving `displayedOffset`
never promoted. This only touches the frequency-window hook's own local
loading-state bookkeeping — it does not touch schedule rules, lifecycle,
or any authoritative workout state.

## Overlay wiring

The codebase already has a zIndex-tiered "absolute-fill overlay over the
tab content" convention: `FULL_BLEED.overlayZ40/50/60` in `AppShell.tsx`
(`position:'absolute', top/right/bottom/left:0, zIndex:N`), used
throughout `AppShellContent` for existing overlays (paywall, celebration,
etc.). Add one more tier, `overlayZ70`, so the bootstrap overlay always
renders above anything else that could theoretically be present at first
mount, and render `FullScreenLoading` (unmodified, no message) inside it,
as a sibling rendered after `TabBar` — covering the full screen including
the tab bar, per your confirmed answer:

```tsx
{!homeInitialReady && (
  <View style={FULL_BLEED.overlayZ70}>
    <FullScreenLoading />
  </View>
)}
```

Removed from the tree entirely (not just faded) once `homeInitialReady`
becomes `true` — no opacity trick that could let partially-loaded content
peek through, and no fade transition (no existing "loading → content"
fade pattern in this codebase to reuse, and the spec explicitly allows
instant removal when a fade would add complexity).

`Home` (`PersistentScreen active={tab === 'home'} ... inactiveMode="materialized"`)
keeps mounting and fetching exactly as it does today — the overlay is a
pure visual layer on top, never a gate on mounting or on when requests
start.

## Instrumentation

Added to the closed `PerfMark` union in `src/lib/perf.ts`, recorded via
the existing `recordPerfMark`:

- `home_mount` — `AppShellContent` first render for this bootstrap.
- `home_today_ready` — existing, unchanged.
- `home_evolution_ready` — existing, unchanged.
- `home_initial_ready` — the instant `homeInitialReady` flips to `true`.
- `home_initial_overlay_hidden` — the instant the overlay is removed from
  the tree (should be within the same render pass as `home_initial_ready`
  — no additional async gap).

## Error handling

No new global error/retry screen. Because every section's "settled"
expression already includes its real-error terminal, a genuine failure in
any section releases the overlay exactly like success does, and reveals
`Home` mounted underneath — which already renders that section's existing
inline error/retry UI (e.g. `EvolutionCard` already handles `kind ===
'ERROR'`; Today already renders `prescriptionOutcomeKey`-driven outcome
text for non-`SUCCESS` statuses). Offline handling is untouched — whatever
today's offline behavior resolves to for each section is still a settled
terminal, so it participates in the gate the same way.

## What does NOT block the gate

Analytics, logging, secondary prefetch, non-visible-screen data,
support/chat widgets, non-critical remote media, background tasks — none
of these are read by `useHomeInitialReady`.

## Testing

- `src/screens/__tests__/useHomeInitialReady.test.ts` — pure hook test,
  each of the 4 sections driven independently:
  1. stays `false` while Today is not settled;
  2. stays `false` while Evolution is `LOADING`/`SUMMARY_READY`;
  3. becomes `true` when Evolution reaches `ERROR` (not just success);
  4. becomes `true` when Evolution reaches `UNAVAILABLE`;
  5. becomes `true` when Today's schedule has a `refreshError` even with
     `scheduleResolution.status === 'PROGRAM_NOT_AVAILABLE'`;
  6. becomes `true` only once all 4 sections are settled;
  7. latches — flips back to "settled" inputs after being `true` does not
     cause any observable regression (it's already `true` and stays
     `true`).
- `AppShell`-level test (pattern from `appStateIdentityScope.test.ts`):
  overlay re-arms on `uid` change (new bootstrap on login/logout/account
  switch), does **not** re-arm on tab switch, background/foreground, or
  post-workout return to Home.
- Overlay presentation test: overlay blocks touches
  (`pointerEvents`/hit-testing) while active, Home is mounted and
  interactive underneath once it's gone.
- `useFrequencyWindow` regression test: first-fetch failure still settles
  `loading` to `false` (mirroring whatever existing test pattern covers
  `useWorkoutActivitySnapshot`'s equivalent fix, if one exists).

## Metrics to capture before/after

| Metric | Purpose |
|---|---|
| `home_mount` → `home_today_ready` | Must be unchanged — proves Today's work isn't slowed by the gate. |
| `home_mount` → `home_evolution_ready` | Same, for Evolution. |
| `home_mount` → `home_initial_ready` | New — time until everything required has settled. |
| `home_initial_ready` → `home_initial_overlay_hidden` | Must be ~0 (same render pass). |

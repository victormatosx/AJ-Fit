# Phase 5 Implementation — Evolution Experience & Gamification Boundary

**Status:** IMPLEMENTED for Phase 5 scope (presentation layer only)  
**Overall V2 Implementation:** PARTIAL

> Historical report. Fase 8D supersedes the percentage/composite progress,
> deferred-CTA, one-render auto-activation, diff, and placeholder conclusions
> below. See `17_PHASE_8D_UX_TRUTHFULNESS.md`; this file is retained as the
> record of what Fase 5 originally shipped.

## What this phase answers

> How does a trustworthy backend lifecycle become a UI the user actually feels progress in — without inventing anything the backend didn't produce?

## Architecture

```text
Fase 2 (evaluateProgressionV2ForUser) ─┐
Fase 4 (loadPendingEvolution,          │
        reconcileWorkoutLifecycle,     ├─→ src/workoutEvolution/useWorkoutEvolution.ts (hook)
        activatePendingEvolution,      │        │
        deferPendingEvolution)         │        ├─→ buildEvolutionViewModel (pure, src/workoutEvolution/viewModel.ts)
Fase 1 (loadWorkoutLifecycle)  ────────┘        └─→ computePrescriptionDiff (pure, src/workoutEvolution/diff.ts)
                                                          │
                                          EvolutionViewModel + PrescriptionDiffSummary
                                                          │
                              ┌───────────────────────────┼───────────────────────────┐
                    EvolutionCard (Home/Profile)   EvolutionUnlockScreen (AppShell Modal)
```

`useWorkoutEvolution` is the single hook (docs §144/§146) — it calls `reconcileWorkoutLifecycle` exactly once per `AppShell` mount, never per-screen. `buildEvolutionViewModel`/`computePrescriptionDiff` are pure functions with zero React/Firestore dependency, fully unit-testable in isolation (44 tests, see §27).

## Progress Visualization

`ProgressingSummary` carries `earnedLevel`, `activeLevel` (ADR-010's two distinct sources), `cycleNumber`, `proximity`, `displayProgress` (0-1), `sessionsCompleted` (real, from Fase 2's `validSessionCount`), `consistencyPercent` (real, capped adherence ratio), `isHistoryComplete`. `displayProgress` is `compositeProgress()` — `min(activeDays/minimumActiveDays, adherenceRatio/0.70)`, the exact same two numbers and the exact same AND-gate the engine itself uses, never a second formula (docs §6/§12/§13). It is provably `< 1` whenever the engine says not-yet-eligible (tested).

## Proximity States

`EARLY` (<0.25) / `BUILDING` (<0.5) / `ON_TRACK` (<0.75) / `GETTING_CLOSE` (<0.9) / `VERY_CLOSE` (<1) / `READY` (≥1) — bucketed from the same composite fraction. Copy: `src/i18n/resources/*/evolution.json#proximity.*`. No raw day count or percentage-to-threshold ever appears in copy.

## Beginner Experience

Beginner is presented exactly like any other level — `EARLY`→`READY` proximity states, `evolution.level.BEGINNER` label. No "Fase 1/2/3/4..." naming scheme was introduced; `beginnerHint` (an optional supporting line) uses consistency/routine language ("your body is adjusting to the routine"), never a physiological claim.

## Level / Cycle

`EvolutionCard` always renders `Slash` (active level, from `trainingCycles(currentCycleId).level`) and `MonoLabel` (cycle number) as two visually distinct elements — never merged into one string. When `earnedLevel !== activeLevel` (deferral in progress, ADR-010), a small sparkle-tagged earned-level chip appears above the active level, so the user sees BOTH facts simultaneously (docs §19-21/§100/§AE).

## Unlock Screen

`EvolutionUnlockScreen` — three copy variants driven by `pending.type` and `pending.quality`:
- **Level Promotion**: eyebrow "NOVO NÍVEL DESBLOQUEADO", title = target level name.
- **Cycle Evolution**: eyebrow "NOVA FASE DESBLOQUEADA", title = "Ciclo N+1".
- **Motivational Renewal**: eyebrow "VAMOS RENOVAR SEU TREINO?", body is neutral/forward-looking — the copy audit (test §hardcoded-language) proves the strings `congratulations`/`earned`/`completed cycle`/`level up` never appear for this type.

`HIGH` quality gets a `primaryEmphasis`-accented card border and `HudCorners` accent (`isHigh` branch) plus the `reasonHigh` copy line; `GOOD`/STANDARD gets the plain card and `reasonStandard` — same CTAs, same activation rule, only the visual tier and reason line differ (docs §30-34/§AF/§AG). No XP, no `+N` reward number anywhere (`rewardPreview` was never introduced — `AI`/`BK`).

## What Changed

`computePrescriptionDiff` compares `current.sessions[s].exercises[e].exerciseId` against `pending.sessions[s].exercises[e].exerciseId` position-by-position — exactly what Cycle Evolution's substitution actually does (fixed position, never reordered, ADR-008), so `changedExerciseCount` is real, never invented. No "reordering" field exists at all, matching Fase 3's honest scope (§37/§38/§101/§V). `frequencyBefore`/`frequencyAfter` and `splitPreserved` come directly from the two plans' own fields.

## Deferral UX

`EVOLUTION_READY` (Start/Keep both offered) vs. `EVOLUTION_DEFERRED` (neither) is derived via `isPromptable` — **the exact same pure function from Fase 4's `src/workoutLifecycle/deferral.ts`**, imported directly, never reimplemented (docs §85/§129). No `Date.now()` arithmetic (`+14`, `+28`) exists anywhere in the UI layer — confirmed by residual audit. `pending.deferralCount`/`nextPromptAt`/`autoActivateAt` are read verbatim from Fase 4's own state.

## Auto Activation

`useWorkoutEvolution` reads the pending evolution's `type` **before** calling `reconcileWorkoutLifecycle`, so if reconciliation auto-activates it (and deletes the pending doc), the hook still knows what was activated and surfaces `AUTO_ACTIVATED_RECENTLY` for exactly one render — never persisted, never a stale "unlock decision" screen re-appearing (docs §48/§80/§86/§AC/§AD/§BH).

## Program Adaptation / Safety

Fase 5 does not build the adaptation questionnaire (out of scope, docs §92). Because `adaptWorkoutProgram` (Fase 4) never creates a pending evolution and always activates synchronously, there is structurally no "Keep Current" option ever offered for a safety/limitation-driven change — the view model simply reflects the new active state on next reconcile (docs §93/§AM/§AN).

## Placeholder audit results

See §16 of the final report for the full table. Summary: Home's `Ticker` (fake streak/weekVolume/benchPr/consistency/nextLevel) and "twin stats" cards (fake streak/volume) were deleted outright, not replaced with new fake numbers; the space is now the real `EvolutionCard`. Profile's hardcoded XP/level bar was replaced with the same real `EvolutionCard`.

## Gamification boundary

`EvolutionQuality` (`HIGH`/`GOOD`/`BELOW_TARGET`) is the only "hook" Fase 5 consumes — a fact already produced by Fase 2, never computed here, never mapped to an XP number. No `xpBalance`, `awardXp`, achievement collection, or ranking exists anywhere in `src/workoutEvolution/`, `src/components/evolution/`, or `EvolutionUnlockScreen.tsx` (residual audit confirmed).

## Deliberately not implemented

Push notifications for the second prompt, the Program Adaptation questionnaire UI, celebratory motion/confetti, reduced-motion infrastructure (none existed to reuse — not built new either, per scope), automatic modal presentation on every navigation (the unlock screen is opened explicitly from the `EvolutionCard`, avoiding a modal loop per docs §83), and full redesign of Home's weekly consistency calendar strip (left as a known non-blocking placeholder — see final report Known Issues).

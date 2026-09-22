# Home Bootstrap Perf Audit — Phase 3 (Pre-Mount Instrumentation + Diagnosis)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the full pre-mount window (`app_epoch` → `home_mount`, currently 2.5-5s unaccounted for in per-gate detail) and measure it honestly across 10 cold starts, to find out how much of it is genuinely reducible versus already-necessary routing/authority work. No code behavior change is committed to in advance — Task 2 (instrumentation) is the only code change guaranteed by this plan; anything beyond that is conditional on what the data in Task 3's report actually shows.

**Architecture:** `resolvePremiumGate` (`src/lib/premiumGate.ts:116-155`) is a **pure synchronous function** of 8 already-resolved inputs — it is not itself async, so nothing about "waiting for the gate" can be sped up directly; the only lever is how fast its 8 inputs resolve and how well they overlap. Investigation confirmed all 8 are genuine routing/authority decisions (which SCREEN to show — Paywall vs Onboarding vs App vs email-verify), not presentation delays, so **AppShell cannot safely mount before this gate resolves** — doing so would mean speculatively reading a user's workout data before knowing whether they should even see Home, and risks a visible screen-swap if the gate later routes elsewhere. This plan does NOT implement "mount AppShell early." It instruments precisely, measures, and documents.

**Tech Stack:** `src/lib/perf.ts` (extend `PerfMark`), `App.tsx`, `src/state/SubscriptionContext.tsx`, `src/screens/AppShell.tsx`, `src/workoutEvolution/useWorkoutEvolution.ts`, same cold-start tooling from Phase 1/2.

---

## Why "mount AppShell early" is not attempted this phase (read before executing)

The user's stated hypothesis (Passo 7) is to mount AppShell behind the overlay as soon as a valid uid exists, letting profile/prescription/Today/Evolution resolve in the background. Investigation found:

1. `resolvePremiumGate`'s 8 inputs (`App.tsx:333-346`) decide **which screen to render at all** — email verification, preference-language/unit consistency, questionnaire-found (routes to onboarding if not), commercial gate (routes to Paywall if not), workout readiness (routes to onboarding-repair if a required field is missing). None are Home-presentation delays; all are routing/authority decisions with extensive doc-comment justification already in the code (`premiumGate.ts`). This matches Phase 2's Part 0 finding that resolvePremiumGate has **zero Category-E (historical-cruft) candidates**.
2. `useWorkoutReadinessGate`'s own doc comment (`useWorkoutReadinessGate.ts:59-66`) already explains a deliberate design choice: it starts "once auth + questionnaire are already confirmed resolved... rather than waiting for the commercial/premium gate too... lets this overlap with the user's time on Paywall." This is the SAME prerequisite `resolvePremiumGate` requires before ever returning `'app'` — so relaxing the gate's own `enabled` condition to start even earlier (e.g. on `uid` alone) would do no net good: `resolvePremiumGate` still can't return `'app'` before questionnaire resolves regardless of how early the readiness gate's own internal work starts. This was the single most obvious-looking optimization candidate from a first-pass investigation, and it does NOT survive a careful reading of the surrounding code — recorded here so it isn't re-proposed without re-deriving why it doesn't help.
3. `useWorkoutEvolution` itself DOES tolerate being constructed with `activeProgramInstanceId=null` reasonably well (its `load()` never reads that parameter directly — it re-derives the authoritative program instance from a fresh `reconcileWorkoutLifecycle(uid)` call every time) — so the hook-level risk the user was worried about (Passo 8) is smaller than expected. But this is moot without a route to mount AppShell speculatively in the first place, given point 1.

**What this plan does instead:** treats the pre-mount window as an honest measurement problem first. If the 10-cold-start data (Task 3) reveals a genuine serialization that doesn't need to exist (distinct from the two already-examined-and-rejected candidates above), a narrowly-scoped fix will be proposed as a Phase 3b addendum, tested with the same A/B discipline as Phase 2 — not decided in advance.

---

## Task 1: Extend PerfMark vocabulary for the genuinely unmeasured pre-mount steps

Confirmed via investigation: `profileLoading`/`questionnaireResolution` are already covered by `profile_remote_ready`/`profile_ready`; `commercialGateResolved` and `emailVerificationRequired` are synchronous derivations from already-resolved state (no separate async window to mark); `workoutReadinessGate`'s settle is already marked (`workout_readiness_ready`). Two real gaps exist, plus three structural marks the user's Passo 1 list asks for that don't exist yet:

**Files:**
- Modify: `src/lib/perf.ts`

- [ ] **Step 1: Add 7 new marks**

```typescript
  | 'home_support_inbox_listener_start' | 'home_support_inbox_settled'
  // Phase 3 — pre-mount audit (2026-09-22). subscription_bootstrap covers
  // SubscriptionContext's own RevenueCat identity-sync window (previously
  // unmeasured — confirmed uid-only dependency, already parallel with
  // profile, but its own duration was invisible). preferences_reconciliation
  // covers the language/units reconcile effect (App.tsx) — genuinely serial
  // AFTER profile (it reads profile.preferences), not a waterfall to fix,
  // but its duration was invisible and could still be the long pole.
  // premium_gate_resolved_app fires the instant resolvePremiumGate first
  // returns 'app' for the current identity — the true end of the pre-mount
  // routing decision, previously only inferrable from workout_readiness_ready
  // (its last-checked input, not the gate's own resolution moment).
  // appshell_mount is AppShell's own top-level mount (distinct from
  // home_mount, which is HomeScreen's). evolution_start fires when
  // useWorkoutEvolution's load() is first invoked, before any await.
  | 'subscription_bootstrap_start' | 'subscription_bootstrap_settled'
  | 'preferences_reconciliation_start' | 'preferences_reconciliation_settled'
  | 'premium_gate_resolved_app'
  | 'appshell_mount'
  | 'evolution_start';
```

(Insert after the existing `home_support_inbox_settled` entry from Phase 1 — check current end of the union with `tail -20 src/lib/perf.ts` before editing, since Phase 1/2 already appended there.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/lib/perf.ts
git commit -m "perf: add pre-mount marks (subscription, preferences reconciliation, premium gate, appshell/evolution start)"
```

---

## Task 2: Wire the new marks

**Files:**
- Modify: `src/state/SubscriptionContext.tsx`
- Modify: `App.tsx`
- Modify: `src/screens/AppShell.tsx`
- Modify: `src/workoutEvolution/useWorkoutEvolution.ts`

- [ ] **Step 1: Subscription bootstrap start/settle**

Read `src/state/SubscriptionContext.tsx:364-436` (the identity-sync effect) and `:757` (the `configured` derivation) fresh before editing — confirm the exact effect boundaries match this plan's Part 0 investigation before placing marks (do not assume line numbers are still exact after Phase 1/2 edits elsewhere in the codebase; this file wasn't touched by either phase, but verify anyway). Add:
- `recordPerfMark('subscription_bootstrap_start')` at the top of the identity-sync effect, gated the same way the effect itself is gated (only when it's about to actually do work — i.e. inside the same `if (initializing) return;`-style guard the effect already has, not unconditionally on every render).
- `recordPerfMark('subscription_bootstrap_settled')` at the point `configured` (line ~757's derivation) first becomes `true` for the current uid — likely needs a small `useEffect` watching the `configured` boolean transition to `true`, mirroring the existing `workout_readiness_ready` pattern at `App.tsx:348-350` (`useEffect(() => { if (x === 'ready') recordPerfMark(...) }, [x])`).

- [ ] **Step 2: Preferences reconciliation start/settle**

In `App.tsx`'s reconciliation effect (around line 282-303, confirmed above): add `recordPerfMark('preferences_reconciliation_start')` right before the `Promise.all([reconcileLanguageOnLoad(...), reconcileUnitsOnLoad(...)])` call, and `recordPerfMark('preferences_reconciliation_settled')` inside the existing `.finally(() => { reconciledUidRef.current = user.uid; ... })` callback.

- [ ] **Step 3: Premium gate resolved**

In `App.tsx`, near the existing `workout_readiness_ready` effect (line 348-350), add a sibling effect:

```typescript
  useEffect(() => {
    if (resolvedScreen === 'app') recordPerfMark('premium_gate_resolved_app');
  }, [resolvedScreen]);
```

- [ ] **Step 4: AppShell mount**

In `src/screens/AppShell.tsx`, find its top-level component function and add a mount-only effect near the top (check whether one already exists for another purpose before adding a second `useEffect(() => {...}, [])` — merge into an existing empty-deps effect if one is already there):

```typescript
  useEffect(() => {
    recordPerfMark('appshell_mount');
  }, []);
```

Import `recordPerfMark` from `'../lib/perf'` if not already imported in this file (check first — `AppShell.tsx` almost certainly already imports other things from `../lib/perf` given Phase 1/2's investigation touched marks fired from within it indirectly; confirm the exact existing import line and extend it rather than adding a duplicate import).

- [ ] **Step 5: Evolution start**

In `src/workoutEvolution/useWorkoutEvolution.ts`, at the very top of the `load` callback body (line ~155, right after the `if (!user) return;` guard, before anything else):

```typescript
    if (!user) return;
    recordPerfMark('evolution_start');
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Run the affected test suites**

Run: `npx vitest run src/state src/workoutEvolution 2>&1 | tail -40` (confirms `SubscriptionContext`/`AuthContext`-adjacent tests and the evolution suite still pass — marks are no-ops outside `EXPO_PUBLIC_PERF_TRACE=1`, matching the established convention of not unit-testing mark call sites).
Expected: PASS, same counts as Phase 1/2's baseline runs (138 for workoutEvolution).

- [ ] **Step 8: Commit**

```bash
git add src/state/SubscriptionContext.tsx App.tsx src/screens/AppShell.tsx src/workoutEvolution/useWorkoutEvolution.ts
git commit -m "perf: wire pre-mount marks into SubscriptionContext/App/AppShell/useWorkoutEvolution"
```

---

## Task 3: Baseline — 10 cold starts + pre-mount timeline report

**Files:**
- Create: `docs/home-bootstrap-perf-audit-phase3.md`

- [ ] **Step 1: Smoke-check the new marks** — same procedure as Phase 1 Task 5 (confirm Metro is running with `EXPO_PUBLIC_PERF_TRACE=1` on port 8082, `xcrun simctl terminate booted com.ajfit.app` + `launch`, capture via Metro's own log file, confirm all 7 new marks fire in a sane order relative to the existing `auth_ready`/`profile_remote_ready`/`workout_readiness_ready`/`home_mount` marks).

- [ ] **Step 2: Run the batch**

```bash
scripts/coldStartPerfRun.sh 10 phase3-baseline /tmp/metro-perf-8082.log
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/phase3-baseline-run-*.log | tee perf-runs/phase3-baseline-report.md
```

Note: `analyzeHomeBootstrapPerf.mjs`'s existing GATES table (today/evolution/activity/frequency/support) still works unchanged — the 7 new marks won't appear in that table (it only knows about the 5 Home-gate marks), but they ARE in the raw log files. Extract their timings directly per run with `grep` (same technique used in Phase 2's Part K/L analysis) rather than extending the script for a single one-off report — not worth the added surface area for a report that won't be regenerated repeatedly the way the Home-gate baseline was.

- [ ] **Step 3: Build the pre-mount timeline table manually from the 10 raw logs**

For each run, extract (via `grep` + the existing `msSinceAppEpoch`/`durationMs` fields, same technique as Phase 2's Part D/K analysis): `app_epoch`, `auth_ready`, `profile_remote_ready`, `subscription_bootstrap_start`/`settled`, `preferences_reconciliation_start`/`settled`, `workout_readiness_ready`, `premium_gate_resolved_app`, `appshell_mount`, `home_mount`, `evolution_start`. Compute per-stage durations and whether stages visibly overlap (e.g. does `subscription_bootstrap_start` land near `auth_ready`, confirming the parallel-with-profile design holds in practice; does `preferences_reconciliation_start` land right after `profile_remote_ready`, confirming it's correctly serial-but-minimal rather than adding unexpected delay).

- [ ] **Step 4: Commit the raw report data reference (not raw logs)**

The actual analysis/report writing is Task 4 below — this step is just ensuring `perf-runs/phase3-baseline-run-*.log` exist locally (gitignored, not committed) for Task 4 to cite.

---

## Task 4: Write the Phase 3 report (diagnosis only — no code change decided yet)

**Files:**
- Create: `docs/home-bootstrap-perf-audit-phase3.md`

- [ ] **Step 1: Draft the report** covering the user's requested sections A-H (baseline, 10-run timeline, gate call graph, real-vs-historical dependencies, Auth/Profile-Questionnaire/Prescription audits, parallelism findings) using Task 3's data plus the "why mount-early wasn't attempted" reasoning already written above — cite it directly rather than re-deriving.

For section C (gates that impede mount) and D (real vs historical dependencies), use exactly the classification the user specified (A: must resolve before any Home mount; B: Home can mount but actions must stay blocked; C: presentation-only; D: independent work; E: historical gate with no current need) — apply it to each of `resolvePremiumGate`'s 8 inputs plus `useWorkoutReadinessGate`'s own internal gating, using the evidence already gathered (Part 0's reasoning above + Task 3's real timing data to see which are actually on the critical path vs. already fully overlapped).

- [ ] **Step 2: Identify whether Task 3's data reveals any NEW, previously-invisible serialization** — specifically check:
  - Does `subscription_bootstrap_start` actually land near `auth_ready` in every run (confirming the "already parallel, uid-only dependency" claim empirically, not just from a static code read)? If it starts meaningfully LATER than expected, that's a new finding requiring its own investigation before any fix.
  - Is `preferences_reconciliation`'s own duration (settled − start) large enough to matter, or trivial? If trivial (well under ~200-300ms), it's not worth touching regardless of being "technically serial."
  - Does `appshell_mount` land essentially immediately after `premium_gate_resolved_app` (confirming no additional React-render-cycle delay between the gate resolving and AppShell actually mounting), or is there a gap worth explaining?
  - Which single stage, if any, is consistently the last one to settle before `premium_gate_resolved_app` fires — i.e., which of {profile/questionnaire, subscription, preferences reconciliation, workout readiness} is the TRUE long pole for this account, empirically, not assumed?

- [ ] **Step 3: Decide, based on Step 2's findings, whether any further hypothesis is even worth testing this phase** — if the true long pole turns out to be something already well-understood and legitimately necessary (e.g. `workout_readiness_ready`'s own `loadActiveWorkoutProgram` round trip, already audited in Phase 1/2 as a serial 2-read chain), state that plainly as the report's conclusion (Part P: "PRÉ-MOUNT FOI REDUZIDO: NÃO — nenhuma serialização não-necessária foi encontrada além do que já existe por razões de roteamento/autoridade legítimas") rather than inventing a change to justify the phase's existence. If a genuine, narrow, safe candidate DOES surface, write it up as a numbered hypothesis (Part I's format: hipótese → mudança → antes/depois → manter/reverter) and stop — do not implement it in this same commit; that becomes a Task 5 the user explicitly approves after reading the report, matching Phase 1/2's own gating discipline for anything touching more than pure instrumentation.

- [ ] **Step 4: Commit**

```bash
git add docs/home-bootstrap-perf-audit-phase3.md
git commit -m "docs: Home bootstrap perf audit phase 3 — pre-mount timeline and diagnosis"
```

---

## Explicitly out of scope for this plan

- Mounting AppShell before `resolvePremiumGate` resolves (see the "Why" section above — rejected on safety/architecture grounds, not just deferred).
- Relaxing `useWorkoutReadinessGate`'s `enabled` condition to start before questionnaire resolves (rejected — doesn't help, since `resolvePremiumGate` needs questionnaire resolved anyway).
- Any change to `user_profile.document`/`workout_programs.snapshot` deduplication (Phase 2's deferred items — out of this phase's scope per the user's own Passo 20/21, unless Task 4's pre-mount call graph specifically implicates one of them on the critical path with clear ownership, which is not assumed going in).
- Any actual behavioral/architectural change beyond instrumentation — this plan's only guaranteed code changes are Task 1/2 (marks). Task 4 may identify a candidate for a future Task 5, but implementing it requires the user reading the report first.

## Self-review notes

- Spec coverage: Passo 1 (marks) → Task 1/2, scoped down from the user's full illustrative list to only the genuinely-unmeasured gaps found by investigation (subscription, preferences reconciliation, premium-gate-resolved, appshell/evolution start) — `presentation_cache_*`/`entitlement_bootstrap_*`/`active_program_*` as literally named in the user's example were found to already exist under different (established) names or to not correspond to a real separate async window, per "não inventar marks para operações que não existem." Passo 2 (10 cold starts) → Task 3. Passo 3 (call graph) → Task 4 Step 1, using the A-E classification. Passo 4 (Auth) → covered by existing `auth_ready` data + Part 0's finding that subscription already starts in parallel. Passo 5 (profile/questionnaire) → Part 0, no presentation-cache-as-authority risk found (confirmed in Phase 1's investigation already). Passo 6 (prescription/active program) → deferred to Task 4's analysis using Task 3's data; the "mount early" sub-hypothesis for this specifically is covered by the top-level "why not attempted" reasoning. Passo 7/8/16/17/18 (mount-earlier hypothesis, null-vs-absent risk, race auditing) → explicitly addressed and the hypothesis rejected with reasoning, per Passo 7's own "se não suportam: não forçar." Passo 9/10 (parallelism, AsyncStorage) → Part 0 point 6 already confirms no AsyncStorage waterfall exists in the audited path. Passo 11 (entitlement/RevenueCat) → Part 0 point 3, confirmed already parallel, marks added to prove it empirically (Task 1/2). Passo 12/13 (per-hypothesis A/B, main metric) → Task 4 Step 3's explicit "don't invent a change" gate, deferring any actual A/B to a future Task 5 only if warranted. Passo 14/15 (no overlay change, visual validation) → not touched this plan (no code change beyond marks); would apply to a future Task 5. Passo 19 (goal, not fabricated) → Task 4 Step 3 explicit instruction not to fabricate a win. Passo 20/21 (user_profile/program_snapshot) → explicitly out of scope unless Task 4 implicates them, stated in "Explicitly out of scope."
- No placeholders: Task 1/2 give literal code (with explicit "re-verify line numbers first" instructions where Phase 1/2 didn't already touch the file, since this is genuinely new territory unlike Phase 2's precisely-pre-read targets).
- Type consistency: new `PerfMark` entries match the call sites added in Task 2 exactly.

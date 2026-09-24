# Home Bootstrap Perf Audit — Phase 1 (Instrument + Measure + Diagnose)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument every Home-bootstrap gate (today/evolution/activitySnapshot/frequency/supportInbox), run 10 real cold starts on the iPhone 17 Pro Simulator, and produce a code+data-grounded critical-path report — with **zero** changes to the approved visual gate (`homeInitialVisualReady`/`layoutCommitted`/rAF/overlay) and **zero** speculative optimizations. Optimization work is an explicit follow-up plan, gated on this report.

**Architecture:** `src/lib/perf.ts` already defines a closed `PerfMark` vocabulary + `recordPerfMark`/`recordPerfTrace`/`countFirestoreRead`, active only under `__DEV__ && EXPO_PUBLIC_PERF_TRACE=1`, logged via `logDebug('app:perf', ...)`. Today and Evolution already have rich start/settle instrumentation (`today_*`, `evolution_*`, `home_today_ready`, `home_evolution_ready` in `src/screens/HomeScreen.tsx:129-149`). The three gaps are `activitySnapshot`, `frequency`, and `supportInbox` — none of their hooks emit any mark today. This plan (a) fills those three gaps with the same closed-vocabulary style, (b) adds simulator-driving tooling to capture 10 (then repeatable 5×) cold-start runs without requiring manual login taps each time (RN console output reaches the OS unified log via `xcrun simctl spawn booted log stream`, and the app's session persists across a `terminate`+`launch` cycle — verified: `com.ajfit.app` is already installed and the iPhone 17 Pro Simulator is already booted), and (c) parses the captured logs into the exact report format the spec requires.

**Tech Stack:** TypeScript/React Native (Expo 56), `src/lib/perf.ts` instrumentation, Node scripts (`scripts/*.mjs`, `.sh`) for capture/analysis, `xcrun simctl` for cold-start automation, `vitest` for anything unit-testable.

---

## Scope note

This plan covers spec steps **Passo 1–12** (instrument every gate → 10 cold starts → critical path → per-gate audits → classification A–E) and report sections **A–L**. It deliberately stops before any optimization (Passo 13+, report sections M–S) — those require this report's findings + explicit user approval per Passo 15/19, and belong in a second plan.

No file touched here is in the excluded list (progression/lifecycle/pending/workout authority/schedule rules/Functions/App Check/Firestore Rules/RevenueCat/entitlement/billing) — all changes are additive perf-mark calls behind the existing `EXPO_PUBLIC_PERF_TRACE` flag, plus new standalone scripts/docs.

---

## File Structure

- Modify: `src/lib/perf.ts` — extend `PerfMark` union (7 new marks, 3 gates).
- Modify: `src/home/useWorkoutActivitySnapshot.ts` — fetch-start/network-ready/settled marks.
- Modify: `src/home/useFrequencyWindow.ts` — fetch-start/network-ready/settled marks.
- Modify: `src/hooks/useUnreadSupportCasesCount.ts` — listener-start/settled marks.
- Create: `scripts/coldStartPerfRun.sh` — drives N cold starts via `xcrun simctl terminate`+`launch`, captures each run's `app:perf` log lines into `perf-runs/run-<n>-<timestamp>.log`.
- Create: `scripts/analyzeHomeBootstrapPerf.mjs` — parses `perf-runs/*.log`, emits the per-run gate table, last-blocker, and p50/p75/p95/min/max as Markdown.
- Modify: `.gitignore` — add `perf-runs/` (raw per-run logs are local measurement artifacts, not source).
- Create: `docs/home-bootstrap-perf-audit-phase1.md` — the final report (sections A–L), following the `docs/phase3-cache-audit.md` precedent already in the repo.

---

## Task 1: Extend the PerfMark vocabulary

**Files:**
- Modify: `src/lib/perf.ts:3-49`

- [ ] **Step 1: Add 7 new closed-vocabulary marks**

In `src/lib/perf.ts`, extend the `PerfMark` union (insert after the existing Fase 5.3 block, i.e. after line 49's `'evolution_cached_summary_visible' | 'evolution_current_summary_visible'`, changing that line's trailing `;` to `|` and appending):

```typescript
  | 'evolution_cached_summary_visible' | 'evolution_current_summary_visible'
  // Home bootstrap audit (2026-09-22) — the three gates that previously had
  // no dedicated marks (Today/Evolution already do — see home_today_ready/
  // home_evolution_ready above). "fetch_start" fires when the hook actually
  // issues its Firestore call/subscribes its listener (not on mount — these
  // hooks may re-run on prop changes); "settled" fires exactly once, the
  // first time the gate's own InitialSectionStatus leaves PENDING, mirroring
  // homeInitialReadiness.ts's own settle condition for that gate.
  | 'home_activity_fetch_start' | 'home_activity_network_ready' | 'home_activity_settled'
  | 'home_frequency_fetch_start' | 'home_frequency_network_ready' | 'home_frequency_settled'
  | 'home_support_inbox_listener_start' | 'home_support_inbox_settled';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (the union extension is additive; nothing consumes an exhaustive switch over `PerfMark` elsewhere — confirm with `grep -rn "PerfMark" src | grep -v perf.ts` before running, should show only type-annotation usages, not exhaustive switches).

- [ ] **Step 3: Commit**

```bash
git add src/lib/perf.ts
git commit -m "perf: add activity/frequency/support-inbox bootstrap marks to PerfMark vocabulary"
```

---

## Task 2: Instrument `useWorkoutActivitySnapshot`

**Files:**
- Modify: `src/home/useWorkoutActivitySnapshot.ts`

- [ ] **Step 1: Add marks around the fetch and guard the settle mark to fire once**

Replace the `reload` callback (current lines 50-76) with:

```typescript
  const settledMarkFiredRef = useRef(false);

  const reload = useCallback(async () => {
    if (!uid) {
      setCompletedDates(null);
      setFulfilledScheduledDates(null);
      setLoading(false);
      setInitialStatus('NOT_APPLICABLE');
      return;
    }
    recordPerfMark('home_activity_fetch_start');
    try {
      const today = localDateInTimezone(new Date(), input.timezone);
      const from = mondayOfWeek(today);
      const dates = await listCompletedWorkoutActivityDatesInRange(uid, from, today);
      recordPerfMark('home_activity_network_ready');
      setCompletedDates(new Set(dates.performedDates));
      setFulfilledScheduledDates(new Set(dates.scheduledDates));
      setInitialStatus((previous) => previous === 'PENDING' ? 'SUCCESS' : previous);
      if (!settledMarkFiredRef.current) {
        settledMarkFiredRef.current = true;
        recordPerfMark('home_activity_settled');
      }
    } catch (error) {
      logWarn('home_activity', 'load_failed', { error });
      // Keep the last known set on a transient failure; only default to
      // empty on the very first load, matching `useWorkoutEvolution`'s "never
      // flash a worse state than what's already on screen" contract.
      setCompletedDates((previous) => previous ?? new Set());
      setFulfilledScheduledDates((previous) => previous ?? new Set());
      setInitialStatus((previous) => previous === 'PENDING' ? 'ERROR' : previous);
      if (!settledMarkFiredRef.current) {
        settledMarkFiredRef.current = true;
        recordPerfMark('home_activity_settled');
      }
    } finally {
      setLoading(false);
    }
  }, [uid, input.timezone]);
```

Add the import at the top of the file (after the existing `logWarn` import, line 3):

```typescript
import { recordPerfMark } from '../lib/perf';
```

And add `useRef` to the existing React import (line 1):

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the existing test suite for this module (if any) to confirm no behavior change**

Run: `npx vitest run src/home/__tests__ -t activity 2>&1 | tail -30` (there is no dedicated `useWorkoutActivitySnapshot.test.ts` today — this is a sanity check that the surrounding suite still passes, not new coverage; perf marks are a no-op outside `EXPO_PUBLIC_PERF_TRACE=1`, matching the existing convention that `today_*`/`evolution_*` marks are also untested — verified: no test in the repo mocks `lib/perf`).
Expected: PASS (or "no tests found", which is fine — this hook has no existing dedicated test file).

- [ ] **Step 4: Commit**

```bash
git add src/home/useWorkoutActivitySnapshot.ts
git commit -m "perf: instrument useWorkoutActivitySnapshot fetch/settle marks"
```

---

## Task 3: Instrument `useFrequencyWindow`

**Files:**
- Modify: `src/home/useFrequencyWindow.ts`

- [ ] **Step 1: Add marks around `ensureCovered` and guard settle to fire once**

Replace the `ensureCovered` callback (current lines 87-113) with:

```typescript
  const settledMarkFiredRef = useRef(false);

  const ensureCovered = useCallback(async (neededFromLocalDate: LocalDate, todayLocalDate: LocalDate) => {
    if (!uid) return;
    if (coveredFromRef.current !== null && neededFromLocalDate >= coveredFromRef.current) return;
    const rangeTo = coveredFromRef.current ? addDaysLocal(coveredFromRef.current, -1) : todayLocalDate;
    const requestId = ++inFlightRequestIdRef.current;
    setLoadingRequestId(requestId);
    recordPerfMark('home_frequency_fetch_start');
    try {
      const dates = await listCompletedWorkoutDatesInRange(uid, neededFromLocalDate, rangeTo);
      recordPerfMark('home_frequency_network_ready');
      setCompletedDates((previous) => new Set([...previous, ...dates]));
      coveredFromRef.current = mergeCoveredFrom(coveredFromRef.current, neededFromLocalDate);
      setInitialStatus((previous) => previous === 'PENDING' ? 'SUCCESS' : previous);
      if (!settledMarkFiredRef.current) {
        settledMarkFiredRef.current = true;
        recordPerfMark('home_frequency_settled');
      }
    } catch (error) {
      logWarn('home_frequency', 'load_failed', { error });
      // A failed first read is a terminal ERROR presentation, not an
      // infinite loading state. Mark the requested range as covered with the
      // already-known empty/previous set so the normal synchronous promotion
      // below builds and commits the final fallback grid before Home reveals.
      coveredFromRef.current = mergeCoveredFrom(coveredFromRef.current, neededFromLocalDate);
      setCompletedDates((previous) => new Set(previous));
      setInitialStatus((previous) => previous === 'PENDING' ? 'ERROR' : previous);
      if (!settledMarkFiredRef.current) {
        settledMarkFiredRef.current = true;
        recordPerfMark('home_frequency_settled');
      }
    } finally {
      // Only the most recently *issued* request clears the loading flag —
      // an older, slower request resolving after a newer one must not mask
      // the newer one still being in flight.
      setLoadingRequestId((current) => (current === requestId ? null : current));
    }
  }, [uid]);
```

Add the import (after the existing `logWarn` import, line 3):

```typescript
import { recordPerfMark } from '../lib/perf';
```

`useRef` is already imported on line 1 of this file (`import { useCallback, useEffect, useRef, useState } from 'react';`) — no import change needed there.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the existing frequency test suite to confirm no behavior change**

Run: `npx vitest run src/home/__tests__/frequencyHeatmap.test.ts`
Expected: PASS (this file tests `frequencyHeatmap.ts`, the pure module `useFrequencyWindow` calls into — it doesn't exercise the hook itself, so this only guards the pure logic didn't regress; there is no existing `useFrequencyWindow.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/home/useFrequencyWindow.ts
git commit -m "perf: instrument useFrequencyWindow fetch/settle marks"
```

---

## Task 4: Instrument `useUnreadSupportCasesCount`

**Files:**
- Modify: `src/hooks/useUnreadSupportCasesCount.ts`

- [ ] **Step 1: Add listener-start and one-shot settle marks**

Replace the full file body (current lines 1-46) with:

```typescript
import { useEffect, useRef, useState } from 'react';

import { countUnreadSupportCases } from '../lib/unreadSupportCasesCount';
import { observeOwnSupportCases } from '../services/supportCases';
import { recordPerfMark } from '../lib/perf';
import type { InitialSectionStatus } from '../home/homeInitialReadiness';

export interface UnreadSupportCasesState {
  count: number;
  initialStatus: InitialSectionStatus;
}

/**
 * Total unread ADMIN messages across the caller's support cases, derived
 * live from Firestore's `unreadByUserCount` on each case via
 * `countUnreadSupportCases` (see that module — this is never a locally
 * incremented/decremented counter). Recomputed from the latest
 * `observeOwnSupportCases` snapshot on every update, so it can only change
 * when Firestore's real state changes (e.g. a new ADMIN message, or
 * `markSupportMessageRead` clearing one).
 */
export function useUnreadSupportCasesCount(uid: string | null | undefined): UnreadSupportCasesState {
  const [count, setCount] = useState(0);
  const [initialStatus, setInitialStatus] = useState<InitialSectionStatus>(uid ? 'PENDING' : 'NOT_APPLICABLE');
  const settledMarkFiredRef = useRef(false);

  useEffect(() => {
    if (!uid) {
      setCount(0);
      setInitialStatus('NOT_APPLICABLE');
      return undefined;
    }
    setInitialStatus('PENDING');
    settledMarkFiredRef.current = false;
    recordPerfMark('home_support_inbox_listener_start');
    return observeOwnSupportCases(
      uid,
      (cases) => {
        setCount(countUnreadSupportCases(cases));
        setInitialStatus('SUCCESS');
        if (!settledMarkFiredRef.current) {
          settledMarkFiredRef.current = true;
          recordPerfMark('home_support_inbox_settled');
        }
      },
      () => {
        setCount(0);
        setInitialStatus('ERROR');
        if (!settledMarkFiredRef.current) {
          settledMarkFiredRef.current = true;
          recordPerfMark('home_support_inbox_settled');
        }
      },
    );
  }, [uid]);

  return { count, initialStatus };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUnreadSupportCasesCount.ts
git commit -m "perf: instrument useUnreadSupportCasesCount listener-start/settle marks"
```

---

## Task 5: Manual smoke check of the new marks (before trusting 10 cold starts to them)

**Files:** none (verification only)

- [ ] **Step 1: Confirm the simulator has the dev build and Metro is reachable**

Run: `xcrun simctl list devices booted` — expect the iPhone 17 Pro Simulator listed as Booted.
Run: `xcrun simctl listapps booted | grep -A3 com.ajfit.app` — expect the app installed.

- [ ] **Step 2: Start a log capture, relaunch the app once, confirm all 7 new marks + existing marks appear**

```bash
xcrun simctl spawn booted log stream --level debug --style compact \
  --predicate 'process == "AJFit" AND eventMessage CONTAINS "app:perf"' \
  > /tmp/perf-smoke.log &
LOG_PID=$!
sleep 2
xcrun simctl terminate com.ajfit.app 2>/dev/null
sleep 1
xcrun simctl launch booted com.ajfit.app
sleep 15
kill $LOG_PID
grep -o 'home_[a-z_]*\|today_[a-z_]*\|evolution_[a-z_]*' /tmp/perf-smoke.log | sort | uniq -c
```

Expected: at minimum `home_mount`, `home_today_ready`, `home_evolution_ready`, `home_initial_data_settled`, `home_initial_layout_committed`, `home_initial_visual_ready`, `home_initial_overlay_hidden`, and the 7 new marks (`home_activity_fetch_start`, `home_activity_network_ready`, `home_activity_settled`, `home_frequency_fetch_start`, `home_frequency_network_ready`, `home_frequency_settled`, `home_support_inbox_listener_start`, `home_support_inbox_settled`) all appear exactly once each (except `_start`/`_ready` pairs which may legitimately repeat if a hook refetches — note but don't treat as a bug yet).

**If the app shows a login screen instead of Home after `launch`:** the "cold start = terminate+launch, no re-login needed" assumption (this plan's Task 6/7 tooling) is wrong for this build/session. Stop and flag to the user before Task 6 — Task 7's automation needs a pre-authenticated session to work headlessly.

**If `EXPO_PUBLIC_PERF_TRACE=1` isn't already set for the running Metro/dev-client process:** marks won't log at all (see `isEnabled()` in `perf.ts:53-55`). Confirm how the currently-running dev build was started (check for the env var in the Metro process, or that it's baked into the dev client's `.env`) before concluding marks are broken — this is a prerequisite, not a plan step, since Metro is user-owned per the spec ("Metro dedicado correto").

- [ ] **Step 3: No commit** (this step produces no file changes — it's a go/no-go gate before Task 6's automation is trusted).

---

## Correction from Task 5 execution (2026-09-22)

Task 5's smoke check invalidated two assumptions this plan made before running anything:

1. `xcrun simctl spawn booted log stream --predicate '...eventMessage CONTAINS "app:perf"'` captured **zero** lines across a full cold start. RN's console output under Hermes + the New Architecture does not reach the OS unified log via NSLog/os_log the way it used to — it only reaches Metro's own stdout (the terminal running `expo start`). **Capture must tail Metro's log file, not `simctl log stream`.**
2. `xcrun simctl terminate com.ajfit.app` (device arg omitted) silently fails with a usage error — it does **not** terminate the app, so a subsequent `launch` just re-foregrounds whatever was already there (in this case a stale `RCTFatal` red screen from an earlier misconfigured attempt, at one point stale enough to make two consecutive "runs" look identical). **Must be `xcrun simctl terminate booted com.ajfit.app`.**

Also discovered: the installed dev client's embedded Metro URL is `172.16.101.106:8082` (port 8082), not 8081 — port 8081 was running a stale/incorrectly-targeted Metro from a previous session for the same worktree. Confirmed live and correct: `EXPO_PUBLIC_PERF_TRACE=1 npx expo start --port 8082`.

One full run captured during the smoke check (informative, not part of the official 10-run baseline in Task 7, which re-runs clean): `home_mount` 5810ms, `home_activity_settled`/`home_frequency_settled`/`home_support_inbox_settled` all ≈6686ms (i.e. **not** the bottleneck), `home_today_ready` 9314ms, `home_evolution_ready` 11069ms, `home_initial_data_settled` 11081ms, `home_initial_overlay_hidden` 11326ms. Last blocker: **Evolution**, clearly, by ~1.75s over Today. Also visible in the raw trace: `workout_lifecycle.bundle` read 4×, `workout_schedule.config` read 3×, `workout_programs.snapshot` read 2× within this single cold start — real duplicate-read evidence, not speculation. Task 6/7/8 below are updated to capture via Metro's log file and to treat these as a lead to confirm across the full 10-run batch, not a conclusion yet.

## Task 6: Cold-start capture + analysis tooling

**Files:**
- Create: `scripts/coldStartPerfRun.sh`
- Create: `scripts/analyzeHomeBootstrapPerf.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Add `perf-runs/` to `.gitignore`**

Append to `.gitignore`:

```
perf-runs/
```

- [ ] **Step 2: Write the capture script**

Create `scripts/coldStartPerfRun.sh`:

```bash
#!/usr/bin/env bash
# Drives N cold starts of the AJ Fit dev build on the currently-booted
# Simulator and captures each run's `app:perf` log lines to its own file.
# Assumes: simulator booted, app installed, app already has a persisted
# authenticated session (cold start here = process kill + relaunch, never
# a fresh login) — verified once via Task 5 of
# docs/superpowers/plans/2026-09-22-home-bootstrap-perf-audit-phase1.md.
#
# Usage: scripts/coldStartPerfRun.sh <run-count> [output-prefix]
set -euo pipefail

RUN_COUNT="${1:?usage: coldStartPerfRun.sh <run-count> [output-prefix]}"
PREFIX="${2:-baseline}"
BUNDLE_ID="com.ajfit.app"
OUT_DIR="perf-runs"
SETTLE_TIMEOUT_SECONDS=25

mkdir -p "$OUT_DIR"

BOOTED=$(xcrun simctl list devices booted | grep -c "Booted" || true)
if [ "$BOOTED" -eq 0 ]; then
  echo "No booted simulator found. Boot the iPhone 17 Pro Simulator first." >&2
  exit 1
fi

for i in $(seq 1 "$RUN_COUNT"); do
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  OUT_FILE="$OUT_DIR/${PREFIX}-run-${i}-${TIMESTAMP}.log"
  echo "== Run $i/$RUN_COUNT -> $OUT_FILE =="

  xcrun simctl spawn booted log stream --level debug --style compact \
    --predicate 'process == "AJFit" AND eventMessage CONTAINS "app:perf"' \
    > "$OUT_FILE" &
  LOG_PID=$!
  sleep 1

  xcrun simctl terminate "$BUNDLE_ID" 2>/dev/null || true
  sleep 1
  xcrun simctl launch booted "$BUNDLE_ID" >/dev/null

  # Poll for the terminal mark instead of a fixed sleep, capped at
  # SETTLE_TIMEOUT_SECONDS so one stuck run doesn't block the batch.
  ELAPSED=0
  while [ "$ELAPSED" -lt "$SETTLE_TIMEOUT_SECONDS" ]; do
    if grep -q "home_initial_overlay_hidden" "$OUT_FILE" 2>/dev/null; then
      break
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done
  sleep 1 # drain trailing log lines
  kill "$LOG_PID" 2>/dev/null || true
  wait "$LOG_PID" 2>/dev/null || true

  if ! grep -q "home_initial_overlay_hidden" "$OUT_FILE" 2>/dev/null; then
    echo "  WARNING: run $i never reached home_initial_overlay_hidden within ${SETTLE_TIMEOUT_SECONDS}s" >&2
  fi
done

echo "Done. Analyze with: node scripts/analyzeHomeBootstrapPerf.mjs $OUT_DIR/${PREFIX}-run-*.log"
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x scripts/coldStartPerfRun.sh`

- [ ] **Step 4: Write the analysis script**

Create `scripts/analyzeHomeBootstrapPerf.mjs`:

```javascript
#!/usr/bin/env node
// Parses `app:perf` log lines captured by scripts/coldStartPerfRun.sh and
// emits the per-run gate table + last-blocker + percentiles as Markdown.
//
// Usage: node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/baseline-run-*.log

import { readFileSync } from 'node:fs';

const GATES = [
  { name: 'today', settled: 'home_today_ready' },
  { name: 'evolution', settled: 'home_evolution_ready' },
  { name: 'activitySnapshot', settled: 'home_activity_settled' },
  { name: 'frequency', settled: 'home_frequency_settled' },
  { name: 'supportInbox', settled: 'home_support_inbox_settled' },
];

// Matches compact `log stream` output containing our own JSON-ish payload:
// "... app:perf home_mount {msSinceAppEpoch: 4129}" (logDebug's exact
// formatting depends on the logger — this regex is deliberately loose:
// it captures the mark name and the msSinceAppEpoch number wherever they
// appear on the line).
const LINE_RE = /app:perf\s+([a-z_]+)\s.*?msSinceAppEpoch[:\s]+(\d+)/;

function parseRun(path) {
  const text = readFileSync(path, 'utf8');
  const marks = {};
  for (const line of text.split('\n')) {
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, mark, ms] = match;
    // First occurrence only — a mark logged twice inside one run is a
    // duplicate-read/re-render signal to report separately, not to average.
    if (!(mark in marks)) marks[mark] = Number(ms);
  }
  return marks;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: node scripts/analyzeHomeBootstrapPerf.mjs <log files...>');
    process.exit(1);
  }

  const runs = paths.map((path) => ({ path, marks: parseRun(path) }));

  console.log('# Home Bootstrap Perf — Run Table\n');
  console.log('| Run | home_mount | today | evolution | activity | frequency | support | dataSettled | overlayHidden | last blocker |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');

  const dataSettledSeries = [];
  const overlayHiddenSeries = [];
  const perGateSeries = Object.fromEntries(GATES.map((g) => [g.name, []]));
  const lastBlockerCounts = {};

  runs.forEach(({ path, marks }, i) => {
    const dataSettled = marks['home_initial_data_settled'] ?? null;
    const overlayHidden = marks['home_initial_overlay_hidden'] ?? null;
    if (dataSettled !== null) dataSettledSeries.push(dataSettled);
    if (overlayHidden !== null) overlayHiddenSeries.push(overlayHidden);

    let lastBlocker = null;
    let lastBlockerTime = -1;
    const cells = GATES.map((g) => {
      const t = marks[g.settled] ?? null;
      if (t !== null) {
        perGateSeries[g.name].push(t);
        if (t > lastBlockerTime) {
          lastBlockerTime = t;
          lastBlocker = g.name;
        }
      }
      return t === null ? 'MISSING' : `${t}ms`;
    });

    if (lastBlocker) lastBlockerCounts[lastBlocker] = (lastBlockerCounts[lastBlocker] ?? 0) + 1;

    console.log(
      `| ${i + 1} | ${marks['home_mount'] ?? 'MISSING'}ms | ${cells.join(' | ')} | ${dataSettled ?? 'MISSING'}ms | ${overlayHidden ?? 'MISSING'}ms | ${lastBlocker ?? 'UNKNOWN'} |`,
    );
  });

  function stats(label, series) {
    const sorted = [...series].sort((a, b) => a - b);
    if (sorted.length === 0) {
      console.log(`| ${label} | - | - | - | - | - |`);
      return;
    }
    console.log(
      `| ${label} | ${sorted[0]}ms | ${percentile(sorted, 50)}ms | ${percentile(sorted, 75)}ms | ${percentile(sorted, 95)}ms | ${sorted[sorted.length - 1]}ms |`,
    );
  }

  console.log('\n# Percentiles (min / p50 / p75 / p95 / max)\n');
  console.log('| Gate | min | p50 | p75 | p95 | max |');
  console.log('|---|---|---|---|---|---|');
  for (const g of GATES) stats(g.name, perGateSeries[g.name]);
  stats('dataSettled', dataSettledSeries);
  stats('overlayHidden', overlayHiddenSeries);

  console.log('\n# Last-blocker frequency\n');
  for (const [gate, count] of Object.entries(lastBlockerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${gate}: ${count}/${runs.length} runs`);
  }
}

main();
```

- [ ] **Step 5: Typecheck / lint sanity (scripts aren't part of `tsc` project, but confirm no syntax error)**

Run: `node --check scripts/analyzeHomeBootstrapPerf.mjs`
Expected: no output (valid syntax).

- [ ] **Step 6: Commit**

```bash
git add scripts/coldStartPerfRun.sh scripts/analyzeHomeBootstrapPerf.mjs .gitignore
git commit -m "chore: add cold-start capture and Home bootstrap perf analysis scripts"
```

---

## Task 7: Baseline — 10 real cold starts

**Files:** none checked in except the final report (Task 8); raw logs live in gitignored `perf-runs/`.

- [ ] **Step 1: Confirm Task 5's smoke check passed** (login-not-required assumption verified, marks appear).

- [ ] **Step 2: Run the batch**

```bash
scripts/coldStartPerfRun.sh 10 baseline
```

- [ ] **Step 3: Generate the table**

```bash
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/baseline-run-*.log | tee perf-runs/baseline-report.md
```

- [ ] **Step 4: Sanity-check the output against the regex assumption**

If any row shows `MISSING` for `home_mount` (a mark that always fires), the `LINE_RE` in `analyzeHomeBootstrapPerf.mjs` doesn't match this device's actual `log stream --style compact` line format — inspect one raw file (`head -20 perf-runs/baseline-run-1-*.log`) and adjust the regex before trusting any other numbers. Do not hand-edit the generated table.

- [ ] **Step 5: No commit yet** — raw data feeds Task 8's report, which is what gets committed.

---

## Task 8: Write the Phase 1 report (sections A–L)

**Files:**
- Create: `docs/home-bootstrap-perf-audit-phase1.md`

- [ ] **Step 1: Draft the report using the baseline data (Task 7) plus direct code citations for the audits below**

Use `docs/phase3-cache-audit.md` as the formatting precedent (prose + tables, file:line citations, explicit "not verified/out of scope" notes rather than invented numbers). Required sections, each grounded in either the captured data or a direct code citation — no invented numbers:

- **A. Baseline 10 runs** — paste `perf-runs/baseline-report.md`'s run table verbatim.
- **B. Critical path per run** — the same table, reformatted per the spec's column order (Today/Evolution/Activity/Weekly/Frequency/Support/dataSettled/last blocker).
- **C. p50/p75/p95** — from the analysis script's percentile table.
- **D. Waterfalls found** — state plainly, with citations:
  - Evolution's `load()` depends only on `activeProgram.programInstanceId` (`src/screens/AppShell.tsx:258`), i.e. on `prescription.status === 'SUCCESS'` (`AppShell.tsx:213-215`) — **not** on `schedule` resolving. Today's own gate additionally requires `schedule` to resolve (`homeInitialReadiness.ts:33-38`). So Evolution and Today's schedule-resolution run in parallel once prescription resolves, not serially. Confirm this against the Task 7 data: if Evolution's settle time consistently trails Today's by roughly Evolution's own internal duration (sum of its `evolution_reconcile_*`/`evolution_*` sub-mark deltas) rather than by Today's full duration, this is confirmed; if it trails by Today's *full* duration, the parallelism assumption is wrong and needs re-diagnosis before Phase 2.
  - `useWorkoutActivitySnapshot` and `useFrequencyWindow` both take `schedule.config?.timezone ?? deviceTimezone()` (`AppShell.tsx:269, 278`) but their fetch-triggering effects depend only on `uid`/`timezone` — since `deviceTimezone()` is synchronous, both hooks' Firestore reads start at Home mount, **not** after schedule resolves in practice (confirm via `home_activity_fetch_start`/`home_frequency_fetch_start` timestamps landing close to `home_mount` in the Task 7 data — if they don't, this reasoning is wrong and needs re-diagnosis).
  - `loadActiveWorkoutProgram` (`src/services/workoutPrograms.ts:401+`) is a serial chain: `loadWorkoutLifecycle` → (steady state) one `getDoc` for the program snapshot; migration/legacy paths add more sequential awaits. This is the Today/prescription critical path's own internal shape — cite the exact awaits and note there is currently **no** per-step mark inside this function (unlike Today's schedule-side marks in `today_*`) — flag as a candidate gap for Phase 1.5 if this function's own duration turns out to dominate Task 7's numbers.
- **E. Requests starting late** — from D, name any hook whose `_fetch_start` mark lands meaningfully after `home_mount` without a semantic reason found in the code.
- **F. Duplicate reads** — check for `home_activity_fetch_start`/`home_frequency_fetch_start` appearing twice in a single run's log (the regex in `analyzeHomeBootstrapPerf.mjs` only records the *first* occurrence — grep the raw file directly: `grep -c home_activity_fetch_start perf-runs/baseline-run-N-*.log` for each run; a count >1 confirms the timezone-fallback-refetch risk flagged in the investigation for `useWorkoutActivitySnapshot.ts:76` and `useFrequencyWindow.ts` — report which runs hit it and how often).
- **G. Cardinality** — `observeOwnSupportCases` (`src/services/supportCases.ts:117-123`) is `limit(50)` full `SupportCase` documents per snapshot, not an aggregate — cite as-is; no query-shape change here (Phase 2 concern).
- **H. Support inbox audit** — answer the spec's Passo 5 questions 1–9 directly from `src/services/supportCases.ts:117-123`, `src/lib/unreadSupportCasesCount.ts`, and `src/hooks/useUnreadSupportCasesCount.ts`:
  1. Why does it block Home? — Architectural choice in `homeInitialReadiness.ts:72` (`supportInbox: input.supportInboxStatus` is included unconditionally in the `allRequiredDataSettled` set) — not a technical necessity found elsewhere; note this plainly, don't editorialize about removing it (Passo 15 forbids removing without approval).
  2. How long does it take? — from Task 7's `home_support_inbox_settled` percentiles.
  3. When does it start? — `home_support_inbox_listener_start` vs `home_mount` delta from Task 7 (expect ~0, since it depends only on `uid`, already available at mount — confirm, don't assume).
  4. Depends on anything besides UID? — No; `useUnreadSupportCasesCount(user?.uid)` (`AppShell.tsx:363`) is the only input.
  5. Could it start immediately after auth? — Yes, per the code; it already effectively does (uid is available at Home mount). Cite Task 7 data to confirm empirically.
  6. Existing reusable listener/snapshot? — No; this is the only call site of `observeOwnSupportCases` active during Home bootstrap (SupportCasesScreen has its own, only mounted on navigation there).
  7. Duplicate reads? — Not from this hook itself (single `onSnapshot`, deps `[uid]` only, no refetch trigger). Note SupportCasesScreen's own separate listener as a distinct, non-overlapping-at-boot subscription.
  8. Querying a larger collection than necessary? — `limit(50)` full documents fetched to compute a boolean/aggregate (`unreadByUserCount` sum) — yes, this is over-fetch relative to "is there unread." Flag as **Category E** candidate (Passo 12) for Phase 2 — do not implement in this plan.
  9. Do we need full messages or just "is there unread"? — Per `countUnreadSupportCases`, only `unreadByUserCount` (a scalar already on each case doc) is read — messages subcollections are never touched by this path. The over-fetch is "50 full case docs" vs. "a single aggregate," not "case docs vs. message docs."
- **I. Frequency audit** — from Task 7's `home_frequency_fetch_start`/`home_frequency_network_ready`/`home_frequency_settled` deltas: network duration = `network_ready - fetch_start`; transformation+promotion duration = `settled - network_ready` (the synchronous `buildFrequencyWindow` promotion in `useFrequencyWindow.ts:128-141` — note this runs during render, not in the effect, so its cost is bundled into whatever render the `settled` mark's read reflects — call this out as a measurement caveat, not a bug). Cross-reference query count via `grep -c home_frequency_fetch_start` per run (Task 7 Step 4-adjacent check) for the duplicate-fetch risk already flagged in D.
- **J. Activity audit** — same structure as I, using `home_activity_fetch_start`/`home_activity_network_ready`/`home_activity_settled`.
- **K. Today audit** — using the *existing* `today_load_program_ready`/`today_schedule_config_ready`/`today_schedule_recovery_checked`/`today_schedule_resolved`/`today_prescription_handoff_used` marks already in `perf.ts` (already captured by Task 7's log stream — no new instrumentation needed) plus `home_mount`→`home_today_ready`. Explicitly check whether `today_prescription_handoff_used` fires in the Task 7 runs — if it doesn't, the bootstrap handoff optimization mentioned in the investigation (`useWorkoutPrescription.ts:33-57`) isn't landing, which would mean prescription is being resolved twice (once pre-AppShell, once by AppShell's own `reload()`) — this alone could be a meaningful chunk of the 9-12s if true. This is a **measurement finding**, not a code change, for this plan.
- **L. Evolution audit** — using the existing `evolution_reconcile_*`/`evolution_prepare_attempt_*`/`evolution_shell_visible`/`evolution_authoritative_ready` marks. Compare `home_evolution_ready` timing against the Sept 19 baseline in `docs/phase3-cache-audit.md` (mount→Evolution ≈ 5066ms) — state explicitly whether Task 7's numbers are in that range, worse, or better, and if worse, which `evolution_reconcile_*` sub-span grew.

Also include, as the spec's Passo 12 asks (still analysis, not a code change):

- **Classification table** — one row per gate (today/evolution/activitySnapshot/frequency/supportInbox), categorized A–E per the spec's definitions, with a one-line justification citing the file:line evidence gathered above.

- [ ] **Step 2: Cross-check every numeric claim in the draft against the actual `perf-runs/baseline-report.md` output** — no figure in the report may be invented or extrapolated from the Sept 19 doc; the Sept 19 numbers are for comparison only, labeled as such.

- [ ] **Step 3: Commit**

```bash
git add docs/home-bootstrap-perf-audit-phase1.md
git commit -m "docs: Home bootstrap perf audit phase 1 — baseline, critical path, gate audits"
```

---

## Explicitly out of scope for this plan

- Any change to `homeInitialReadiness.ts`'s gate *set* or `useHomeInitialVisualReady.ts`'s state machine.
- Any change to `supportCases.ts` query shape, `useWorkoutActivitySnapshot`/`useFrequencyWindow`'s timezone-fallback behavior, or the prescription chain — even where D/F/H/K above surface a plausible fix. Those are Phase 2, and require the user's explicit go-ahead on this report's findings first (Passo 15/19).
- Deciding whether Support Inbox should stop blocking Home — H.1 documents the finding; removing it from the gate needs explicit approval per Passo 15, not a default in Phase 2 either.

## Self-review notes

- Spec coverage: Passos 1 (instrumentation) → Task 1-4; Passo 2 (10 cold starts) → Task 7; Passo 3 (critical path/parallel vs waterfall) → Report D; Passo 4 (late-starting requests) → Report E; Passo 5 (support inbox 9 questions) → Report H; Passo 6 (frequency breakdown) → Report I; Passo 7 (activity/weekly) → Report J; Passo 8 (Today) → Report K; Passo 9 (Evolution vs ~4-5s historical) → Report L; Passo 10 (Firestore reads/cardinality/duplicates) → Report F/G; Passo 11 (AsyncStorage not gating network) → covered by L's note that `EvolutionSummaryPresentationCache`'s read already doesn't gate `load()` (confirmed in the initial investigation, `useWorkoutEvolution.ts:323,337` — cite directly in Report L, no new work needed since it's already correct); Passo 12 (classification A-E) → Report's classification table.
- No placeholders: every task step has literal, complete code (Tasks 1-4) or complete scripts (Task 6); Task 7/8 are measurement/writing steps with explicit "what if the assumption is wrong" fallbacks rather than glossed-over "handle edge cases."
- Type consistency: `PerfMark` additions in Task 1 are referenced by exact string literal in Tasks 2-4's `recordPerfMark(...)` calls — verified matching spelling.

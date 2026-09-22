#!/usr/bin/env node
// Parses `app:perf` log lines captured by scripts/coldStartPerfRun.sh (tailed
// from Metro's own stdout — see that script's header for why) and emits the
// per-run gate table + last-blocker + percentiles as Markdown.
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

// Matches Metro's own console.debug formatting for recordPerfMark/
// recordPerfTrace, e.g.:
//   " DEBUG  [app:perf] home_mount {"msSinceAppEpoch": 5810}"
// recordPerfTrace lines carry extra JSON keys after msSinceAppEpoch — this
// only needs the mark name and the leading msSinceAppEpoch value, so it
// doesn't need to parse the full JSON object.
const LINE_RE = /\[app:perf\]\s+([A-Za-z0-9_.]+)\s+\{"msSinceAppEpoch":\s*(\d+)/;

// startPerfTimer spans log only `{"durationMs": N}` (no msSinceAppEpoch) —
// intentionally not matched by LINE_RE; not part of the gate table.

// countFirestoreRead's own line shape (perf.ts:111-116): no msSinceAppEpoch,
// a running per-label `count` instead — e.g.
//   [app:perf] firestore_read {"count": 4, "label": "workout_lifecycle.bundle"}
// The max `count` seen for a label in one run IS that run's duplicate-read
// count for that logical document/query.
const FIRESTORE_READ_RE = /\[app:perf\]\s+firestore_read\s+\{"count":\s*(\d+),\s*"label":\s*"([^"]+)"/;

function parseRun(path) {
  const text = readFileSync(path, 'utf8');
  const firstSeen = {};
  const occurrences = {};
  const firestoreReadMaxCount = {};
  for (const line of text.split('\n')) {
    const frMatch = FIRESTORE_READ_RE.exec(line);
    if (frMatch) {
      const [, count, label] = frMatch;
      firestoreReadMaxCount[label] = Math.max(firestoreReadMaxCount[label] ?? 0, Number(count));
      continue;
    }
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, mark, ms] = match;
    occurrences[mark] = (occurrences[mark] ?? 0) + 1;
    // First occurrence only — a mark logged twice inside one run is a
    // duplicate-read/re-render signal to report separately (see
    // `occurrences`), not to average into the gate table.
    if (!(mark in firstSeen)) firstSeen[mark] = Number(ms);
  }
  return { marks: firstSeen, occurrences, firestoreReadMaxCount };
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
  // Shell glob expansion is lexicographic (run-10 sorts before run-2) —
  // re-sort by the numeric run index embedded in the filename so the
  // printed "Run N" column matches chronological execution order.
  paths.sort((a, b) => {
    const na = Number(/-run-(\d+)-/.exec(a)?.[1] ?? 0);
    const nb = Number(/-run-(\d+)-/.exec(b)?.[1] ?? 0);
    return na - nb;
  });

  const runs = paths.map((path) => ({ path, ...parseRun(path) }));

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

  console.log('\n# Marks that fired more than once per run (excluding firestore_read, which is a counter by design)\n');
  runs.forEach(({ path, occurrences }, i) => {
    const repeats = Object.entries(occurrences).filter(([mark, count]) => mark !== 'firestore_read' && count > 1);
    if (repeats.length === 0) return;
    console.log(`- Run ${i + 1} (${path}): ${repeats.map(([mark, count]) => `${mark}×${count}`).join(', ')}`);
  });

  console.log('\n# Firestore reads per logical document/query, max count seen in a single run (>1 = duplicate read within that cold start)\n');
  runs.forEach(({ path, firestoreReadMaxCount }, i) => {
    const dupes = Object.entries(firestoreReadMaxCount).filter(([, count]) => count > 1);
    if (dupes.length === 0) return;
    console.log(`- Run ${i + 1} (${path}): ${dupes.map(([label, count]) => `${label}×${count}`).join(', ')}`);
  });
}

main();

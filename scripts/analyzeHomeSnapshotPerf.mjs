#!/usr/bin/env node
// Usage: node scripts/analyzeHomeSnapshotPerf.mjs perf-runs/gatefinal-run-*.log -- perf-runs/snapshot-final-run-*.log
import { readFileSync } from 'node:fs';

const separator = process.argv.indexOf('--');
if (separator < 3 || separator === process.argv.length - 1) {
  console.error('Usage: analyzeHomeSnapshotPerf.mjs <baseline logs...> -- <snapshot logs...>');
  process.exit(1);
}
const pattern = /\[app:perf\]\s+([A-Za-z0-9_.]+)\s+\{"msSinceAppEpoch":\s*(\d+)/;
function readRuns(paths) {
  return paths.sort((a, b) => Number(/-run-(\d+)-/.exec(a)?.[1] ?? 0) - Number(/-run-(\d+)-/.exec(b)?.[1] ?? 0)).map((path) => {
    const marks = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = pattern.exec(line);
      if (match && marks[match[1]] === undefined) marks[match[1]] = Number(match[2]);
    }
    return marks;
  });
}
const baseline = readRuns(process.argv.slice(2, separator));
const after = readRuns(process.argv.slice(separator + 1));
function percentile(sorted, p) {
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length / 100) - 1))];
}
function row(label, values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return `| ${label} | 0 | — | — | — | — | — |`;
  return `| ${label} | ${sorted.length} | ${sorted[0]} | ${percentile(sorted, 50)} | ${percentile(sorted, 75)} | ${percentile(sorted, 95)} | ${sorted.at(-1)} |`;
}
const from = (runs, mark) => runs.map((run) => run[mark]);
const span = (runs, start, end) => runs.map((run) => Number.isFinite(run[start]) && Number.isFinite(run[end])
  ? run[end] - run[start] : NaN);

console.log('| Métrica (ms) | n | min | p50 | p75 | p95 | max |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
console.log(row('Antes: app launch → Home visual', from(baseline, 'home_initial_overlay_hidden')));
console.log(row('Depois: app launch → cached Home visible', from(after, 'home_snapshot_overlay_hidden')));
console.log(row('Depois: route APP → cached Home visible', span(after, 'premium_gate_resolved_app', 'home_snapshot_overlay_hidden')));
console.log(row('Depois: app launch → authoritative Home ready', from(after, 'home_authoritative_ready')));
console.log(row('Antes: app launch → authoritative Home ready', from(baseline, 'home_initial_overlay_hidden')));
console.log('\n| Run | app_epoch | route APP | read | hit | applied | layout | visual ready | cached visible | data settled | authoritative ready |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
after.forEach((run, index) => console.log(`| ${index + 1} | ${run.app_epoch ?? '—'} | ${run.premium_gate_resolved_app ?? '—'} | ${run.home_snapshot_read_start ?? '—'} | ${run.home_snapshot_hit ?? '—'} | ${run.home_snapshot_applied ?? '—'} | ${run.home_snapshot_layout_committed ?? '—'} | ${run.home_snapshot_visual_ready ?? '—'} | ${run.home_snapshot_overlay_hidden ?? '—'} | ${run.home_authoritative_data_settled ?? '—'} | ${run.home_authoritative_ready ?? '—'} |`));

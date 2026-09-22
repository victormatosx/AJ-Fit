#!/usr/bin/env node
// Usage: node scripts/analyzeSnapshotAbGate.mjs perf-runs/abgate-kept-off-run-*.log -- perf-runs/abgate-kept-on-run-*.log
import { readFileSync } from 'node:fs';

const separator = process.argv.indexOf('--');
if (separator < 3 || separator === process.argv.length - 1) {
  console.error('Usage: analyzeSnapshotAbGate.mjs <off logs...> -- <on logs...>');
  process.exit(1);
}
const pattern = /\[app:perf\]\s+([A-Za-z0-9_.]+)\s+\{"msSinceAppEpoch":\s*(\d+)/;
const firestorePattern = /\[app:perf\]\s+firestore_read\s+\{"count":\s*(\d+),\s*"label":\s*"([^"]+)"/;

function runIndex(path) {
  return Number(/-run-(\d+)-/.exec(path)?.[1] ?? 0);
}

function readRuns(paths) {
  return paths.sort((a, b) => runIndex(a) - runIndex(b)).map((path) => {
    const marks = {};
    const firestoreMax = {};
    let complete = false;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = pattern.exec(line);
      if (match && marks[match[1]] === undefined) marks[match[1]] = Number(match[2]);
      const fmatch = firestorePattern.exec(line);
      if (fmatch) {
        const [, count, label] = fmatch;
        firestoreMax[label] = Math.max(firestoreMax[label] ?? 0, Number(count));
      }
      if (line.includes('home_authoritative_ready')) complete = true;
    }
    return { path, marks, firestoreMax, complete };
  });
}

const off = readRuns(process.argv.slice(2, separator));
const on = readRuns(process.argv.slice(separator + 1));

function percentile(sorted, p) {
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length / 100) - 1))];
}
function stats(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, min: '—', p50: '—', p75: '—', p95: '—', max: '—' };
  return {
    n: sorted.length, min: sorted[0], p50: percentile(sorted, 50),
    p75: percentile(sorted, 75), p95: percentile(sorted, 95), max: sorted.at(-1),
  };
}
function row(label, values) {
  const s = stats(values);
  return `| ${label} | ${s.n} | ${s.min} | ${s.p50} | ${s.p75} | ${s.p95} | ${s.max} |`;
}
const span = (runs, start, end) => runs.filter((r) => r.complete).map((r) =>
  Number.isFinite(r.marks[start]) && Number.isFinite(r.marks[end]) ? r.marks[end] - r.marks[start] : NaN);
const mark = (runs, m) => runs.filter((r) => r.complete).map((r) => r.marks[m]);

console.log(`## Completude\n`);
console.log(`OFF: ${off.filter((r) => r.complete).length}/${off.length} completos (home_authoritative_ready).`);
console.log(`ON: ${on.filter((r) => r.complete).length}/${on.length} completos (home_authoritative_ready).\n`);

console.log('## Comparação principal (ms, apenas runs completos)\n');
console.log('| Métrica | Modo | n | min | p50 | p75 | p95 | max |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|');
console.log(`| app_root -> home_authoritative_ready | OFF |${row('', mark(off, 'home_authoritative_ready')).slice(1)}`.replace('|  |', '|'));
console.log(row('app_root -> home_authoritative_ready | ON', mark(on, 'home_authoritative_ready')));
console.log(row('premium_gate_resolved_app -> home_authoritative_ready | OFF', span(off, 'premium_gate_resolved_app', 'home_authoritative_ready')));
console.log(row('premium_gate_resolved_app -> home_authoritative_ready | ON', span(on, 'premium_gate_resolved_app', 'home_authoritative_ready')));
console.log(row('home_mount -> home_evolution_ready | OFF', span(off, 'home_mount', 'home_evolution_ready')));
console.log(row('home_mount -> home_evolution_ready | ON', span(on, 'home_mount', 'home_evolution_ready')));
console.log(row('app_root -> home_initial_data_settled | OFF', mark(off, 'home_initial_data_settled')));
console.log(row('app_root -> home_initial_data_settled | ON', mark(on, 'home_initial_data_settled')));

console.log('\n## Fast path ON-only (ms, apenas runs completos)\n');
console.log('| Métrica | n | min | p50 | p75 | p95 | max |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
console.log(row('app_root -> home_snapshot_overlay_hidden', mark(on, 'home_snapshot_overlay_hidden')));
console.log(row('premium_gate_resolved_app -> home_snapshot_overlay_hidden', span(on, 'premium_gate_resolved_app', 'home_snapshot_overlay_hidden')));
console.log(row('home_snapshot_read_start -> home_snapshot_applied (local cost)', span(on, 'home_snapshot_read_start', 'home_snapshot_applied')));
console.log(row('home_snapshot_applied -> home_snapshot_layout_committed', span(on, 'home_snapshot_applied', 'home_snapshot_layout_committed')));
console.log(row('home_snapshot_layout_committed -> home_snapshot_visual_ready', span(on, 'home_snapshot_layout_committed', 'home_snapshot_visual_ready')));

console.log('\n## Per-run raw table\n');
console.log('| Run | Mode | complete | app_root offset | route APP | home_mount | evolution settled | dataSettled | authoritative ready | snapshot overlay hidden |');
console.log('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|');
[...off, ...on].sort((a, b) => runIndex(a.path) - runIndex(b.path) || a.path.localeCompare(b.path)).forEach((r) => {
  const mode = r.path.includes('-off-') ? 'OFF' : 'ON';
  console.log(`| ${runIndex(r.path)} | ${mode} | ${r.complete ? 'yes' : 'NO'} | ${r.marks.app_epoch ?? '—'} | ${r.marks.premium_gate_resolved_app ?? '—'} | ${r.marks.home_mount ?? '—'} | ${r.marks.home_evolution_ready ?? '—'} | ${r.marks.home_initial_data_settled ?? '—'} | ${r.marks.home_authoritative_ready ?? '—'} | ${r.marks.home_snapshot_overlay_hidden ?? '—'} |`);
});

console.log('\n## Firestore read counts (max per label, apenas completos)\n');
const labels = new Set();
[...off, ...on].filter((r) => r.complete).forEach((r) => Object.keys(r.firestoreMax).forEach((l) => labels.add(l)));
console.log('| Label | OFF max (across runs) | OFF median max | ON max (across runs) | ON median max |');
console.log('|---|---:|---:|---:|---:|');
for (const label of [...labels].sort()) {
  const offVals = off.filter((r) => r.complete).map((r) => r.firestoreMax[label] ?? 0);
  const onVals = on.filter((r) => r.complete).map((r) => r.firestoreMax[label] ?? 0);
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  console.log(`| ${label} | ${Math.max(...offVals, 0)} | ${med(offVals)} | ${Math.max(...onVals, 0)} | ${med(onVals)} |`);
}

console.log('\n## Falhas (timeout, nunca chegou home_authoritative_ready)\n');
[...off, ...on].filter((r) => !r.complete).sort((a,b) => a.path.localeCompare(b.path)).forEach((r) => {
  console.log(`- ${r.path}`);
});

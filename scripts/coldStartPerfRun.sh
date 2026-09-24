#!/usr/bin/env bash
# Drives N cold starts of the AJ Fit dev build on the currently-booted
# Simulator and captures each run's `app:perf` log lines to its own file.
#
# Assumes: simulator booted, app installed, app already has a persisted
# authenticated session (cold start here = process kill + relaunch, never a
# fresh login) — verified once via Task 5 of
# docs/superpowers/plans/2026-09-22-home-bootstrap-perf-audit-phase1.md.
#
# IMPORTANT (discovered in Task 5): `xcrun simctl spawn booted log stream`
# captures nothing — Hermes/RN's New Architecture console output never
# reaches the OS unified log. This script instead tails the Metro dev
# server's OWN stdout, which DOES receive every `console.debug(...)` line.
# You must start Metro yourself first with the perf flag set, e.g.:
#   EXPO_PUBLIC_PERF_TRACE=1 npx expo start --port 8082 > /tmp/metro-perf.log 2>&1 &
# and pass that log file as METRO_LOG_FILE (env var) or the 3rd arg.
#
# Usage: scripts/coldStartPerfRun.sh <run-count> [output-prefix] [metro-log-file]
set -euo pipefail

RUN_COUNT="${1:?usage: coldStartPerfRun.sh <run-count> [output-prefix] [metro-log-file]}"
PREFIX="${2:-baseline}"
METRO_LOG_FILE="${3:-${METRO_LOG_FILE:-/tmp/metro-perf-8082.log}}"
BUNDLE_ID="com.ajfit.app"
OUT_DIR="perf-runs"
SETTLE_TIMEOUT_SECONDS=30

mkdir -p "$OUT_DIR"

if [ ! -f "$METRO_LOG_FILE" ]; then
  echo "Metro log file not found: $METRO_LOG_FILE" >&2
  echo "Start Metro with EXPO_PUBLIC_PERF_TRACE=1 and redirect its output there first." >&2
  exit 1
fi

BOOTED=$(xcrun simctl list devices booted | grep -c "Booted" || true)
if [ "$BOOTED" -eq 0 ]; then
  echo "No booted simulator found. Boot the iPhone 17 Pro Simulator first." >&2
  exit 1
fi

for i in $(seq 1 "$RUN_COUNT"); do
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  OUT_FILE="$OUT_DIR/${PREFIX}-run-${i}-${TIMESTAMP}.log"
  echo "== Run $i/$RUN_COUNT -> $OUT_FILE =="

  # Byte offset instead of line count: robust even if Metro writes a
  # partial line right at the boundary.
  START_OFFSET=$(wc -c < "$METRO_LOG_FILE" | tr -d ' ')

  xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
  sleep 1
  xcrun simctl launch booted "$BUNDLE_ID" >/dev/null

  ELAPSED=0
  while [ "$ELAPSED" -lt "$SETTLE_TIMEOUT_SECONDS" ]; do
    if tail -c +"$((START_OFFSET + 1))" "$METRO_LOG_FILE" | grep -q "home_initial_overlay_hidden"; then
      break
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done
  sleep 1 # drain trailing log lines for the same event batch

  tail -c +"$((START_OFFSET + 1))" "$METRO_LOG_FILE" > "$OUT_FILE"

  if ! grep -q "home_initial_overlay_hidden" "$OUT_FILE"; then
    echo "  WARNING: run $i never reached home_initial_overlay_hidden within ${SETTLE_TIMEOUT_SECONDS}s" >&2
  fi
done

echo "Done. Analyze with: node scripts/analyzeHomeBootstrapPerf.mjs $OUT_DIR/${PREFIX}-run-*.log"

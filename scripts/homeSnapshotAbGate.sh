#!/usr/bin/env bash
# Intercalated SNAPSHOT_OFF / SNAPSHOT_ON A/B gate for the Home Presentation
# Snapshot. Toggles src/dev/homeSnapshotAbFlag.ts between runs (Metro serves
# the updated transform on the next bundle fetch — no Metro restart needed),
# then does a cold app relaunch + explicit dev-client deep link (bare
# `simctl launch` sometimes lands on the dev-client launcher screen instead
# of connecting, per docs/home-presentation-snapshot-report.md's own note).
set -euo pipefail

PAIR_COUNT="${1:?usage: homeSnapshotAbGate.sh <pair-count> <warmup-pairs>}"
WARMUP_PAIRS="${2:?usage: homeSnapshotAbGate.sh <pair-count> <warmup-pairs>}"
FLAG_FILE="src/dev/homeSnapshotAbFlag.ts"
METRO_LOG="/tmp/metro-snapshot-ab-gate.log"
BUNDLE_ID="com.ajfit.app"
DEV_CLIENT_URL="ajfit://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
OUT_DIR="perf-runs"
SETTLE_TIMEOUT_SECONDS=35

mkdir -p "$OUT_DIR"

set_mode() {
  local mode="$1"
  if [ "$mode" = "on" ]; then
    printf 'export const HOME_SNAPSHOT_FAST_PATH_ENABLED = true;\n' > /tmp/ab-flag-body.txt
  else
    printf 'export const HOME_SNAPSHOT_FAST_PATH_ENABLED = false;\n' > /tmp/ab-flag-body.txt
  fi
  {
    printf '/**\n * TEST-ONLY, DEV-only kill switch for the Home Presentation Snapshot A/B gate.\n * See docs/home-presentation-snapshot-ab-gate-final.md. Toggled by the harness.\n */\n'
    cat /tmp/ab-flag-body.txt
  } > "$FLAG_FILE"
  sleep 1.5
}

run_one() {
  local mode="$1" tag="$2" index="$3"
  local out_file="$OUT_DIR/abgate-${tag}-${mode}-run-${index}-$(date +%Y%m%d-%H%M%S).log"
  local start_offset
  start_offset=$(wc -c < "$METRO_LOG" | tr -d ' ')

  xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
  sleep 1
  xcrun simctl launch booted "$BUNDLE_ID" >/dev/null
  sleep 0.8
  xcrun simctl openurl booted "$DEV_CLIENT_URL" >/dev/null 2>&1 || true

  local elapsed=0
  while [ "$elapsed" -lt "$SETTLE_TIMEOUT_SECONDS" ]; do
    if tail -c +"$((start_offset + 1))" "$METRO_LOG" | grep -q "home_authoritative_ready"; then
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  sleep 1

  tail -c +"$((start_offset + 1))" "$METRO_LOG" > "$out_file"

  if ! grep -q "home_authoritative_ready" "$out_file"; then
    echo "  WARNING: ${tag}/${mode} run ${index} never reached home_authoritative_ready within ${SETTLE_TIMEOUT_SECONDS}s" >&2
  fi
  echo "$out_file"
}

TOTAL=$((PAIR_COUNT + WARMUP_PAIRS))
for i in $(seq 1 "$TOTAL"); do
  tag="kept"
  if [ "$i" -le "$WARMUP_PAIRS" ]; then tag="warmup"; fi

  echo "== Pair $i/$TOTAL ($tag): OFF =="
  set_mode off
  f=$(run_one off "$tag" "$i")
  echo "   -> $f"

  echo "== Pair $i/$TOTAL ($tag): ON =="
  set_mode on
  f=$(run_one on "$tag" "$i")
  echo "   -> $f"
done

echo "Done. $PAIR_COUNT kept pairs + $WARMUP_PAIRS warmup pairs written to $OUT_DIR/abgate-*.log"

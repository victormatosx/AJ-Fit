#!/usr/bin/env bash
#
# Photo Vault — Cloud KMS setup (KeyRing + KEK + least-privilege IAM).
#
# Creates ONLY new, Photo-Vault-specific resources. It never deletes,
# disables or modifies anything that already exists, never touches other
# features' keys, and never grants project-wide IAM.
#
# Idempotent: every step checks for the resource first, so re-running is
# safe and reports "already exists" instead of failing.
#
#   IRREVERSIBLE: Google Cloud KMS KeyRings and CryptoKeys can NEVER be
#   deleted — only key VERSIONS can be destroyed. Once this script creates
#   `ajfit-photo-vault/photo-vault-kek`, those resource names are permanent
#   in the project. Review the plan it prints before confirming.
#
# Usage:
#   ./scripts/setup-photo-vault-kms.sh --project <PROJECT_ID>            # dry run
#   ./scripts/setup-photo-vault-kms.sh --project <PROJECT_ID> --apply    # execute
#
# Requires: gcloud authenticated with rights to enable services, create KMS
# resources and set IAM policy on the created key.

set -euo pipefail

# ── Photo Vault constants — must match functions/src/photoVault/kmsClient.ts ──
readonly LOCATION="us-central1"
readonly KEY_RING="ajfit-photo-vault"
readonly CRYPTO_KEY="photo-vault-kek"
readonly ROTATION_PERIOD="7776000s"   # 90 days
readonly KMS_ROLE="roles/cloudkms.cryptoKeyEncrypterDecrypter"

PROJECT_ID=""
APPLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="${2:-}"; shift 2 ;;
    --apply)   APPLY="true"; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# No default project, ever: the caller must name the target explicitly so a
# stray invocation cannot land on whatever `gcloud config` happens to hold.
if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: --project <PROJECT_ID> is required (no default, by design)." >&2
  exit 2
fi

say() { printf '%s\n' "$*"; }
step() { printf '\n▸ %s\n' "$*"; }

run() {
  if [[ "$APPLY" == "true" ]]; then
    "$@"
  else
    say "    [dry run] $*"
  fi
}

# ── Preflight ────────────────────────────────────────────────────────────────
step "Preflight"

if ! gcloud projects describe "$PROJECT_ID" --format="value(projectId)" >/dev/null 2>&1; then
  echo "ERROR: project '$PROJECT_ID' not found or not accessible." >&2
  exit 1
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
# Gen 2 Cloud Functions run as the default compute service account unless a
# dedicated one is configured. Confirmed against the deployed function.
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

BILLING_ENABLED="$(gcloud billing projects describe "$PROJECT_ID" \
  --format='value(billingEnabled)' 2>/dev/null || echo "unknown")"
if [[ "$BILLING_ENABLED" != "True" ]]; then
  echo "ERROR: billing is not confirmed enabled on '$PROJECT_ID' (got: $BILLING_ENABLED)." >&2
  echo "       Cloud KMS requires an active billing account." >&2
  exit 1
fi

say "    project:      $PROJECT_ID ($PROJECT_NUMBER)"
say "    location:     $LOCATION"
say "    key ring:     $KEY_RING"
say "    crypto key:   $CRYPTO_KEY"
say "    rotation:     $ROTATION_PERIOD (90 days)"
say "    runtime SA:   $RUNTIME_SA"
say "    role granted: $KMS_ROLE (on the CryptoKey only)"

if [[ "$APPLY" != "true" ]]; then
  say ""
  say "DRY RUN — nothing will be created. Re-run with --apply to execute."
fi

# ── Confirmation ─────────────────────────────────────────────────────────────
if [[ "$APPLY" == "true" ]]; then
  say ""
  say "This creates PERMANENT, UNDELETABLE KMS resources in '$PROJECT_ID'."
  read -r -p "Type the project id to confirm: " CONFIRM
  if [[ "$CONFIRM" != "$PROJECT_ID" ]]; then
    echo "Aborted: confirmation did not match." >&2
    exit 1
  fi
fi

# ── 1. Enable the Cloud KMS API ──────────────────────────────────────────────
step "Cloud KMS API"
if gcloud services list --enabled --project "$PROJECT_ID" \
     --format='value(config.name)' 2>/dev/null | grep -q '^cloudkms.googleapis.com$'; then
  say "    already enabled"
else
  say "    enabling cloudkms.googleapis.com"
  run gcloud services enable cloudkms.googleapis.com --project "$PROJECT_ID"

  # Enabling returns before the API is actually usable — the first KMS call
  # can still fail with PERMISSION_DENIED for a few minutes. Poll until a
  # harmless read succeeds instead of guessing a sleep duration.
  if [[ "$APPLY" == "true" ]]; then
    say "    waiting for the API to propagate"
    for attempt in $(seq 1 30); do
      if gcloud kms keyrings list --location "$LOCATION" \
           --project "$PROJECT_ID" >/dev/null 2>&1; then
        say "    ready after ${attempt} attempt(s)"
        break
      fi
      if [[ "$attempt" -eq 30 ]]; then
        echo "ERROR: Cloud KMS API still not usable after ~5 minutes." >&2
        echo "       This is normal propagation lag — simply re-run this script." >&2
        exit 1
      fi
      sleep 10
    done
  fi
fi

# ── 2. KeyRing ───────────────────────────────────────────────────────────────
step "KeyRing '$KEY_RING'"
if gcloud kms keyrings describe "$KEY_RING" \
     --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  say "    already exists"
else
  say "    creating"
  run gcloud kms keyrings create "$KEY_RING" \
    --location "$LOCATION" --project "$PROJECT_ID"
fi

# ── 3. CryptoKey (the KEK) ───────────────────────────────────────────────────
step "CryptoKey '$CRYPTO_KEY'"
if gcloud kms keys describe "$CRYPTO_KEY" \
     --keyring "$KEY_RING" --location "$LOCATION" \
     --project "$PROJECT_ID" >/dev/null 2>&1; then
  say "    already exists (rotation policy left untouched)"
else
  say "    creating symmetric encryption key with 90-day rotation"
  run gcloud kms keys create "$CRYPTO_KEY" \
    --keyring "$KEY_RING" \
    --location "$LOCATION" \
    --project "$PROJECT_ID" \
    --purpose "encryption" \
    --default-algorithm "google-symmetric-encryption" \
    --rotation-period "$ROTATION_PERIOD" \
    --next-rotation-time "$(date -u -v+90d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
        || date -u -d '+90 days' '+%Y-%m-%dT%H:%M:%SZ')"
fi

# ── 4. Least-privilege IAM, scoped to this CryptoKey only ────────────────────
step "IAM binding for the Functions runtime"
if gcloud kms keys get-iam-policy "$CRYPTO_KEY" \
     --keyring "$KEY_RING" --location "$LOCATION" --project "$PROJECT_ID" \
     --format=json 2>/dev/null \
   | grep -q "serviceAccount:${RUNTIME_SA}"; then
  say "    binding already present"
else
  say "    granting $KMS_ROLE on the CryptoKey to $RUNTIME_SA"
  run gcloud kms keys add-iam-policy-binding "$CRYPTO_KEY" \
    --keyring "$KEY_RING" \
    --location "$LOCATION" \
    --project "$PROJECT_ID" \
    --member "serviceAccount:${RUNTIME_SA}" \
    --role "$KMS_ROLE"
fi

step "Done"
if [[ "$APPLY" == "true" ]]; then
  say "    Photo Vault KMS resources are ready in '$PROJECT_ID'."
else
  say "    Dry run complete. Re-run with --apply to execute."
fi

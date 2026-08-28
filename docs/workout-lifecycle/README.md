# AJ Fit — Workout Lifecycle

**Status:** Documentation index  
**Target specification:** `v2/`  
**Current runtime baseline:** Progression Engine V1 audited on 2026-08-28

This directory separates the currently implemented lifecycle from the approved target model. The V2 documents are **TARGET_SPEC** unless explicitly marked otherwise; they must not be interpreted as already implemented.

## Navigation
- `v2/00_OVERVIEW.md` — start here.
- `v2/01_PRODUCT_PRINCIPLES.md` — non-negotiable product principles.
- `v2/02_DOMAIN_MODEL.md` — canonical vocabulary.
- `v2/03_USER_JOURNEY.md` — end-to-end journey.
- `v2/progression/` — when a user advances.
- `v2/prescription/` — how the next program changes.
- `v2/gamification/` — UX and future XP boundary.
- `v2/architecture/` — target technical model.
- `v2/product/` — user-facing states and copy.
- `v2/decisions/` — ADRs recording durable decisions.

## Baseline from the V1 audit
V1 already has deterministic prescription, active-program pointer, Schedule, Execution, Beginner stages, progression evaluation and progression ledger. Its main architectural limitation is that `programId` currently identifies both program content/identity and lifecycle cycle. Normal rotation can therefore reactivate the same program and overwrite activation semantics. V2 addresses this conceptually before implementation.

## Documentation rule
When implementation begins, update each document's `Implementation` field to `PARTIAL` or `IMPLEMENTED` only after code and tests prove it. Never update docs optimistically.

# Prescription on Level Promotion

**Status:** TARGET_SPEC
**Implementation:** PARTIAL — the re-prescription mechanism is implemented and frequency-preservation is proven end-to-end (architecture/09_PHASE_3_IMPLEMENTATION.md). BEGINNER→INTERMEDIATE is fully supported; INTERMEDIATE→ADVANCED is classified BLOCKED_BY_DATASET for structural content differentiation (ADR-008) — the template catalog has no Advanced-specific branch today.

Level Promotion is a structural re-prescription. The engine should prescribe as if the user's **current training level** were the promoted level while preserving current user-owned constraints: goal, available days, environment/equipment and safety limitations.

A promotion may change template, split, exercise selection, volume structure and other level-sensitive prescription rules. It must never increase weekly availability automatically. The original questionnaire level remains historical and must not force future prescriptions back to the starting tier.

# Idempotency and Concurrency

Every transition must converge safely across retries, cold starts and multiple devices. Stable event/transition IDs should prevent duplicate cycle completion, duplicate promotion and duplicate future XP rewards.

A progression apply should behave as exactly-once from the domain perspective even if infrastructure retries. Eligibility must be revalidated against the expected active ProgramInstance/cycle inside the authoritative write boundary.

The V1 audit found convergence without strict exactly-once reporting and a composed execution→schedule→progression chain with failure/race risks. V2 implementation planning must address these before relying on adherence for rewards.

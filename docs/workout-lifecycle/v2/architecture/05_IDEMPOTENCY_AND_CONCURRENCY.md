# Idempotency and Concurrency

**Implementation:** IMPLEMENTED for lifecycle authority and transitions through Phase 8B. Reward consumption remains future work.

Every transition must converge safely across retries, cold starts and multiple devices. Stable event/transition IDs should prevent duplicate cycle completion, duplicate promotion and duplicate future XP rewards.

A progression apply should behave as exactly-once from the domain perspective even if infrastructure retries. Eligibility must be revalidated against the expected active ProgramInstance/cycle inside the authoritative write boundary.

Phase 1 addresses the two integrity risks: Schedule advances only after a
persisted terminal execution, and `finish()` flushes the serialized set-write
queue before it can write the terminal snapshot. Domain transitions use stable
operation keys and transaction checks. Reward consumption remains future work.

## Optimistic prepare and safety precedence (Phase 8B)

Preparation is `read expected base → compute outside transaction → CAS`.
The CAS compares active ProgramInstance, TrainingCycle and input snapshot. A
stale compute is abandoned and can be regenerated; no orphan target
ProgramInstance is persisted during prepare. The logical earned idempotency
key deterministically derives pending/target identities.

Adaptation and activation race on the authoritative lifecycle transaction.
Whichever commits first, new safety inputs win: activation against an older
source fails CAS, while adaptation after activation layers the new limitation
onto the now-current prescription. At most one instance remains active.

Firestore Emulator proofs cover Prepare/Prepare, Start/Start, Start/Defer,
Defer/Defer, Manual/Auto, Auto/Auto, Adaptation/Prepare,
Adaptation/Activation, Migration/Migration, migration/post-workout bootstrap,
double finish and simultaneous progression. Event cardinality is asserted,
not inferred from UI guards.

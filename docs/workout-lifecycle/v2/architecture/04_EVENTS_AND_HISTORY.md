# Events and History

**Implementation:** IMPLEMENTED for current domain facts; the three conceptual cycle events remain intentionally represented by TrainingCycle timestamps/fields instead of redundant ledger records.

Target domain events include: `PROGRAM_STARTED`, `PROGRAM_ADAPTED`, `CYCLE_STARTED`, `CYCLE_ELIGIBLE`, `CYCLE_COMPLETED`, `EVOLUTION_EARNED`, `EVOLUTION_DEFERRED`, `EVOLUTION_ACTIVATED`, `MOTIVATIONAL_RENEWAL_OFFERED`, `MOTIVATIONAL_RENEWAL_ACTIVATED`, `LEVEL_PROMOTED`.

These are conceptual facts; they need not each become separate Firestore documents. Persistence must nevertheless allow answering: which ProgramInstance was active at a given date, which cycles were earned, why a transition occurred, and whether a reward event was already consumed.

History should be append-oriented. Reactivation must not erase previous activation intervals.

## Phase 8B recovery semantics

The earned event is written transactionally before expensive prescription
computation. Therefore a crash after earning but before target preparation is
recoverable: reconciliation finds the unactivated earned idempotency key and
prepares once. Target invalidation never deletes the earned event or changes
its quality/earned timestamp. Deferral events use deterministic `:defer:1`
and `:defer:2` identities; activation uses one deterministic transition key.

Operational logs now include reconcile start/completion/failure, stale-prepare
rejection, partial-state recovery and transition conflict categories. They
contain no PII and are never read as domain locks or historical authority.

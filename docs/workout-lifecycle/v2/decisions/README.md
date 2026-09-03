# Architecture Decision Records

ADRs capture durable decisions that future implementation should not silently reverse. If a decision changes, add a superseding ADR rather than rewriting history without explanation.

Current ADRs: level vs cycle, active time, earned vs motivational renewal,
program vs cycle identity, XP ownership boundary, deterministic lifecycle
identity with an explicit V1 migration baseline, active-time inactivity
detection, prescription evolution operational rules (novelty target,
anti-ping-pong, ordering, volume, dataset limitations), pending evolution
representation and the deferral state machine, earned/career level vs.
active prescription level (including adaptation-vs-pending precedence), and
production rollout/rollback authority (feature-flag scope and sticky cohort),
and immutable effective
prescription inputs with ProgramInstance-scoped progression windows (ADR-012),
and sole V2 lifecycle authority with optimistic transition commit/recovery
(ADR-013; its client-authority portions are historical), the production
hardening boundaries for rollout, observability, Rules, trusted writes, and
reproducible toolchains (ADR-014), and the current backend capability boundary
for authoritative lifecycle mutations and trusted telemetry (ADR-015), and
backend-authoritative prescription sealing plus scheduled-opportunity
integrity — the schedule, not the execution, decides which session was
expected (ADR-016).

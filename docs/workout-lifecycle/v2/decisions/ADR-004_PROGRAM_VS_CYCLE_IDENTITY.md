# ADR-004 — Program Identity Must Not Equal Lifecycle Identity

**Status:** Accepted

## Decision
Program content/identity, ProgramInstance and TrainingCycle are conceptually separate.

## Rationale
V1 normal rotation can reactivate the same deterministic `programId`, overwrite `activatedAt` semantics and reuse schedule namespaces. This prevents reliable cycle history.

## Consequence
V2 persistence design must provide stable lifecycle identity and activation history without discarding deterministic prescription benefits.

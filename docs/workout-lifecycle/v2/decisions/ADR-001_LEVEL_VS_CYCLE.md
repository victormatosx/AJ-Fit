# ADR-001 — Training Level and Cycle Are Different Concepts

**Status:** Accepted

## Decision
Store/represent historical starting level separately from mutable current training level, and represent cycles independently from both.

## Rationale
A user may start Beginner, later train as Intermediate/Advanced, and complete many cycles without losing origin history. Questionnaire input must not remain the permanent authority for current training tier.

## Consequence
Level Promotion and same-level Cycle Evolution are different domain transitions.

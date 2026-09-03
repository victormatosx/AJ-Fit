# Exercise Ordering

**Status:** TARGET_SPEC
**Implementation:** NOT IMPLEMENTED — Phase 3 deliberately performs no exercise reordering at all (ADR-008). This trivially satisfies "not a shuffle" and "preserve grouping," but role/block-based controlled reordering itself remains future work.

Ordering changes are controlled, not a shuffle. Reordering may occur within technically compatible blocks or muscle-group sequences while preserving the session's programming logic.

Example: three chest movements may change internal order and two biceps movements may change internal order. The engine should not interleave chest/biceps merely to make the list look different when the original session structure intentionally groups them.

Ordering invariants should eventually be encoded as roles/blocks so the system can explain and test them.

# Progress Visualization

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED (Fase 8D) — `EvolutionCard` renders earned level, active-prescription level, cycle, real active days, real valid-session count, and the engine's adherence-quality classification. The former `displayProgress`/`compositeProgress` percentage and `SegBar` were removed because they did not denote one real quantity. See architecture/17_PHASE_8D_UX_TRUTHFULNESS.md.

The progress surface should combine several signals rather than a rigid calendar countdown: valid sessions, consistency/adherence quality, lifecycle progress and proximity to the next evolution.

The dimensions remain separate: active time is a count, adherence is the engine's semantic quality, and proximity is mapped only from the authoritative decision/reason. No percentage-to-evolution, target countdown, or forecast date is presented.

Do not imply physiological performance gains that the data cannot prove.

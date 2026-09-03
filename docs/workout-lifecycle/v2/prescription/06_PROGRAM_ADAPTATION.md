# Program Adaptation (Future)

**Status:** TARGET_SPEC
**Implementation:** PARTIAL (Fase 4) — the service boundary `adaptWorkoutProgram` (`src/services/workoutLifecycleApplication.ts`) is implemented: preserves career level/TrainingCycle, never increments earned-cycle credit, creates a fresh Program Instance with its own execution/schedule namespace, activates immediately (safety-relevant changes are never deferred), and is idempotent via a caller-supplied key. NOT implemented: the adaptation questionnaire/UI itself — this is a pure API/domain contract with no UI trigger yet.

A future adaptation questionnaire may change availability, goal, environment/equipment, limitations or other prescription inputs. Such a change should generate a new prescription immediately rather than waiting for the next cycle.

Career state is preserved. Example: `Advanced / Cycle 5 / current program 80%` → adaptation → still `Advanced / Cycle 5`, prior earned cycles intact, but a new ProgramInstance begins and its lifecycle progress restarts.

Safety-relevant limitation changes should be treated as high-priority adaptation inputs. This document defines the boundary only; the questionnaire itself is a separate future feature.

## Phase 8A authority and reset semantics

The adaptation merge base is the active ProgramInstance's immutable effective
input snapshot. The historical questionnaire remains an origin artifact and
is never overwritten. Consecutive adaptations therefore preserve prior
changes unless explicitly replaced, and future level/cycle evolution consumes
the latest effective inputs. `currentTrainingLevel` always overrides the
historical experience answer.

Adaptation creates a new ProgramInstance and resets only its progression
window: active-time anchor, executions, prescribed-opportunity numerator and
expected-session window begin at the new instance activation. Career level,
TrainingCycle identity and previously earned cycle history remain intact.

# Target Architecture

Target separation:

`Questionnaire/Profile → Prescription Engine → Program Content/Instance → Schedule → Execution → Progression Evaluation → Evolution Decision → Prescription/Activation`

Cross-cutting outputs flow through domain events to Analytics/Gamification.

Key boundary: **Program content identity, ProgramInstance lifecycle identity and TrainingCycle identity are distinct concepts.** The V1 `programId` currently conflates content and lifecycle in normal rotation; V2 must not rely on that ambiguity.

Progression decides **whether/what kind of transition** is eligible. Prescription decides **what the next workout contains**. Gamification decides **what rewards the event earns**.

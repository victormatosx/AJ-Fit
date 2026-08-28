# Events and History

Target domain events include: `PROGRAM_STARTED`, `PROGRAM_ADAPTED`, `CYCLE_STARTED`, `CYCLE_ELIGIBLE`, `CYCLE_COMPLETED`, `EVOLUTION_EARNED`, `EVOLUTION_DEFERRED`, `EVOLUTION_ACTIVATED`, `MOTIVATIONAL_RENEWAL_OFFERED`, `MOTIVATIONAL_RENEWAL_ACTIVATED`, `LEVEL_PROMOTED`.

These are conceptual facts; they need not each become separate Firestore documents. Persistence must nevertheless allow answering: which ProgramInstance was active at a given date, which cycles were earned, why a transition occurred, and whether a reward event was already consumed.

History should be append-oriented. Reactivation must not erase previous activation intervals.

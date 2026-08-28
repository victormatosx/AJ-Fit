# Inactivity and Pauses

Earned career progress never regresses because of inactivity. However, prolonged absence must not passively complete a cycle.

Target behavior: freeze lifecycle `ActiveTime` when the user enters a meaningful inactivity period; resume from the same point when training resumes. Scheduled rest/recovery days are normal active lifecycle days and must not be mistaken for abandonment.

The precise technical definition of “prolonged inactivity” is intentionally deferred to implementation design and must be derived from schedule/execution data without punishing normal rest.

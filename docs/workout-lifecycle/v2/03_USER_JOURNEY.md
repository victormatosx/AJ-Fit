# User Journey

**Status:** TARGET_SPEC  
**Implementation:** NOT_IMPLEMENTED

## Beginner
User starts with a Beginner prescription. The adaptation period targets roughly four active weeks. Eligibility requires the minimum active period and at least 70% of prescribed valid sessions. If the session target is not reached, Beginner continues until it is. Successful completion promotes the current training level to Intermediate and generates the corresponding Intermediate prescription for the user's unchanged profile constraints.

## Intermediate
Each Intermediate cycle targets roughly three active months, with earned evolution available from about day 85 when adherence is at least 70%. Same-level evolution refreshes 20–30% of the program without intentionally increasing difficulty. Four earned Intermediate cycles promote the user to Advanced. Motivational renewals do not count toward the four.

## Advanced
Advanced uses the same general earned-cycle concept but has no terminal level. Cycles continue indefinitely, refreshing the program while preserving technical intent.

## Inactivity
A prolonged pause freezes lifecycle active time. On return, the user resumes career progress and the current program rather than being demoted or reset.

## User-requested change
A future adaptation questionnaire may immediately generate a new prescription. `CurrentTrainingLevel` and previously earned cycles remain. The lifecycle period for the new ProgramInstance starts again.

## Unlock flow
Earned evolution is announced clearly. The user can start the new program or keep the current one for two weeks. A second two-week deferral is allowed. After four total weeks, activation is automatic with an explanation.

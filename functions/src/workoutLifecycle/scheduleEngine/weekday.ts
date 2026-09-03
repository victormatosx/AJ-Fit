// Hand-written, checked-in shim — NOT generated. Mirrors the `Weekday`/`WEEKDAY_ORDER`
// definitions in src/state/AppState.tsx exactly (the only non-scheduleEngine-local import
// the synced resolver closure needs). If those definitions ever change, update both.
export const WEEKDAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAY_ORDER)[number];

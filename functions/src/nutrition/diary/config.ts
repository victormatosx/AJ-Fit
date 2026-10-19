/** Global kill switch. Authentication, App Check, ownership and persisted
 * source validation are enforced by the callable, independently of this flag.
 * No UID allowlist: every authenticated active account may register a snapshot.
 * Disabled/missing flag blocks new registrations/enrollment, not enrolled CRUD. */
export const planSnapshotRegistrationEnabled = () => process.env.NUTRITION_PLAN_SNAPSHOT_ENABLED === 'true';

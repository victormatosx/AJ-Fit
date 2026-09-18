import type { SupportCase } from '../services/supportCases';

/**
 * Total unread ADMIN messages across all cases, from the server-authoritative
 * `unreadByUserCount` field each case already carries (the same field
 * SupportCasesScreen renders its per-case badge from). Pure derivation of
 * whatever snapshot is passed in — never an independently incremented or
 * decremented counter.
 */
export function countUnreadSupportCases(cases: readonly SupportCase[]): number {
  return cases.reduce(
    (total, item) => total + (item.unreadByUserCount > 0 ? item.unreadByUserCount : 0),
    0,
  );
}

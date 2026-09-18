import { describe, expect, it } from 'vitest';

import { countUnreadSupportCases } from '../unreadSupportCasesCount';
import type { SupportCase } from '../../services/supportCases';

function supportCase(id: string, unreadByUserCount: number): SupportCase {
  return {
    id,
    ownerUid: 'alice',
    type: 'SUPPORT',
    subject: 'subject',
    state: 'CHAT_OPEN',
    mode: 'CHAT',
    lastMessage: 'hi',
    unreadByUserCount,
  };
}

describe('countUnreadSupportCases', () => {
  it('returns 0 for an empty list', () => {
    expect(countUnreadSupportCases([])).toBe(0);
  });

  it('returns 0 when no case has an unread message', () => {
    expect(countUnreadSupportCases([supportCase('a', 0), supportCase('b', 0)])).toBe(0);
  });

  it('sums unreadByUserCount across every support case', () => {
    expect(countUnreadSupportCases([supportCase('a', 3), supportCase('b', 1), supportCase('c', 0)])).toBe(4);
  });

  it('reflects a case moving from unread to read', () => {
    const unread = [supportCase('a', 2)];
    const read = [supportCase('a', 0)];
    expect(countUnreadSupportCases(unread)).toBe(2);
    expect(countUnreadSupportCases(read)).toBe(0);
  });

  it('stays visible while another case still has unread messages', () => {
    const beforeReadingOneCase = [supportCase('a', 2), supportCase('b', 1)];
    const afterReadingOneCase = [supportCase('a', 0), supportCase('b', 1)];
    const afterReadingLastCase = [supportCase('a', 0), supportCase('b', 0)];
    expect(countUnreadSupportCases(beforeReadingOneCase)).toBe(3);
    expect(countUnreadSupportCases(afterReadingOneCase)).toBe(1);
    expect(countUnreadSupportCases(afterReadingLastCase)).toBe(0);
  });
});

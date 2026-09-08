import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { dailyNotificationRegistrationWrite } from '../dailyRegistration';

describe('daily notification registration projection', () => {
  it('schedules a new user at the next 08:00 local window', () => {
    const now = Timestamp.fromDate(new Date('2026-09-07T14:00:00.000Z')); // 11:00 in Sao Paulo
    const write = dailyNotificationRegistrationWrite({ timezone: 'America/Sao_Paulo', now });
    expect(write?.nextEvaluationAt.toDate().toISOString()).toBe('2026-09-08T11:00:00.000Z');
  });

  it('does not reopen today after the scheduler already advanced the same timezone', () => {
    const now = Timestamp.fromDate(new Date('2026-09-07T11:30:00.000Z')); // 08:30 local
    const tomorrow = Timestamp.fromDate(new Date('2026-09-08T11:00:00.000Z'));
    const write = dailyNotificationRegistrationWrite({
      timezone: 'America/Sao_Paulo',
      now,
      existing: { timezone: 'America/Sao_Paulo', nextEvaluationAt: tomorrow },
    });
    expect(write?.nextEvaluationAt).toEqual(tomorrow);
  });

  it('recomputes immediately when the authenticated active device changes timezone', () => {
    const now = Timestamp.fromDate(new Date('2026-09-07T08:30:00.000Z'));
    const write = dailyNotificationRegistrationWrite({
      timezone: 'UTC',
      now,
      existing: {
        timezone: 'America/Sao_Paulo',
        nextEvaluationAt: Timestamp.fromDate(new Date('2026-09-08T11:00:00.000Z')),
      },
    });
    expect(write?.nextEvaluationAt).toEqual(now);
  });

  it('fails closed for an invalid timezone', () => {
    expect(dailyNotificationRegistrationWrite({
      timezone: '-03:00',
      now: Timestamp.now(),
    })).toBeNull();
  });
});

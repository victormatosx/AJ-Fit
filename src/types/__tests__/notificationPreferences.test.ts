import { describe, expect, it } from 'vitest';

import {
  allNotificationPreferencesEnabled,
  NOTIFICATION_PREFERENCE_KEYS,
  resolveNotificationPreference,
  setAllNotificationPreferences,
} from '../notificationPreferences';

describe('notification master preference', () => {
  it('defaults legacy and missing nutrition/subscription/support fields to enabled', () => {
    expect(allNotificationPreferencesEnabled(undefined)).toBe(true);
    expect(allNotificationPreferencesEnabled({ progress: true })).toBe(true);
    expect(resolveNotificationPreference({}, 'subscription')).toBe(true);
    expect(resolveNotificationPreference({}, 'support')).toBe(true);
    expect(resolveNotificationPreference({}, 'nutrition')).toBe(true);
  });

  it('derives the master from every individual choice', () => {
    const values = setAllNotificationPreferences(true);
    values.support = false;
    expect(allNotificationPreferencesEnabled(values)).toBe(false);
    values.support = true;
    expect(allNotificationPreferencesEnabled(values)).toBe(true);
  });

  it('changes exactly six categories together', () => {
    expect(NOTIFICATION_PREFERENCE_KEYS).toHaveLength(6);
    expect(Object.values(setAllNotificationPreferences(false))).toEqual([false, false, false, false, false, false]);
    expect(Object.values(setAllNotificationPreferences(true))).toEqual([true, true, true, true, true, true]);
  });
});

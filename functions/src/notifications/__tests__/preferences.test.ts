import { describe, expect, it } from 'vitest';

import { resolveNotificationEligibility } from '../preferences';

function firestoreFixture(params: {
  user?: Record<string, unknown>;
  deletionLocked?: boolean;
}) {
  return {
    collection(name: string) {
      return {
        doc() {
          return {
            async get() {
              if (name === 'users') {
                return {
                  exists: params.user !== undefined,
                  data: () => params.user,
                };
              }
              return {
                exists: params.deletionLocked === true,
                data: () => undefined,
              };
            },
          };
        },
      };
    },
  };
}

describe('notification preference policy', () => {
  it('defaults an absent product-category field to allowed', async () => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'PROGRESS' },
      firestoreFixture({ user: { preferences: {} } }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED' });
  });

  it('honors an explicitly disabled product category', async () => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'WORKOUTS_AND_REMINDERS' },
      firestoreFixture({
        user: {
          preferences: {
            notificationPreferences: { workoutsAndReminders: false },
          },
        },
      }) as never,
    )).resolves.toEqual({ allowed: false, reason: 'DISABLED_BY_USER' });
  });

  it('never treats OPERATIONAL as a user-toggleable category', async () => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'OPERATIONAL' },
      firestoreFixture({
        user: {
          preferences: {
            notificationPreferences: { operational: false },
          },
        },
      }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED' });
  });

  it('suppresses every category for a deleted/inactive account', async () => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'OPERATIONAL' },
      firestoreFixture({ user: { preferences: {} }, deletionLocked: true }) as never,
    )).resolves.toEqual({ allowed: false, reason: 'ACCOUNT_INACTIVE' });
  });
});

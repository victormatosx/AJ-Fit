import { describe, expect, it } from 'vitest';

import {
  resolveNotificationEligibility,
  resolveQaPreviewNotificationPolicy,
  resolveUserNotificationPolicy,
} from '../preferences';

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

  it.each(['WORKOUTS_AND_REMINDERS', 'EVOLUTION_AND_ACHIEVEMENTS', 'PROGRESS'])
  ('QA preview ignores the product preference OFF without weakening account checks (%s)', async (field) => {
    await expect(resolveQaPreviewNotificationPolicy(
      'uid',
      firestoreFixture({
        user: {
          preferences: {
            language: 'es',
            notificationPreferences: {
              workoutsAndReminders: false,
              evolutionAndAchievements: false,
              progress: false,
              selectedForProof: field,
            },
          },
        },
      }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED', locale: 'es' });
  });

  it('QA preview still rejects a deleted account', async () => {
    await expect(resolveQaPreviewNotificationPolicy(
      'uid',
      firestoreFixture({ user: { preferences: {} }, deletionLocked: true }) as never,
    )).resolves.toEqual({ allowed: false, reason: 'ACCOUNT_INACTIVE', locale: 'pt-BR' });
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

  it.each(['pt-BR', 'en', 'es'] as const)('resolves supported notification locale %s', async (language) => {
    await expect(resolveUserNotificationPolicy(
      { uid: 'uid', category: 'EVOLUTION_AND_ACHIEVEMENTS' },
      firestoreFixture({ user: { preferences: { language } } }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED', locale: language });
  });

  it('falls back safely to PT-BR without widening operational preferences', async () => {
    await expect(resolveUserNotificationPolicy(
      { uid: 'uid', category: 'OPERATIONAL' },
      firestoreFixture({
        user: {
          preferences: {
            language: 'unsupported',
            notificationPreferences: {
              workoutsAndReminders: false,
              evolutionAndAchievements: false,
              progress: false,
            },
          },
        },
      }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED', locale: 'pt-BR' });
  });
});

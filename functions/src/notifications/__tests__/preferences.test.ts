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

  it.each(['BILLING_ISSUE', 'PREMIUM_ENDED', 'SUPPORT_SINGLE_REPLY', 'SUPPORT_CHAT_MESSAGE'] as const)
  ('allows legacy users without %s preference', async (type) => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'OPERATIONAL', type },
      firestoreFixture({ user: { preferences: { notificationPreferences: { progress: false } } } }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED' });
  });

  it.each([
    ['BILLING_ISSUE', 'subscription'],
    ['PREMIUM_ENDED', 'subscription'],
    ['SUPPORT_SINGLE_REPLY', 'support'],
    ['SUPPORT_CHAT_MESSAGE', 'support'],
  ] as const)('suppresses %s when %s is disabled', async (type, field) => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'OPERATIONAL', type },
      firestoreFixture({ user: { preferences: { notificationPreferences: { [field]: false } } } }) as never,
    )).resolves.toEqual({ allowed: false, reason: 'DISABLED_BY_USER' });
  });

  it('keeps QA_TEST independent of every preference', async () => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'OPERATIONAL', type: 'QA_TEST' },
      firestoreFixture({ user: { preferences: { notificationPreferences: {
        workoutsAndReminders: false, evolutionAndAchievements: false,
        progress: false, nutrition: false, subscription: false, support: false,
      } } } }) as never,
    )).resolves.toEqual({ allowed: true, reason: 'ALLOWED' });
  });

  it.each(['WORKOUTS_AND_REMINDERS', 'EVOLUTION_AND_ACHIEVEMENTS', 'PROGRESS', 'NUTRITION'])
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
              nutrition: false,
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

  it('honors the nutrition category preference', async () => {
    await expect(resolveNotificationEligibility(
      { uid: 'uid', category: 'NUTRITION', type: 'NUTRITION_DAILY_LOG_REMINDER' },
      firestoreFixture({ user: { preferences: { notificationPreferences: { nutrition: false } } } }) as never,
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

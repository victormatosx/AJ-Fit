import { describe, expect, it } from 'vitest';
import { resolvePremiumActionCopy } from '../premiumCapabilityCopy';
import type { PremiumCapability } from '../premiumCapabilities';
import type { PremiumUpgradeIntent } from '../premiumUpgradeIntent';

const CONNECTED: PremiumCapability[] = [
  'START_WORKOUT',
  'ADD_PROGRESS_PHOTO',
  'DELETE_PROGRESS_PHOTO',
  'CREATE_ASSESSMENT',
];

const UNCONNECTED: PremiumCapability[] = [
  'VIEW_WORKOUT_DETAILS',
  'REGISTER_WORKOUT',
  'REGISTER_LOAD',
  'REGISTER_BODY_WEIGHT',
  'REGISTER_MEASUREMENTS',
];

const GENERIC = {
  titleKey: 'premiumAction.generic.title',
  descriptionKey: 'premiumAction.generic.description',
};

describe('FASE 6 — resolvePremiumActionCopy({ capability, intent })', () => {
  it.each(CONNECTED)('%s has dedicated, non-generic copy for BOTH subscribe and renew', (capability) => {
    for (const intent of ['subscribe', 'renew'] as const) {
      const copy = resolvePremiumActionCopy({ capability, intent });
      expect(copy.titleKey).not.toBe(GENERIC.titleKey);
      expect(copy.descriptionKey).not.toBe(GENERIC.descriptionKey);
      expect(copy.titleKey.startsWith('premiumAction.')).toBe(true);
      expect(copy.titleKey).toContain(`.${intent}.`);
    }
  });

  it.each(CONNECTED)('%s: subscribe copy differs from renew copy — never subscribed reads differently from expired', (capability) => {
    const subscribeCopy = resolvePremiumActionCopy({ capability, intent: 'subscribe' });
    const renewCopy = resolvePremiumActionCopy({ capability, intent: 'renew' });
    expect(subscribeCopy).not.toEqual(renewCopy);
  });

  it.each(UNCONNECTED)(
    '%s (no real feature yet, or covered transitively) falls back to generic copy regardless of intent — never invented',
    (capability) => {
      expect(resolvePremiumActionCopy({ capability, intent: 'subscribe' })).toEqual(GENERIC);
      expect(resolvePremiumActionCopy({ capability, intent: 'renew' })).toEqual(GENERIC);
    },
  );

  it.each(CONNECTED)(
    '%s: the defensive "unlock" fallback intent never guesses subscribe/renew copy — always generic',
    (capability) => {
      expect(resolvePremiumActionCopy({ capability, intent: 'unlock' })).toEqual(GENERIC);
    },
  );

  it('ADD_PROGRESS_PHOTO and DELETE_PROGRESS_PHOTO share the same copy for every intent — one gallery, one message (never "subscribe to delete your data")', () => {
    for (const intent of ['subscribe', 'renew', 'unlock'] as const) {
      expect(resolvePremiumActionCopy({ capability: 'ADD_PROGRESS_PHOTO', intent })).toEqual(
        resolvePremiumActionCopy({ capability: 'DELETE_PROGRESS_PHOTO', intent }),
      );
    }
  });

  it('never claims "renew" copy for a capability+intent combo where the user never subscribed', () => {
    for (const capability of CONNECTED) {
      const copy = resolvePremiumActionCopy({ capability, intent: 'subscribe' });
      // Spot-check against the actual renew copy for the same capability —
      // they must never collide, since that would silently claim "renew"
      // language for a never-subscribed user.
      const renewCopy = resolvePremiumActionCopy({ capability, intent: 'renew' });
      expect(copy.titleKey).not.toBe(renewCopy.titleKey);
    }
  });
});

import type { PremiumCapability } from './premiumCapabilities';
import type { PremiumUpgradeIntent } from './premiumUpgradeIntent';

/**
 * Fase 4→6: maps each Premium capability + commercial intent to the i18n
 * keys its blocked-action sheet should use (`common.json`'s
 * `premiumAction.*`, sibling to the existing `paywall.*` tree). Pure lookup
 * only — no translated strings live here, `PremiumRequiredSheet` resolves
 * these keys with `useTranslation`.
 *
 * Fase 6 adds the `intent` dimension on top of Fase 4's capability-only
 * copy: "never subscribed" and "subscribed, now expired" are different
 * situations and read differently (acquisition vs. retention copy — see
 * `docs/13_assinaturas_e_billing.md`), even for the exact same capability.
 * `intent` comes from `resolvePremiumUpgradeIntent` — this module never
 * re-derives it from `SubscriptionCenterStatus`/`CustomerInfo` itself.
 *
 * Only capabilities actually connected to a real entry point (`START_
 * WORKOUT`, `ADD_PROGRESS_PHOTO`, `DELETE_PROGRESS_PHOTO`,
 * `CREATE_ASSESSMENT`) get dedicated copy, and only for the two intents
 * `resolvePremiumUpgradeIntent` can actually produce while a capability is
 * denied (`subscribe`/`renew` — see that module's doc comment for why
 * `unlock` is structurally unreachable there). `unlock` and every
 * unconnected capability (`VIEW_WORKOUT_DETAILS`, `REGISTER_WORKOUT`,
 * `REGISTER_LOAD` — covered transitively by `START_WORKOUT`'s single entry
 * point — and `REGISTER_BODY_WEIGHT`/`REGISTER_MEASUREMENTS`, which have no
 * real feature yet) fall back to `GENERIC_COPY`: a safe, intent-agnostic
 * message rather than guessing "assinar" vs. "renovar" without proof, or
 * inventing copy for something that doesn't exist in the product.
 */
export type PremiumActionCopyKeys = {
  titleKey: string;
  descriptionKey: string;
};

const GENERIC_COPY: PremiumActionCopyKeys = {
  titleKey: 'premiumAction.generic.title',
  descriptionKey: 'premiumAction.generic.description',
};

type IntentCopyTable = Partial<Record<Extract<PremiumUpgradeIntent, 'subscribe' | 'renew'>, PremiumActionCopyKeys>>;

const CAPABILITY_COPY: Partial<Record<PremiumCapability, IntentCopyTable>> = {
  START_WORKOUT: {
    subscribe: {
      titleKey: 'premiumAction.workout.subscribe.title',
      descriptionKey: 'premiumAction.workout.subscribe.description',
    },
    renew: {
      titleKey: 'premiumAction.workout.renew.title',
      descriptionKey: 'premiumAction.workout.renew.description',
    },
  },
  // ADD/DELETE share one message on purpose (Fase 3/4 decision, preserved):
  // both are "modify the photo gallery", and DELETE especially must never
  // read as "subscribe to delete your own data" — see Fase 6 report §24.
  ADD_PROGRESS_PHOTO: {
    subscribe: {
      titleKey: 'premiumAction.photos.subscribe.title',
      descriptionKey: 'premiumAction.photos.subscribe.description',
    },
    renew: {
      titleKey: 'premiumAction.photos.renew.title',
      descriptionKey: 'premiumAction.photos.renew.description',
    },
  },
  DELETE_PROGRESS_PHOTO: {
    subscribe: {
      titleKey: 'premiumAction.photos.subscribe.title',
      descriptionKey: 'premiumAction.photos.subscribe.description',
    },
    renew: {
      titleKey: 'premiumAction.photos.renew.title',
      descriptionKey: 'premiumAction.photos.renew.description',
    },
  },
  CREATE_ASSESSMENT: {
    subscribe: {
      titleKey: 'premiumAction.assessment.subscribe.title',
      descriptionKey: 'premiumAction.assessment.subscribe.description',
    },
    renew: {
      titleKey: 'premiumAction.assessment.renew.title',
      descriptionKey: 'premiumAction.assessment.renew.description',
    },
  },
};

export function resolvePremiumActionCopy({
  capability,
  intent,
}: {
  capability: PremiumCapability;
  intent: PremiumUpgradeIntent;
}): PremiumActionCopyKeys {
  if (intent !== 'subscribe' && intent !== 'renew') return GENERIC_COPY;
  return CAPABILITY_COPY[capability]?.[intent] ?? GENERIC_COPY;
}

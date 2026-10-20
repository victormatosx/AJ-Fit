const PAYWALL_HERO_IMAGE_DEFAULT = require('../../../assets/paywall/paywall-asset.webp');
const PAYWALL_HERO_IMAGE_MASCULINO = require('../../../assets/paywall/paywall-asset-mas.webp');
const PAYWALL_HERO_IMAGE_FEMININO = require('../../../assets/paywall/paywall-asset-fem.webp');

/**
 * Picks the Paywall's hero photograph from the questionnaire's `sex` answer.
 *
 * **The approved acquisition design has no hero photograph** — AJ occupies
 * that area instead (prompt §7.4). This resolver was lifted out of
 * `PaywallScreen` rather than deleted with the `<Image>` it used to feed,
 * because the decision to drop the photo is a product one and the rule it
 * encodes ("the highlight is resolved by sex, with a neutral fallback") is
 * the part worth keeping: reinstating the photo means rendering this again,
 * not rebuilding the mapping or re-sourcing three assets.
 *
 * `sex` comes from `Quiz['sex']` — `null` covers both "not answered yet" and
 * any flow that skipped it, and always falls back to the neutral asset.
 */
export function resolvePaywallHeroImage(sex: 'm' | 'f' | null | undefined) {
  if (sex === 'm') return PAYWALL_HERO_IMAGE_MASCULINO;
  if (sex === 'f') return PAYWALL_HERO_IMAGE_FEMININO;
  return PAYWALL_HERO_IMAGE_DEFAULT;
}

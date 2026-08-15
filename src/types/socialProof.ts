import type { ImageSourcePropType } from 'react-native';

// Fixed id contract — mirrors `onboarding:socialProof.testimonials.<id>` in
// resources/*/onboarding.json. A literal union (not `string`) so template-key
// lookups like `socialProof.testimonials.${id}.name` stay typed against the
// generated i18next resource shape (see src/i18n/types.d.ts).
export const SOCIAL_PROOF_TESTIMONIAL_IDS = ['t1', 't2', 't3'] as const;
export type SocialProofTestimonialId = (typeof SOCIAL_PROOF_TESTIMONIAL_IDS)[number];

export type SocialProofTestimonial = {
  id: SocialProofTestimonialId;
  age: number;
  months: number;
  rating: number;
  beforeImage?: ImageSourcePropType;
  afterImage?: ImageSourcePropType;
  /** Bundled local avatar (e.g. `require(...)`). Preferred over `avatarURL`. */
  avatarImage?: ImageSourcePropType;
  avatarURL?: string;
};

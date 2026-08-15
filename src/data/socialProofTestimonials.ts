import type { SocialProofTestimonial } from '../types/socialProof';

// Real before/after/avatar photos supplied for this screen, bundled locally
// like any other static asset (see assets/antes-depois).
export const socialProofTestimonials: SocialProofTestimonial[] = [
  {
    id: 't1',
    age: 28,
    months: 4,
    rating: 5,
    beforeImage: require('../../assets/antes-depois/1.jpg'),
    afterImage: require('../../assets/antes-depois/2.jpg'),
    avatarImage: require('../../assets/antes-depois/avatar-1.jpg'),
  },
  {
    id: 't2',
    age: 34,
    months: 6,
    rating: 5,
    beforeImage: require('../../assets/antes-depois/3.jpg'),
    afterImage: require('../../assets/antes-depois/4.jpg'),
    avatarImage: require('../../assets/antes-depois/avatar-2.jpg'),
  },
  {
    id: 't3',
    age: 24,
    months: 3,
    rating: 5,
    beforeImage: require('../../assets/antes-depois/5.jpg'),
    afterImage: require('../../assets/antes-depois/6.jpg'),
    avatarImage: require('../../assets/antes-depois/avatar-3.jpg'),
  },
];

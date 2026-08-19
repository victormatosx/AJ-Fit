import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { ProfileAvatar } from '../ui/ProfileAvatar';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { SocialProofTestimonial } from '../../types/socialProof';

export function TestimonialCard({ testimonial }: { testimonial: SocialProofTestimonial }) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const name = t(`socialProof.testimonials.${testimonial.id}.name`);
  const quote = t(`socialProof.testimonials.${testimonial.id}.quote`);
  const highlight = t(`socialProof.testimonials.${testimonial.id}.highlight`);

  return (
    <Card style={{ padding: spacing[3], marginTop: spacing[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
        <ProfileAvatar
          displayName={name}
          photoSource={testimonial.avatarImage}
          photoURL={testimonial.avatarURL}
          size={38}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13.5, color: theme.colors.textPrimary }}>{name}</Text>
          <Text
            style={{
              fontFamily: theme.fonts.ui,
              fontSize: 11,
              color: theme.colors.textMuted,
              marginTop: 1,
            }}
            numberOfLines={1}
          >
            {t('socialProof.meta', { age: testimonial.age, months: testimonial.months })}
          </Text>
        </View>
        <RatingStars rating={testimonial.rating} />
      </View>

      <Text
        numberOfLines={2}
        style={{
          fontFamily: theme.fonts.ui,
          fontSize: 12.5,
          lineHeight: 17,
          color: theme.colors.textSecondary,
          marginTop: spacing[2],
        }}
      >
        “{quote}”
      </Text>

      <Text
        numberOfLines={1}
        style={{
          fontFamily: theme.fonts.uiSemi,
          fontSize: 12,
          color: theme.colors.primaryEmphasis,
          marginTop: spacing[1.5],
        }}
      >
        {highlight}
      </Text>
    </Card>
  );
}

function RatingStars({ rating }: { rating: number }) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={t('socialProof.rating', { rating })}
      style={{ flexDirection: 'row', gap: 2 }}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Icon key={i} name="star" size={13} color={i < rating ? theme.colors.primaryEmphasis : theme.colors.border} />
      ))}
    </View>
  );
}

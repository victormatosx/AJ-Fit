import React from 'react';
import { Text, View } from 'react-native';
import { Display } from '../ui/Display';
import { CtaButton } from '../ui/CtaButton';
import { Icon, type IconName } from '../ui/Icon';
import { useTheme } from '../../theme';

/** `components.md` §11 — short message, benefit, single CTA. Reused for every "no X yet" surface. */
export function EmptyNutritionState({
  icon = 'apple', title, body, ctaLabel, onPress,
}: {
  icon?: IconName;
  title: string;
  body: string;
  ctaLabel?: string;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, gap: 14 }}>
      <View style={{
        width: 56, height: 56, borderRadius: theme.radii.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.colors.primarySurfaceSubtle,
      }}>
        <Icon name={icon} size={26} color={theme.colors.primaryEmphasis} />
      </View>
      <Display size={20} style={{ textAlign: 'center' }}>{title}</Display>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20, color: theme.colors.textMuted, textAlign: 'center' }}>
        {body}
      </Text>
      {ctaLabel && onPress ? (
        <CtaButton onPress={onPress} style={{ width: '100%', marginTop: 8 }}>{ctaLabel}</CtaButton>
      ) : null}
    </View>
  );
}

/** `components.md` §12 — single shared error surface; always offers the next possible action, never internals (`error_states.md` §1). */
export function NutritionErrorState({
  title, body, retryLabel, onRetry, backLabel, onBack,
}: {
  title: string;
  body?: string;
  retryLabel?: string;
  onRetry?: () => void;
  backLabel?: string;
  onBack?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, gap: 14 }}>
      <View style={{
        width: 56, height: 56, borderRadius: theme.radii.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.colors.feedbackErrorBackground,
      }}>
        <Icon name="alert-triangle" size={26} color={theme.colors.feedbackErrorIcon} />
      </View>
      <Display size={20} style={{ textAlign: 'center' }}>{title}</Display>
      {body ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20, color: theme.colors.textMuted, textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {retryLabel && onRetry ? (
        <CtaButton onPress={onRetry} style={{ width: '100%', marginTop: 8 }}>{retryLabel}</CtaButton>
      ) : null}
      {backLabel && onBack ? (
        <CtaButton ghost onPress={onBack} style={{ width: '100%' }}>{backLabel}</CtaButton>
      ) : null}
    </View>
  );
}

import React from 'react';
import { Text, View } from 'react-native';
import { Icon, type IconName } from '../ui/Icon';
import { CtaButton } from '../ui/CtaButton';
import { NU, NuButton } from './NuKit';

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
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, gap: 14 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(11,112,249,0.12)',
      }}>
        <Icon name={icon} size={26} color={NU.blueHi} />
      </View>
      <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 20, color: NU.white, textAlign: 'center', lineHeight: 26 }}>{title}</Text>
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, lineHeight: 20, color: NU.faint, textAlign: 'center' }}>
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
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, gap: 14 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(255,180,84,0.14)',
      }}>
        <Icon name="alert-triangle" size={26} color={NU.warn} />
      </View>
      <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 20, color: NU.white, textAlign: 'center', lineHeight: 26 }}>{title}</Text>
      {body ? (
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, lineHeight: 20, color: NU.faint, textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {retryLabel && onRetry ? (
        <CtaButton onPress={onRetry} style={{ width: '100%', marginTop: 8 }}>{retryLabel}</CtaButton>
      ) : null}
      {backLabel && onBack ? (
        <NuButton ghost onPress={onBack} style={{ width: '100%' }}>{backLabel}</NuButton>
      ) : null}
    </View>
  );
}

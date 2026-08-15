import React from 'react';
import { View, Text, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { colors, radii, fonts } from '../../theme/tokens';

type Props = {
  name: string;
  beforeImage?: ImageSourcePropType;
  afterImage?: ImageSourcePropType;
};

export function BeforeAfterCard({ name, beforeImage, afterImage }: Props) {
  const { t } = useTranslation('onboarding');
  return (
    <Card style={{ flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
      <ImageSlot
        source={beforeImage}
        side="left"
        label={t('socialProof.before')}
        accessibilityLabel={t('socialProof.accessibility.beforeImage', { name })}
      />
      <View style={{ width: 1, backgroundColor: colors.border }} />
      <ImageSlot
        source={afterImage}
        side="right"
        highlight
        label={t('socialProof.after')}
        accessibilityLabel={t('socialProof.accessibility.afterImage', { name })}
      />

      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          marginLeft: -18,
          marginTop: -18,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.bg,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="swap" size={16} color={colors.accentHi} stroke={1.8} />
      </View>
    </Card>
  );
}

function ImageSlot({
  source,
  side,
  label,
  accessibilityLabel,
  highlight,
}: {
  source?: ImageSourcePropType;
  side: 'left' | 'right';
  label: string;
  accessibilityLabel: string;
  highlight?: boolean;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: highlight ? colors.surfaceSelected : colors.surface,
      }}
    >
      {source ? (
        <Image
          source={source}
          accessible
          accessibilityLabel={accessibilityLabel}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={120}
          style={{ flex: 1 }}
        />
      ) : (
        <View
          accessible
          accessibilityLabel={accessibilityLabel}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Icon name="camera" size={22} color={colors.faint} />
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 9,
              letterSpacing: 1.5,
              color: colors.faint,
              textTransform: 'uppercase',
              textAlign: 'center',
              paddingHorizontal: 12,
            }}
          >
            {t('socialProof.imagePlaceholder')}
          </Text>
        </View>
      )}
      <View
        style={{
          position: 'absolute',
          top: 10,
          left: side === 'left' ? 10 : undefined,
          right: side === 'right' ? 10 : undefined,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: radii.pill,
          backgroundColor: highlight ? colors.accent : colors.overlayStrong,
        }}
      >
        <MonoLabel color={highlight ? '#fff' : colors.faint} size={9}>
          {label}
        </MonoLabel>
      </View>
    </View>
  );
}

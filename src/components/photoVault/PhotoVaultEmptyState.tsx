import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { Display, MonoLabel } from '../ui/Display';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';

const GUTTER = sizes.screenGutter;

export function PhotoVaultEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('home');

  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[8] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
        <Icon name="camera" size={16} color={colors.accentHi} />
        <MonoLabel color={colors.faint}>
          {t('progress.photos.empty.badge').toUpperCase()}
        </MonoLabel>
      </View>

      <View accessibilityRole="header" style={{ marginTop: spacing[3] }}>
        <Display size={26}>{t('progress.photos.empty.title').toUpperCase()}</Display>
      </View>

      <Text
        style={{
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 21,
          marginTop: spacing[2.5],
          marginBottom: spacing[6],
        }}
      >
        {t('progress.photos.empty.description')}
      </Text>

      <CtaButton
        onPress={onAdd}
        style={{ alignSelf: 'stretch' }}
        accessibilityLabel={t('progress.photos.a11y.addPhoto')}
      >
        {t('progress.photos.empty.cta')}
      </CtaButton>
    </View>
  );
}

import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';

export function PhotoVaultEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('home');

  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 40, alignItems: 'center' }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Icon name="camera" size={28} color={colors.faint} />
      </View>

      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontFamily: fonts.uiSemi,
          fontSize: 18,
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        {t('progress.photos.empty.title')}
      </Text>

      <Text
        style={{
          color: colors.textSecondary,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
          marginBottom: 24,
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

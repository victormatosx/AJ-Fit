import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { Display, MonoLabel } from '../ui/Display';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type { ProgressPhotoPose } from '../../lib/photoVaultIdentity';

/**
 * Shown when the gallery has photos but none of the selected pose.
 *
 * Deliberately distinct from the global empty state: telling someone with
 * fifty photos to "add your first photo" would be wrong, and the useful action
 * here is to fill the pose they are looking at.
 */

export function PhotoVaultFilterEmptyState({
  pose,
  onAdd,
}: {
  pose: ProgressPhotoPose;
  onAdd: () => void;
}) {
  const { t } = useTranslation('home');

  const labels: Record<ProgressPhotoPose, string> = {
    front: t('progress.photos.poses.front'),
    side: t('progress.photos.poses.side'),
    back: t('progress.photos.poses.back'),
  };
  const label = labels[pose].toLowerCase();

  return (
    <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[8] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
        <Icon name="camera" size={16} color={colors.accentHi} />
        <MonoLabel color={colors.faint}>{labels[pose].toUpperCase()}</MonoLabel>
      </View>

      <View accessibilityRole="header" style={{ marginTop: spacing[3] }}>
        <Display size={24}>
          {t('progress.photos.filterEmpty.title', { pose: label }).toUpperCase()}
        </Display>
      </View>

      <Text
        style={{
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 14,
          lineHeight: 21,
          marginTop: spacing[2.5],
          marginBottom: spacing[5],
        }}
      >
        {t('progress.photos.filterEmpty.description')}
      </Text>

      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={t('progress.photos.filterEmpty.cta', { pose: label })}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing[2.5],
          paddingVertical: spacing[3.5],
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Icon name="plus" size={14} color={colors.accentHi} />
        <MonoLabel color={colors.text}>
          {t('progress.photos.filterEmpty.cta', { pose: label }).toUpperCase()}
        </MonoLabel>
      </Pressable>
    </View>
  );
}

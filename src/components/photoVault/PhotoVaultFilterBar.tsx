import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import {
  PROGRESS_PHOTO_FILTERS,
  type ProgressPhotoFilter,
} from '../../lib/photoVaultDayGrouping';

/**
 * Pose filter for the gallery.
 *
 * Presentation only — the selection narrows a projection the screen already
 * holds in memory. Changing it never queries, downloads or decrypts anything.
 */

interface Props {
  value: ProgressPhotoFilter;
  onChange: (filter: ProgressPhotoFilter) => void;
}

export function PhotoVaultFilterBar({ value, onChange }: Props) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();

  // Static lookup rather than a composed key: the translation keys are typed.
  const labels: Record<ProgressPhotoFilter, string> = {
    all: t('progress.photos.filters.all'),
    front: t('progress.photos.poses.front'),
    side: t('progress.photos.poses.side'),
    back: t('progress.photos.poses.back'),
  };

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: spacing[2],
        paddingHorizontal: sizes.screenGutter,
        paddingBottom: spacing[4],
      }}
    >
      {PROGRESS_PHOTO_FILTERS.map((filter) => {
        const selected = value === filter;
        return (
          <Pressable
            key={filter}
            onPress={() => onChange(filter)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t('progress.photos.a11y.selectFilter', {
              filter: labels[filter],
            })}
            testID={`photo-vault-filter-${filter}`}
            style={{
              flex: 1,
              paddingVertical: spacing[2.5],
              alignItems: 'center',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: selected ? theme.colors.primary : theme.colors.border,
              backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 9,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: selected ? theme.colors.textPrimary : theme.colors.textFaint,
              }}
            >
              {labels[filter]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

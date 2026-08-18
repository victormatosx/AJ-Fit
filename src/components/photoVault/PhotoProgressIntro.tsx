import React, { memo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Display, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import {
  colors,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
} from '../../theme/tokens';

/**
 * Public, bundled sample photos. They have no relationship to the signed-in
 * user or to Photo Vault contents.
 */
const BEFORE_IMAGE = require('../../../assets/antes-depois/1.jpg');
const AFTER_IMAGE = require('../../../assets/antes-depois/2.jpg');

function ProgressPhotoCard({
  source,
  period,
  highlighted = false,
  style,
}: {
  source: ImageSourcePropType;
  period: string;
  highlighted?: boolean;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        shadows.card,
        highlighted && styles.photoShadowHighlighted,
        style,
      ]}
    >
      <View
        style={[
          styles.photoFrame,
          highlighted && styles.photoFrameHighlighted,
        ]}
      >
        <Image
          source={source}
          resizeMode="cover"
          accessible={false}
          style={styles.photoImage}
        />
        <View style={styles.periodBadge}>
          <MonoLabel size={8} color={colors.text}>
            {period}
          </MonoLabel>
        </View>
      </View>
    </View>
  );
}

/**
 * Static feature introduction shown only by the locked vault branch.
 *
 * It intentionally receives no props and imports no gallery or vault module,
 * so neither metadata nor protected images can cross into this presentation.
 */
export const PhotoProgressIntro = memo(function PhotoProgressIntro() {
  const { t } = useTranslation('home');
  const { width } = useWindowDimensions();
  const canvasWidth = Math.min(
    sizes.contentMaxWidth,
    Math.max(0, width - sizes.screenGutter * 2),
  );
  const cardWidth = Math.max(128, Math.min(190, canvasWidth * 0.48));
  const cardHeight = cardWidth * 1.64;
  const canvasHeight = cardHeight + spacing[7];
  const pairOffset = cardWidth * 0.82;
  const pairWidth = cardWidth + pairOffset;
  const pairLeft = (canvasWidth - pairWidth) / 2;

  return (
    <View testID="photo-progress-intro" style={styles.root}>
      <View accessibilityRole="header" style={styles.copy}>
        <Display size={26} style={styles.title}>
          {t('progress.photos.intro.titlePrefix')}{' '}
          <Text style={styles.titleHighlight}>
            {t('progress.photos.intro.titleHighlight')}
          </Text>
        </Display>
        <Text style={styles.subtitle}>
          {t('progress.photos.intro.subtitle')}
        </Text>
      </View>

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('progress.photos.intro.illustrationAccessibility')}
        style={{ width: canvasWidth, height: canvasHeight, alignSelf: 'center' }}
      >
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: 0,
            left: pairLeft,
            width: pairWidth,
            height: canvasHeight,
          }}
        >
          <ProgressPhotoCard
            source={BEFORE_IMAGE}
            period={t('progress.photos.intro.beforePeriod')}
            style={{
              position: 'absolute',
              top: spacing[4],
              left: 0,
              width: cardWidth,
              height: cardHeight,
              transform: [{ rotate: '-4deg' }, { scale: 0.94 }],
              opacity: 0.96,
              zIndex: 1,
            }}
          />

          <View
            style={[
              styles.direction,
              {
                top: cardHeight * 0.34,
                left: pairOffset - spacing[4],
              },
            ]}
          >
            <Icon name="arrow-right" size={13} color={colors.accentHi} stroke={2} />
          </View>

          <ProgressPhotoCard
            source={AFTER_IMAGE}
            period={t('progress.photos.intro.afterPeriod')}
            highlighted
            style={{
              position: 'absolute',
              top: spacing[1],
              left: pairOffset,
              width: cardWidth,
              height: cardHeight,
              transform: [{ rotate: '2deg' }],
              zIndex: 3,
            }}
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    width: '100%',
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  copy: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    marginBottom: spacing[5],
  },
  title: {
    textAlign: 'center',
  },
  titleHighlight: {
    color: colors.accentHi,
  },
  subtitle: {
    ...typography.bodySmall,
    maxWidth: 330,
    marginTop: spacing[2],
    color: colors.textSecondary,
    textAlign: 'center',
  },
  photoShadowHighlighted: {
    shadowColor: colors.accent,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 9,
  },
  photoFrame: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: sizes.hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg2,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoFrameHighlighted: {
    borderWidth: 1.5,
    borderColor: colors.accentHi,
  },
  periodBadge: {
    position: 'absolute',
    left: spacing[2],
    bottom: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    borderRadius: radii.pill,
    borderWidth: sizes.hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.overlayStrong,
  },
  direction: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: sizes.hairline,
    borderColor: colors.accentSoft,
    backgroundColor: colors.bg2,
    zIndex: 4,
  },
});

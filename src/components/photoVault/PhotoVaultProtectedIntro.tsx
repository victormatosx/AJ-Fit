import React, { memo } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon } from '../ui/Icon';
import {
  colors,
  gradients,
  radii,
  shadows,
  sizes,
  spacing,
} from '../../theme/tokens';

/**
 * A deliberately generic representation of protected content.
 *
 * It contains no Image component, source, URI, gallery import, metadata or
 * vault dependency. The cards communicate "private photos are here" using
 * only design-system shapes and icons; no user pixel ever reaches this tree.
 */
function ProtectedCard({
  emphasized = false,
  style,
}: {
  emphasized?: boolean;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={emphasized ? gradients.poster : gradients.glass}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        shadows.card,
        styles.card,
        emphasized && styles.cardEmphasized,
        style,
      ]}
    >
      <View style={styles.cardTopLine} />
      <View style={styles.genericFrame}>
        <Icon
          name="camera"
          size={emphasized ? 25 : 21}
          color={emphasized ? colors.accentHi : colors.faint}
          stroke={1.4}
        />
      </View>
      <View style={styles.cardBottomLine} />
      <View style={styles.cardBottomLineShort} />
      <View style={styles.cardScrim} />
    </LinearGradient>
  );
}

export const PhotoVaultProtectedIntro = memo(
  function PhotoVaultProtectedIntro() {
    const { width } = useWindowDimensions();
    const canvasWidth = Math.min(
      330,
      Math.max(260, width - sizes.screenGutter * 2),
    );
    const cardWidth = Math.max(104, Math.min(138, canvasWidth * 0.4));
    const cardHeight = cardWidth * 1.38;
    const overlapOffset = cardWidth * 0.38;
    const stackWidth = cardWidth + overlapOffset * 2;
    const stackLeft = (canvasWidth - stackWidth) / 2;
    const canvasHeight = cardHeight + spacing[8];

    return (
      <View testID="photo-vault-protected-intro" style={styles.root}>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <ProtectedCard
            style={{
              position: 'absolute',
              top: spacing[5],
              left: stackLeft,
              width: cardWidth,
              height: cardHeight,
              opacity: 0.58,
              transform: [{ rotate: '-7deg' }, { scale: 0.9 }],
              zIndex: 1,
            }}
          />
          <ProtectedCard
            emphasized
            style={{
              position: 'absolute',
              top: spacing[1],
              left: stackLeft + overlapOffset,
              width: cardWidth,
              height: cardHeight,
              transform: [{ rotate: '-1deg' }],
              zIndex: 3,
            }}
          />
          <ProtectedCard
            style={{
              position: 'absolute',
              top: spacing[5],
              left: stackLeft + overlapOffset * 2,
              width: cardWidth,
              height: cardHeight,
              opacity: 0.72,
              transform: [{ rotate: '7deg' }, { scale: 0.92 }],
              zIndex: 2,
            }}
          />

          <View
            style={[
              styles.lockBadge,
              {
                top: cardHeight * 0.42,
                left: canvasWidth / 2 - 25,
              },
            ]}
          >
            <Icon name="lock" size={22} color={colors.text} stroke={1.8} />
          </View>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    width: '100%',
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    overflow: 'hidden',
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: sizes.hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg2,
  },
  cardEmphasized: {
    borderWidth: 1.5,
    borderColor: colors.accentHi,
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 9,
  },
  cardTopLine: {
    width: '36%',
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.faint,
    opacity: 0.45,
  },
  genericFrame: {
    flex: 1,
    marginVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: sizes.hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.overlay,
  },
  cardBottomLine: {
    width: '72%',
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.textSecondary,
    opacity: 0.26,
  },
  cardBottomLineShort: {
    width: '48%',
    height: 4,
    marginTop: spacing[1.5],
    borderRadius: radii.pill,
    backgroundColor: colors.textSecondary,
    opacity: 0.18,
  },
  cardScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlay,
    opacity: 0.2,
  },
  lockBadge: {
    position: 'absolute',
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.accentHi,
    backgroundColor: colors.bg2,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
    zIndex: 5,
  },
});

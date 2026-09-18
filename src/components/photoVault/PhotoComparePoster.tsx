import React, { forwardRef } from 'react';
import { Image, Text, View, type ViewProps } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import { Display, MonoLabel } from '../ui/Display';
import {
  colors,
  fonts,
  radii,
  sizes,
} from '../../theme/tokens';

const AJ_FIT_LOGO = require('../../../assets/aj-logo.png');
const AJ_FIT_COMPARISON_BACKGROUND = require('../../../assets/background-comparacao.avif');

/** The only V1 poster format: vertical social/story canvas. */
export const PHOTO_COMPARE_POSTER_ASPECT_RATIO = 9 / 16;

export interface PhotoComparePosterCopy {
  before: string;
  after: string;
  headlinePrimary: string;
  headlineAccent: string;
  subheadline: string;
  daySingular: string;
  dayPlural: string;
  footerMethod: string;
  footerYou: string;
  footerEvolve: string;
  hashtag: string;
}

export interface PhotoComparePosterProps {
  width: number;
  height: number;
  beforeUri: string;
  afterUri: string;
  beforeDate: string;
  afterDate: string;
  daysDifference: number;
  copy: PhotoComparePosterCopy;
  accessibilityLabel: string;
  onBeforeLoad: () => void;
  onAfterLoad: () => void;
  onBackgroundLoadStart: () => void;
  onBackgroundLoad: () => void;
  onBackgroundError: () => void;
  onLogoLoadStart: () => void;
  onLogoLoad: () => void;
  onLogoError: () => void;
  onLayout: ViewProps['onLayout'];
}

/**
 * The single WYSIWYG comparison artwork used both on screen and by view-shot.
 *
 * This component is deliberately visual only: all photo selection, vault
 * ownership, capture and sharing stay with their existing controllers. It
 * receives already-decrypted temporary URIs and localized display strings.
 */
export const PhotoComparePoster = forwardRef<View, PhotoComparePosterProps>(
  function PhotoComparePoster(
    {
      width,
      height,
      beforeUri,
      afterUri,
      beforeDate,
      afterDate,
      daysDifference,
      copy,
      accessibilityLabel,
      onBeforeLoad,
      onAfterLoad,
      onBackgroundLoadStart,
      onBackgroundLoad,
      onBackgroundError,
      onLogoLoadStart,
      onLogoLoad,
      onLogoError,
      onLayout,
    },
    ref,
  ) {
    const scale = width / 360;
    // These proportions mirror the approved 9:16 social-art reference: the
    // comparison block occupies roughly 59% of the canvas, with the actual
    // photographs spanning roughly 53%. The remaining space is deliberately
    // compact branding and attribution rather than app-like chrome.
    const horizontalPadding = width * 0.0265;
    const safeTop = height * 0.058;
    const safeBottom = height * 0.042;
    const brandingHeight = height * 0.209;
    const brandingContentLift = height * 0.022;
    const footerHeight = height * 0.105;
    const photoMetaHeight = width * 0.094;
    const photoGap = width * 0.052;
    const photoRadius = radii.sm * scale;
    const badgeSize = width * 0.166;
    const dayUnit =
      daysDifference === 1 ? copy.daySingular : copy.dayPlural;

    const side = (
      sideName: 'before' | 'after',
      uri: string,
      label: string,
      date: string,
      onLoad: () => void,
    ) => (
      <View
        testID={`photo-vault-compare-poster-${sideName}`}
        style={{ flex: 1, minWidth: 0 }}
      >
        <View
          testID={`photo-vault-compare-poster-${sideName}-meta`}
          style={{
            height: photoMetaHeight,
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          <MonoLabel
            color={sideName === 'after' ? colors.accentHi : colors.text}
            size={width * 0.03}
            style={{ fontFamily: fonts.monoBold, letterSpacing: width * 0.004 }}
          >
            {label}
          </MonoLabel>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{
              color: colors.textSecondary,
              fontFamily: fonts.mono,
              fontSize: width * 0.027,
              lineHeight: width * 0.034,
              letterSpacing: width * 0.001,
            }}
          >
            {date}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            overflow: 'hidden',
            borderRadius: photoRadius,
            backgroundColor: colors.surfaceRaised,
            borderWidth: sizes.hairline,
            borderColor: colors.borderStrong,
          }}
        >
          <Image
            testID={`photo-vault-compare-poster-${sideName}-photo`}
            source={{ uri }}
            resizeMode="cover"
            onLoad={onLoad}
            accessible
            accessibilityLabel={`${label}, ${date}`}
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      </View>
    );

    return (
      <View
        ref={ref}
        testID="photo-vault-compare-capture-view"
        collapsable={false}
        accessibilityLabel={accessibilityLabel}
        onLayout={onLayout}
        style={{
          width,
          height,
          overflow: 'hidden',
          paddingTop: safeTop,
          paddingBottom: safeBottom,
          paddingHorizontal: horizontalPadding,
          backgroundColor: colors.bg,
          borderWidth: sizes.hairline,
          borderColor: colors.borderStrong,
          borderRadius: 2,
        }}
      >
        <ExpoImage
          testID="photo-vault-compare-poster-background"
          pointerEvents="none"
          source={AJ_FIT_COMPARISON_BACKGROUND}
          contentFit="cover"
          contentPosition="center"
          transition={0}
          onLoadStart={onBackgroundLoadStart}
          onLoad={onBackgroundLoad}
          onError={onBackgroundError}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          }}
        />

        <View
          testID="photo-vault-compare-poster-branding"
          style={{
            height: brandingHeight,
            alignItems: 'center',
            justifyContent: 'flex-start',
            transform: [{ translateY: -brandingContentLift }],
          }}
        >
          <Image
            testID="photo-vault-compare-logo"
            source={AJ_FIT_LOGO}
            resizeMode="contain"
            onLoadStart={onLogoLoadStart}
            onLoad={onLogoLoad}
            onError={onLogoError}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: width * 0.125,
              height: width * 0.125,
              opacity: 1,
            }}
          />

          <View
            testID="photo-vault-compare-poster-headline"
            style={{ alignItems: 'center', marginTop: width * 0.015 }}
          >
            <Display
              size={width * 0.069}
              skew={false}
              style={{ textAlign: 'center', letterSpacing: width * 0.006 }}
            >
              {copy.headlinePrimary}
            </Display>
            <Display
              size={width * 0.085}
              color={colors.accent}
              style={{
                textAlign: 'center',
                letterSpacing: width * 0.008,
                marginTop: -width * 0.012,
              }}
            >
              {copy.headlineAccent}
            </Display>
          </View>

          <Text
            testID="photo-vault-compare-poster-subheadline"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{
              color: colors.mute,
              fontFamily: fonts.uiMed,
              fontSize: width * 0.018,
              lineHeight: width * 0.027,
              letterSpacing: width * 0.0045,
              textAlign: 'center',
              textTransform: 'uppercase',
              marginTop: height * 0.003,
            }}
          >
            {copy.subheadline}
          </Text>
        </View>

        <View
          testID="photo-vault-compare-poster-photos"
          style={{
            flex: 1,
            flexDirection: 'row',
            gap: photoGap,
            position: 'relative',
          }}
        >
          {side('before', beforeUri, copy.before, beforeDate, onBeforeLoad)}
          {side('after', afterUri, copy.after, afterDate, onAfterLoad)}

          <View
            testID="photo-vault-compare-poster-period"
            pointerEvents="none"
            accessible
            accessibilityLabel={`+${daysDifference} ${dayUnit}`}
            style={{
              position: 'absolute',
              left: '50%',
              top: '57%',
              width: badgeSize,
              height: badgeSize,
              marginLeft: -badgeSize / 2,
              marginTop: -badgeSize / 2,
              zIndex: 3,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: badgeSize / 2,
              borderWidth: Math.max(sizes.hairline, width * 0.004),
              borderColor: colors.accent,
              backgroundColor: colors.bg2,
              shadowColor: colors.accent,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.2,
              shadowRadius: width * 0.018,
              elevation: 4,
            }}
          >
            <Display
              size={width * 0.049}
              color={colors.accentHi}
              numberOfLines={1}
              style={{
                maxWidth: badgeSize * 0.82,
                textAlign: 'center',
                letterSpacing: 0,
              }}
            >
              {`+${daysDifference}`}
            </Display>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={{
                maxWidth: badgeSize * 0.78,
                color: colors.text,
                fontFamily: fonts.uiSemi,
                fontSize: width * 0.0165,
                lineHeight: width * 0.021,
                letterSpacing: width * 0.0015,
                textAlign: 'center',
                textTransform: 'uppercase',
              }}
            >
              {dayUnit}
            </Text>
          </View>
        </View>

        <View
          testID="photo-vault-compare-poster-footer"
          style={{
            height: footerHeight,
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: height * 0.012,
          }}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={{
              color: colors.textSecondary,
              fontFamily: fonts.uiMed,
              fontSize: width * 0.019,
              lineHeight: width * 0.027,
              letterSpacing: width * 0.0045,
              textAlign: 'center',
              textTransform: 'uppercase',
            }}
          >
            {copy.footerMethod}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text
              style={{
                color: colors.textSecondary,
                fontFamily: fonts.uiMed,
                fontSize: width * 0.019,
                lineHeight: width * 0.027,
                letterSpacing: width * 0.0045,
                textTransform: 'uppercase',
              }}
            >
              {`${copy.footerYou} `}
            </Text>
            <Text
              style={{
                color: colors.accentHi,
                fontFamily: fonts.uiBold,
                fontSize: width * 0.019,
                lineHeight: width * 0.027,
                letterSpacing: width * 0.0045,
                textTransform: 'uppercase',
              }}
            >
              {copy.footerEvolve}
            </Text>
          </View>
          <MonoLabel
            color={colors.accentHi}
            size={width * 0.021}
            style={{
              fontFamily: fonts.monoBold,
              letterSpacing: width * 0.007,
              marginTop: width * 0.008,
            }}
          >
            {copy.hashtag}
          </MonoLabel>
        </View>
      </View>
    );
  },
);

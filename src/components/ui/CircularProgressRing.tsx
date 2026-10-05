import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import { MonoLabel } from './Display';

export function CircularProgressRing({
  progress,
  label,
  accessibilityLabel,
  size = 224,
  pulseGlow = false,
}: {
  progress: number;
  label: string;
  accessibilityLabel: string;
  size?: number;
  pulseGlow?: boolean;
}) {
  const { theme } = useTheme();
  const glowOpacity = useRef(new Animated.Value(pulseGlow ? 0.75 : 0.84)).current;

  useEffect(() => {
    if (!pulseGlow) {
      glowOpacity.setValue(0.84);
      return undefined;
    }
    glowOpacity.setValue(0.75);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0.75,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glowOpacity, pulseGlow]);

  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const stroke = size * (11 / 224);
  const radius = (size - stroke * 2.9) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clampedProgress / 100);
  const glowInset = size * (14 / 224);
  const glowSize = size - glowInset * 2;
  const numberSize = size * (56 / 224);
  const percentSize = size * (24 / 224);

  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: glowInset,
          left: glowInset,
          right: glowInset,
          bottom: glowInset,
          opacity: glowOpacity,
        }}
      >
        <Svg width={glowSize} height={glowSize}>
          <Defs>
            <RadialGradient id="circularProgressGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={theme.colors.primaryEmphasis} stopOpacity="0.85" />
              <Stop offset="35%" stopColor={theme.colors.primary} stopOpacity="0.55" />
              <Stop offset="75%" stopColor={theme.colors.primary} stopOpacity="0.18" />
              <Stop offset="100%" stopColor={theme.colors.primary} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={glowSize} height={glowSize} fill="url(#circularProgressGlow)" />
        </Svg>
      </Animated.View>

      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: [{ rotate: '-90deg' }] }}
      >
        <Defs>
          <SvgLinearGradient id="circularProgressGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={theme.colors.primaryEmphasis} />
            <Stop offset="100%" stopColor={theme.colors.primary} />
          </SvgLinearGradient>
        </Defs>
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={theme.colors.border} strokeWidth={stroke} />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={theme.colors.primary}
          strokeWidth={stroke + size * (8 / 224)}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
          opacity={0.35}
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#circularProgressGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
        />
      </Svg>

      <View
        pointerEvents="none"
        accessible
        accessibilityLabel={accessibilityLabel}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingTop: size * (18 / 224) }}>
          <Text
            style={{
              fontFamily: theme.fonts.display,
              fontSize: numberSize,
              lineHeight: displayLineHeight(numberSize),
              color: theme.colors.textPrimary,
              transform: [{ skewX: '-8deg' }],
              textShadowColor: theme.colors.primaryBorderFocus,
              textShadowRadius: 3,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            {clampedProgress}
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.display,
              fontSize: percentSize,
              lineHeight: displayLineHeight(percentSize) + size * (18 / 224),
              color: theme.colors.primaryEmphasis,
              transform: [{ skewX: '-8deg' }],
              marginLeft: 2,
              textShadowColor: theme.colors.uploadBorder,
              textShadowRadius: 3,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            %
          </Text>
        </View>
        <MonoLabel style={{ marginTop: 2, textAlign: 'center' }}>{label.toUpperCase()}</MonoLabel>
      </View>
    </View>
  );
}

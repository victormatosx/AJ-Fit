import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLG,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { MonoLabel } from '../components/ui/Display';
import { colors, fonts, displayLineHeight } from '../theme/tokens';

export function AnalyzingScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('onboarding');
  const [progress, setProgress] = useState(0);
  const steps = [
    t('analyzing.steps.profile'),
    t('analyzing.steps.volume'),
    t('analyzing.steps.exercises'),
    t('analyzing.steps.periodization'),
    t('analyzing.steps.plan'),
  ];

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(id);
          return 100;
        }
        return p + 1;
      });
    }, 52);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
  }, [progress]);

  // Active step index: 0..steps.length-1. Clamped so the final step stays
  // "active" until onDone fires (never enters the "done" state itself).
  const stepFloat = (progress / 100) * steps.length;
  const activeIdx = Math.min(steps.length - 1, Math.floor(stepFloat));

  // Pulsing ambient glow inside the ring — mirrors @keyframes aj2-pulse.
  // Range boosted from 0.55↔1 to 0.75↔1 so the LED never dims to a faint blur.
  const pulse = useRef(new Animated.Value(0.75)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.75,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Ring geometry — bumped up ~20% from the CSS mock (184 → 224) per user feedback.
  const RING_SIZE = 224;
  const R = 96;
  const STROKE = 11;
  const CX = RING_SIZE / 2;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - progress / 100);
  // LED glow fills nearly the entire interior of the ring.
  const GLOW_INSET = 14;
  const GLOW_SIZE = RING_SIZE - GLOW_INSET * 2;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: 40,
            paddingBottom: 36,
          }}
        >
          {/* ── Ring wrap ── */}
          <View
            style={{
              width: RING_SIZE,
              height: RING_SIZE,
              alignSelf: 'center',
              marginBottom: 26,
            }}
          >
            {/* Ambient LED — fills nearly the ring interior; layered radial
                gradient with a much hotter core than the mock (0.75 vs 0.4)
                so it reads as a real light source, not a subtle wash. */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: GLOW_INSET,
                left: GLOW_INSET,
                right: GLOW_INSET,
                bottom: GLOW_INSET,
                opacity: pulse,
              }}
            >
              <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
                <Defs>
                  <RadialGradient id="ringGlow" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#4da3ff" stopOpacity="0.85" />
                    <Stop offset="35%" stopColor="#0b70f9" stopOpacity="0.55" />
                    <Stop offset="75%" stopColor="#0b70f9" stopOpacity="0.18" />
                    <Stop offset="100%" stopColor="#0b70f9" stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width={GLOW_SIZE} height={GLOW_SIZE} fill="url(#ringGlow)" />
              </Svg>
            </Animated.View>

            {/* Progress ring — rotated -90° so it starts at 12 o'clock */}
            <Svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              style={{ transform: [{ rotate: '-90deg' }] }}
            >
              <Defs>
                <SvgLG id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0%" stopColor={colors.accentHi} />
                  <Stop offset="100%" stopColor={colors.accent} />
                </SvgLG>
              </Defs>
              <Circle
                cx={CX}
                cy={CX}
                r={R}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={STROKE}
              />
              {/* Fake drop-shadow: a wider low-opacity twin sits under the
                  real arc — RN-SVG has no filter="drop-shadow" support. */}
              <Circle
                cx={CX}
                cy={CX}
                r={R}
                fill="none"
                stroke={colors.accent}
                strokeWidth={STROKE + 8}
                strokeLinecap="round"
                strokeDasharray={`${C}`}
                strokeDashoffset={offset}
                opacity={0.35}
              />
              <Circle
                cx={CX}
                cy={CX}
                r={R}
                fill="none"
                stroke="url(#ringGrad)"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${C}`}
                strokeDashoffset={offset}
              />
            </Svg>

            {/* Centered %  +  COMPILANDO label */}
            <View
              pointerEvents="none"
              accessible
              accessibilityLabel={t('analyzing.accessibility.progress', { progress })}
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
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 56,
                    lineHeight: displayLineHeight(56),
                    color: '#fff',
                    transform: [{ skewX: '-8deg' }],
                    textShadowColor: 'rgba(77,163,255,0.95)',
                    textShadowRadius: 28,
                    textShadowOffset: { width: 0, height: 0 },
                  }}
                >
                  {progress}
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 24,
                    color: colors.accentHi,
                    transform: [{ skewX: '-8deg' }],
                    marginLeft: 2,
                    textShadowColor: 'rgba(77,163,255,0.9)',
                    textShadowRadius: 20,
                    textShadowOffset: { width: 0, height: 0 },
                  }}
                >
                  %
                </Text>
              </View>
              <MonoLabel style={{ marginTop: 6 }}>
                {t('analyzing.compiling').toUpperCase()}
              </MonoLabel>
            </View>
          </View>

          {/* ── Title ── */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 32,
                lineHeight: displayLineHeight(32),
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: '#fff',
                textAlign: 'center',
              }}
            >
              {t('analyzing.titleLine1').toUpperCase()}
              {'\n'}
              {t('analyzing.titleLine2').toUpperCase()}
            </Text>
          </View>

          {/* ── Synced checklist ── */}
          <View style={{ gap: 10 }}>
            {steps.map((label, i) => {
              const done = i < activeIdx;
              const active = i === activeIdx;
              return (
                <StepPill
                  key={i}
                  label={label}
                  state={done ? 'done' : active ? 'active' : 'pending'}
                />
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

type StepState = 'pending' | 'active' | 'done';

function StepPill({ label, state }: { label: string; state: StepState }) {
  const isActive = state === 'active';
  const isDone = state === 'done';
  const opacity = state === 'pending' ? 0.5 : 1;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 15,
        paddingHorizontal: 18,
        borderRadius: 16,
        backgroundColor: isActive ? 'rgba(11,112,249,0.2)' : 'rgba(255,255,255,0.025)',
        borderWidth: 1,
        borderColor: isActive ? 'rgba(77,163,255,0.75)' : 'rgba(255,255,255,0.07)',
        shadowColor: isActive ? colors.accentHi : 'transparent',
        shadowOpacity: isActive ? 0.75 : 0,
        shadowRadius: isActive ? 28 : 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: isActive ? 10 : 0,
        opacity,
      }}
    >
      <StepIndicator state={state} />
      <Text
        style={{
          fontFamily: fonts.uiSemi,
          fontSize: 14.5,
          color: state === 'pending' ? 'rgba(255,255,255,0.5)' : '#fff',
          flex: 1,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function StepIndicator({ state }: { state: StepState }) {
  // Active step spins — mirrors @keyframes aj2-spin-slow (0.9s linear).
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'active') return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [state, spin]);

  if (state === 'done') {
    // Flat solid-blue disc + white check. No halo — the item has already
    // finished; the LED bloom lives on the active step only.
    return (
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="check" size={14} color="#fff" stroke={2.6} />
      </View>
    );
  }

  if (state === 'active') {
    const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <Animated.View
        style={{
          width: 26,
          height: 26,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate }],
        }}
      >
        <Svg width={26} height={26} viewBox="0 0 26 26">
          {/* Track — dim ring for the unfilled portion */}
          <Circle
            cx="13"
            cy="13"
            r="10"
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={2.5}
          />
          {/* Fake drop-shadow: a wider, softer twin sits beneath the arc so
              the moving head reads as a lit-up LED (RN-SVG can't do a real
              filter="drop-shadow"). */}
          <Path
            d="M13 3 a10 10 0 0 1 10 10"
            fill="none"
            stroke={colors.accent}
            strokeWidth={6}
            strokeLinecap="round"
            opacity={0.55}
          />
          {/* Bright blue arc on top */}
          <Path
            d="M13 3 a10 10 0 0 1 10 10"
            fill="none"
            stroke={colors.accentHi}
            strokeWidth={2.8}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    );
  }

  // Pending — small 5px dot inside a subtle 26px ring.
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: 'rgba(255,255,255,0.3)',
        }}
      />
    </View>
  );
}

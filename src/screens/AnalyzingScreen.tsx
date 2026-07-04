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
import { Icon } from '../components/ui/Icon';
import { MonoLabel } from '../components/ui/Display';
import { colors, fonts } from '../theme/tokens';

const STEPS = [
  'Lendo seu perfil físico',
  'Calculando volume e intensidade',
  'Selecionando exercícios ideais',
  'Periodizando suas semanas',
  'Montando seu plano premium',
];

export function AnalyzingScreen({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

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

  // Active step index: 0..STEPS.length-1. Clamped so the final step stays
  // "active" until onDone fires (never enters the "done" state itself).
  const stepFloat = (progress / 100) * STEPS.length;
  const activeIdx = Math.min(STEPS.length - 1, Math.floor(stepFloat));

  // Pulsing ambient glow inside the ring — mirrors @keyframes aj2-pulse.
  const pulse = useRef(new Animated.Value(0.55)).current;
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
          toValue: 0.55,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Ring geometry
  const R = 76;
  const STROKE = 9;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - progress / 100);

  return (
    <View style={{ flex: 1, backgroundColor: '#020010' }}>
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
              width: 184,
              height: 184,
              alignSelf: 'center',
              marginBottom: 26,
            }}
          >
            {/* Ambient glow — inset 18px, radial blue, pulsing */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 18,
                left: 18,
                right: 18,
                bottom: 18,
                opacity: pulse,
              }}
            >
              <Svg width={148} height={148}>
                <Defs>
                  <RadialGradient id="ringGlow" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#0b70f9" stopOpacity="0.4" />
                    <Stop offset="70%" stopColor="#0b70f9" stopOpacity="0" />
                    <Stop offset="100%" stopColor="#0b70f9" stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width="148" height="148" fill="url(#ringGlow)" />
              </Svg>
            </Animated.View>

            {/* Progress ring — rotated -90° so it starts at 12 o'clock */}
            <Svg
              width={184}
              height={184}
              viewBox="0 0 184 184"
              style={{ transform: [{ rotate: '-90deg' }] }}
            >
              <Defs>
                <SvgLG id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0%" stopColor={colors.accentHi} />
                  <Stop offset="100%" stopColor={colors.accent} />
                </SvgLG>
              </Defs>
              <Circle
                cx="92"
                cy="92"
                r={R}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={STROKE}
              />
              <Circle
                cx="92"
                cy="92"
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
                    fontSize: 52,
                    lineHeight: 52,
                    color: '#fff',
                    transform: [{ skewX: '-8deg' }],
                    textShadowColor: 'rgba(11,112,249,0.6)',
                    textShadowRadius: 15,
                    textShadowOffset: { width: 0, height: 0 },
                  }}
                >
                  {progress}
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 22,
                    color: colors.accentHi,
                    transform: [{ skewX: '-8deg' }],
                    marginLeft: 2,
                  }}
                >
                  %
                </Text>
              </View>
              <MonoLabel style={{ marginTop: 6 }}>COMPILANDO</MonoLabel>
            </View>
          </View>

          {/* ── Title ── */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 32,
                lineHeight: 32 * 0.95,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: '#fff',
                textAlign: 'center',
              }}
            >
              MONTANDO{'\n'}SEU PLANO
            </Text>
          </View>

          {/* ── Synced checklist ── */}
          <View style={{ gap: 10 }}>
            {STEPS.map((label, i) => {
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
        backgroundColor: isActive ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.025)',
        borderWidth: 1,
        borderColor: isActive ? 'rgba(11,112,249,0.55)' : 'rgba(255,255,255,0.07)',
        shadowColor: isActive ? colors.accent : 'transparent',
        shadowOpacity: isActive ? 0.35 : 0,
        shadowRadius: isActive ? 22 : 0,
        shadowOffset: { width: 0, height: 0 },
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
    return (
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors.accent,
          shadowOpacity: 0.6,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
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
          <Circle
            cx="13"
            cy="13"
            r="10"
            fill="none"
            stroke="rgba(11,112,249,0.25)"
            strokeWidth={2.5}
          />
          {/* Quarter-arc head from top (13,3) around to right (23,13) */}
          <Path
            d="M13 3 a10 10 0 0 1 10 10"
            fill="none"
            stroke={colors.accentHi}
            strokeWidth={2.5}
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

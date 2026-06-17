import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import { ScreenBg } from '../components/ui/ScreenBg';
import { AJMark } from '../components/ui/AJMark';
import { Display } from '../components/ui/Display';
import { SegBar } from '../components/ui/SegBar';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const glow = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 500, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, []);

  const scale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });

  return (
    <ScreenBg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <OutlineNumber
          size={380}
          style={{
            position: 'absolute',
            top: '20%',
            opacity: 0.5,
          }}
        >
          AJ
        </OutlineNumber>

        <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
          <AJMark size={130} />
        </Animated.View>
        <Display size={44} style={{ marginTop: 26 }}>
          AJ FIT
        </Display>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Text
            style={{
              fontFamily: fonts.monoBold,
              fontSize: 10,
              letterSpacing: 2,
              color: colors.accentHi,
            }}
          >
            //
          </Text>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 2,
              color: colors.faint,
            }}
          >
            TREINE COMO POUCOS
          </Text>
        </View>
      </View>

      <View style={{ position: 'absolute', left: 40, right: 40, bottom: 64 }}>
        <SegBar value={0.6} segs={18} />
      </View>
      <Animated.View
        style={{
          position: 'absolute',
          alignSelf: 'center',
          bottom: 36,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: blink,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: 2,
            color: colors.faint,
          }}
        >
          CARREGANDO SISTEMA AJ ▌
        </Text>
      </Animated.View>
    </ScreenBg>
  );
}

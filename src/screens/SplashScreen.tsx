import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';
import { AJMark } from '../components/ui/AJMark';

const BG = '#000000';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]);
    sequence.start(onDone);
    // Stop the (native-driven) animation on unmount — otherwise it keeps
    // running after the screen changes and calls `onDone` late, on a stale
    // closure, clobbering whatever screen the router already moved to.
    return () => sequence.stop();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ opacity }}>
        <AJMark size={320} />
      </Animated.View>
    </View>
  );
}

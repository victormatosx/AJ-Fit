import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleProp, ViewStyle, Animated, Image, ImageStyle } from 'react-native';
import { colors, fonts } from '../../theme/tokens';

const DB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

type Props = {
  id?: string | null;
  name: string;
  height?: number;
  aspectRatio?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Two-frame cross-fade of a free-exercise-db demo (start ↔ end). Falls back to
 * a labeled placeholder on load error or missing id.
 */
export function ExerciseGif({ id, name, height, aspectRatio, radius = 16, style }: Props) {
  const [failed, setFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const showingSecond = useRef(false);

  useEffect(() => {
    setFailed(false);
    opacity.setValue(0);
    showingSecond.current = false;
    const interval = setInterval(() => {
      showingSecond.current = !showingSecond.current;
      Animated.timing(opacity, {
        toValue: showingSecond.current ? 1 : 0,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }, 760);
    return () => clearInterval(interval);
  }, [id, opacity]);

  const sizeStyle: ViewStyle = aspectRatio
    ? { aspectRatio }
    : { height: height ?? 210 };

  const wrapper: StyleProp<ViewStyle> = [
    {
      width: '100%',
      overflow: 'hidden',
      borderRadius: radius,
      backgroundColor: '#070a1e',
    },
    sizeStyle,
    style,
  ];

  if (failed || !id) {
    return (
      <View style={[wrapper, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 10.5,
            letterSpacing: 1.5,
            color: 'rgba(255,255,255,0.4)',
            textAlign: 'center',
            paddingHorizontal: 18,
          }}
        >
          GIF · {name.toUpperCase()}
        </Text>
      </View>
    );
  }

  const imgStyle: ImageStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  };

  return (
    <View style={wrapper}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.bg,
        }}
      />
      <Image
        source={{ uri: `${DB_BASE}/${id}/0.jpg` }}
        onError={() => setFailed(true)}
        style={imgStyle}
      />
      <Animated.Image
        source={{ uri: `${DB_BASE}/${id}/1.jpg` }}
        onError={() => setFailed(true)}
        style={[imgStyle, { opacity }]}
      />
    </View>
  );
}

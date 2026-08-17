import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleProp, ViewStyle, Animated, Image, ImageStyle, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, fonts } from '../../theme/tokens';

const DB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

// Exercises with a dedicated local demo video (shot in two orientations) take
// priority over the remote free-exercise-db frames. `landscape` is the
// deitado (lying) take — matches the wide banner slot; `portrait` is the
// em-pé (standing) take — matches the 9:16 fullscreen modal slot.
const LOCAL_VIDEOS: Record<string, { landscape: number; portrait: number }> = {
  'Barbell_Bench_Press_-_Medium_Grip': {
    landscape: require('../../../assets/videos/supino-reto-maquina-deitado.mp4'),
    portrait: require('../../../assets/videos/supino-reto-maquina-em-pe.mp4'),
  },
};

type Props = {
  id?: string | null;
  name: string;
  height?: number;
  aspectRatio?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Renders a looping local demo video for exercises in `LOCAL_VIDEOS`.
 * Otherwise falls back to a two-frame cross-fade of a free-exercise-db demo
 * (start ↔ end), or a labeled placeholder on load error or missing id.
 */
export function ExerciseGif({ id, name, height, aspectRatio, radius = 16, style }: Props) {
  const [failed, setFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const showingSecond = useRef(false);

  // Portrait slots (9:16 fullscreen modal) get the em-pé take; every other
  // slot (the wide banner) gets the deitado take.
  const isPortrait = !!aspectRatio && aspectRatio < 1;
  const localVideos = id ? LOCAL_VIDEOS[id] : undefined;
  const localSource = localVideos ? (isPortrait ? localVideos.portrait : localVideos.landscape) : null;

  // `setup` runs once, synchronously, right after this exact player is
  // constructed — unlike a separate effect keyed on `player`, it can't fire
  // after `useVideoPlayer` has already swapped/released the native object
  // when `localSource` changes (that caused a NativeSharedObjectNotFound
  // crash from a stale `player.pause()` call).
  const player = useVideoPlayer(localSource, (p) => {
    if (!localSource) return;
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (localSource) return;
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
  }, [id, opacity, localSource]);

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

  if (localSource) {
    return (
      <View style={wrapper}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          pointerEvents="none"
        />
      </View>
    );
  }

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

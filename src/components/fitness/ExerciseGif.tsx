import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleProp, ViewStyle, Animated, Image, ImageStyle, StyleSheet, AppState } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../theme';
import { logWarn } from '../../lib/logger';
import { configureSilentDemoVideo, observeSilentDemoAppState } from '../../lib/silentDemoVideo';
import { EXERCISE_FALLBACK_VIDEO_ID } from '../../data/exerciseFallbackVideoMap';
import { EXERCISE_V3_LOCAL_DEMOS } from '../../data/exerciseV3VideoAssets';
import type { ExerciseExecution } from '../../types/exercise';

const DB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

// Exercises with a dedicated local demo video (shot in two orientations) take
// priority over the remote free-exercise-db frames. `landscape` is the
// deitado (lying) take — matches the wide banner slot; `portrait` is the
// em-pé (standing) take — matches the 9:16 fullscreen modal slot.
const LOCAL_VIDEOS: Record<string, { landscape?: number; portrait?: number }> = {
  ...EXERCISE_V3_LOCAL_DEMOS,
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
  /**
   * The exercise's own admin-registered video (Firestore `exercises/{id}
   * .execution.videos`), when the caller has one loaded — see
   * `useExerciseExecutionMedia`. Takes priority over every fallback below;
   * an own video for the requested orientation must NEVER be replaced by
   * `LOCAL_VIDEOS` or the free-exercise-db frames.
   */
  ownVideo?: ExerciseExecution['videos'];
  /**
   * True while the caller's own-video lookup (`useExerciseExecutionMedia`)
   * hasn't resolved yet for this exercise. MUST be passed whenever `ownVideo`
   * comes from that hook — without it, `ownVideo` being `undefined` is
   * indistinguishable from "confirmed no own video", and this component
   * falls straight to the fallback library (`LOCAL_VIDEOS`/free-exercise-db)
   * for the brief window before the real lookup lands, flashing the wrong
   * demo on screen even for an exercise that DOES have an own video (real
   * bug this prop fixes). Defaults to `false` — safe for any caller that
   * doesn't use the hook (`ownVideo` always fully known synchronously).
   */
  ownVideoLoading?: boolean;
};

/**
 * Priority: (1) the exercise's own registered video (`ownVideo`, Firestore/
 * admin), (2) a local demo video in `LOCAL_VIDEOS`, (3) a two-frame
 * cross-fade of a free-exercise-db demo (start ↔ end), (4) a labeled
 * "unavailable" placeholder on load error or missing id. (2)+(3) together
 * are the fallback library — used whenever there's no own video, never
 * instead of one. While `ownVideoLoading` is true and no source has
 * resolved yet, renders neither (3) nor (4) — a blank frame instead, so the
 * fallback library never flashes ahead of an own video that's still loading.
 */
export function ExerciseGif({ id, name, height, aspectRatio, radius = 16, style, ownVideo, ownVideoLoading = false }: Props) {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const showingSecond = useRef(false);

  // Portrait slots (9:16 fullscreen modal) get the em-pé/vertical take;
  // every other slot (the wide banner) gets the deitado/horizontal take.
  const isPortrait = !!aspectRatio && aspectRatio < 1;
  const ownVideoForOrientationRaw = isPortrait ? ownVideo?.vertical : ownVideo?.horizontal;
  const localVideos = id ? LOCAL_VIDEOS[id] : undefined;
  const localSourceRaw = localVideos ? ((isPortrait ? localVideos.portrait : localVideos.landscape) ?? null) : null;

  // A source that fails to actually PLAY (wrong/unsupported format, broken
  // URL, network error — `statusChange`'s `'error'` status below) must fall
  // through to the next priority tier instead of leaving a permanently
  // blank/black player — `resolvedSource` being truthy previously meant
  // "we picked a source", never "it actually loaded". Scoped to exactly
  // this (id, own-video URL, orientation) combination, via `identityKey`, so
  // switching to a different exercise/orientation always gets a fresh
  // attempt — a failure never sticks around and silently hides a LATER,
  // perfectly playable video.
  const identityKey = `${id ?? ''}|${ownVideoForOrientationRaw?.url ?? ''}|${isPortrait}`;
  const [failure, setFailure] = useState<{ key: string; ownFailed: boolean; localFailed: boolean }>({
    key: '',
    ownFailed: false,
    localFailed: false,
  });
  const { ownFailed, localFailed } = failure.key === identityKey
    ? failure
    : { ownFailed: false, localFailed: false };

  const ownVideoForOrientation = ownFailed ? undefined : ownVideoForOrientationRaw;
  const localSource = localFailed ? null : localSourceRaw;
  const resolvedSource = ownVideoForOrientation ? ownVideoForOrientation.url : localSource;

  // Fallback library (3) — `id` is OUR catalog id, never a free-exercise-db
  // id by construction (see exerciseFallbackVideoMap.ts's doc comment for
  // why). Falls back to `id` itself when unmapped so a coincidental direct
  // match (or a future id that happens to already align) still works —
  // harmless either way, since an unresolvable path just 404s into the
  // existing `onError` → `failed` placeholder below, same as before this
  // map existed.
  const fallbackVideoId = id ? (EXERCISE_FALLBACK_VIDEO_ID[id] ?? id) : null;

  // `setup` runs once, synchronously, right after this exact player is
  // constructed — unlike a separate effect keyed on `player`, it can't fire
  // after `useVideoPlayer` has already swapped/released the native object
  // when `resolvedSource` changes (that caused a NativeSharedObjectNotFound
  // crash from a stale `player.pause()` call).
  const player = useVideoPlayer(resolvedSource, (p) => {
    configureSilentDemoVideo(p);
    if (!resolvedSource) return;
    if (AppState.currentState === 'active' || AppState.currentState === null) p.play();
  });

  useEffect(() => {
    if (!resolvedSource) return;
    return observeSilentDemoAppState(player, AppState);
  }, [player, resolvedSource]);

  // `player` gets a fresh identity every time `resolvedSource` changes
  // (see above), so this always listens on the player actually attempting
  // THIS render's `resolvedSource` — no stale-closure risk despite
  // `useEventListener` only re-subscribing on emitter identity change.
  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status !== 'error') return;
    logWarn('workout', 'exercise_video_playback_failed', {
      exerciseId: id ?? undefined,
      tier: ownVideoForOrientation ? 'own' : localSource ? 'local' : 'unknown',
      errorMessage: error?.message,
    });
    setFailure((current) => {
      const base = current.key === identityKey ? current : { key: identityKey, ownFailed: false, localFailed: false };
      if (ownVideoForOrientation) return { ...base, key: identityKey, ownFailed: true };
      if (localSource) return { ...base, key: identityKey, localFailed: true };
      return base;
    });
  });

  useEffect(() => {
    // Also holds off while `ownVideoLoading` — no point animating a
    // crossfade this render won't even show (see the render branch below).
    if (resolvedSource || ownVideoLoading) return;
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
  }, [id, opacity, resolvedSource, ownVideoLoading]);

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

  if (resolvedSource) {
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

  // No source resolved yet AND we don't yet know whether an own video
  // exists — render blank (just the background) rather than the fallback
  // library, so it never flashes ahead of an own video that's about to
  // arrive. Once `ownVideoLoading` clears, this re-renders straight into
  // either the video above or the real fallback below — never both.
  if (ownVideoLoading) {
    return <View style={wrapper} />;
  }

  if (failed || !id) {
    return (
      <View style={[wrapper, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10.5,
            letterSpacing: 1.5,
            color: theme.colors.iconMuted,
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
          backgroundColor: theme.colors.background,
        }}
      />
      <Image
        source={{ uri: `${DB_BASE}/${fallbackVideoId}/0.jpg` }}
        onError={() => setFailed(true)}
        style={imgStyle}
      />
      <Animated.Image
        source={{ uri: `${DB_BASE}/${fallbackVideoId}/1.jpg` }}
        onError={() => setFailed(true)}
        style={[imgStyle, { opacity }]}
      />
    </View>
  );
}

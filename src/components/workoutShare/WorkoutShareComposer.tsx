import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { CtaButton } from '../ui/CtaButton';
import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import type { WorkoutShareData } from '../../workoutShare/data';
import { formatWorkoutShareDuration } from '../../workoutShare/data';
import { captureWorkoutSharePoster } from '../../workoutShare/export';
import { cleanupWorkoutShareFiles } from '../../workoutShare/files';
import { discardWorkoutSharePhoto, pickWorkoutSharePhoto } from '../../workoutShare/media';
import { createWorkoutShareController } from '../../workoutShare/share';
import { logInfo, logWarn } from '../../lib/logger';

type Photo = { uri: string; width: number; height: number };

type Props = {
  data: WorkoutShareData;
  /**
   * This composer is the post-workout terminal screen — there is no prior
   * screen to return to. Both the header close and the bottom CTA run the
   * exact same finish/cleanup path as the old WorkoutDone "Back to home" CTA.
   */
  onDone: () => void;
};

const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

function CropPhoto({ photo, width, height }: { photo: Photo; width: number; height: number }) {
  const aspect = photo.width / photo.height;
  const frameAspect = width / height;
  const baseWidth = aspect > frameAspect ? height * aspect : width;
  const baseHeight = aspect > frameAspect ? height : width / aspect;
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = clamp(savedScale.value * event.scale, 1, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const maxX = Math.max(0, (baseWidth * scale.value - width) / 2);
      const maxY = Math.max(0, (baseHeight * scale.value - height) / 2);
      translateX.value = clamp(translateX.value, -maxX, maxX);
      translateY.value = clamp(translateY.value, -maxY, maxY);
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((event) => {
      const maxX = Math.max(0, (baseWidth * scale.value - width) / 2);
      const maxY = Math.max(0, (baseHeight * scale.value - height) / 2);
      translateX.value = clamp(savedTranslateX.value + event.translationX, -maxX, maxX);
      translateY.value = clamp(savedTranslateY.value + event.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View style={{ width, height, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ width: baseWidth, height: baseHeight }, style]}>
          <Image source={{ uri: photo.uri }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function Poster({
  data,
  photo,
  width,
  height,
  posterRef,
}: {
  data: WorkoutShareData;
  photo: Photo | null;
  width: number;
  height: number;
  posterRef: React.RefObject<View | null>;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const scale = width / 360;
  const metrics = [
    [String(data.exerciseCount), t('done.shareComposer.exercises')],
    [String(data.completedSetCount), t('done.shareComposer.sets')],
    [formatWorkoutShareDuration(data.durationSeconds), t('done.shareComposer.duration')],
  ] as const;

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-poster"
      style={{ width, height, overflow: 'hidden', backgroundColor: '#040214' }}
    >
      {photo ? (
        <CropPhoto key={photo.uri} photo={photo} width={width} height={height} />
      ) : (
        <LinearGradient
          colors={['#0B2A64', '#080526', '#03010F']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{ width, height }}
        />
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(1,0,8,0.18)', 'rgba(1,0,8,0.76)']}
        locations={[0, 0.55, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: height * 0.38, bottom: 0 }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 28 * scale,
          right: 24 * scale,
          // ~252 px in the 1080x1920 export: clear of common Stories controls.
          bottom: 84 * scale,
        }}
      >
        <Text style={{ color: '#AFCBFF', fontFamily: theme.fonts.monoBold, fontSize: 10 * scale, letterSpacing: 1.7 * scale }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.68}
          style={{
            color: '#FFFFFF',
            fontFamily: theme.fonts.display,
            fontSize: 39 * scale,
            lineHeight: displayLineHeight(39 * scale),
            marginTop: 4 * scale,
            textTransform: 'uppercase',
          }}
        >
          {data.workoutName}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 17 * scale }}>
          {metrics.map(([value, label], index) => (
            <View key={label} style={{ flex: index === 2 ? 1.3 : 0.8, minWidth: 0 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 22 * scale }}>
                {value}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.68)', fontFamily: theme.fonts.monoBold, fontSize: 7.5 * scale, letterSpacing: 0.7 * scale, marginTop: 3 * scale }}>
                {label.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
        <Image
          source={require('../../../assets/aj-logo.png')}
          resizeMode="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 31 * scale, height: 31 * scale, marginTop: 22 * scale }}
        />
      </View>
    </View>
  );
}

function MediaAction({ label, icon, disabled, onPress }: {
  label: string;
  icon: 'camera' | 'plus' | 'x';
  disabled: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.controlBackground,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 7,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={16} color={theme.colors.textPrimary} />
      <Text numberOfLines={1} style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function WorkoutShareComposer({ data, onDone }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const posterRef = useRef<View>(null);
  const shareFlightRef = useRef(false);
  const controller = useMemo(() => createWorkoutShareController(), []);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Mount-once: this screen is only ever rendered once per finished workout
  // (WorkoutScreen's `finished` branch), so there is no `visible` toggle to
  // react to anymore.
  useEffect(() => {
    cleanupWorkoutShareFiles();
    logInfo('workout_share', 'workout_share_composer_opened');
  }, []);

  const choosePhoto = useCallback(async (source: 'camera' | 'library') => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await pickWorkoutSharePhoto(source);
    if (result.status === 'picked') {
      discardWorkoutSharePhoto(photo?.uri ?? null);
      setPhoto({ uri: result.uri, width: result.width, height: result.height });
      logInfo('workout_share', source === 'camera'
        ? 'workout_share_photo_camera_selected'
        : 'workout_share_photo_library_selected');
    } else if (result.status === 'permissionDenied') {
      setMessage(t('done.shareComposer.permissionDenied'));
    } else if (result.status === 'failed') {
      setMessage(t('done.shareComposer.photoFailed'));
    }
    setBusy(false);
  }, [busy, photo?.uri, t]);

  const removePhoto = useCallback(() => {
    if (busy) return;
    discardWorkoutSharePhoto(photo?.uri ?? null);
    setPhoto(null);
    setMessage(null);
    logInfo('workout_share', 'workout_share_no_photo_selected');
  }, [busy, photo?.uri]);

  const share = useCallback(async (destination: 'instagram' | 'generic') => {
    if (busy || shareFlightRef.current || controller.isSharing()) return;
    shareFlightRef.current = true;
    setBusy(true);
    setMessage(t('done.shareComposer.generating'));
    try {
      const uri = await captureWorkoutSharePoster(posterRef);
      logInfo('workout_share', 'workout_share_image_generated');
      logInfo('workout_share', destination === 'instagram'
        ? 'workout_share_instagram_pressed'
        : 'workout_share_generic_pressed');
      setMessage(t('done.shareComposer.sharing'));
      const result = await controller.share(uri, destination);
      if (result.status === 'fallback') setMessage(t('done.shareComposer.instagramFallback'));
      else if (result.status === 'unavailable') setMessage(t('done.shareComposer.shareUnavailable'));
      else setMessage(null);
    } catch (error) {
      logWarn('workout_share', 'workout_share_failed', { error });
      setMessage(t('done.shareComposer.shareFailed'));
    } finally {
      shareFlightRef.current = false;
      setBusy(false);
    }
  }, [busy, controller, t]);

  const finish = useCallback(() => {
    if (busy) return;
    discardWorkoutSharePhoto(photo?.uri ?? null);
    setPhoto(null);
    setMessage(null);
    onDone();
  }, [busy, onDone, photo?.uri]);

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    setPreviewWidth(Math.floor(event.nativeEvent.layout.width));
  };
  const previewHeight = previewWidth * 16 / 9;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={finish}>
      {/* This is the post-workout terminal screen — there is no screen
          underneath it anymore. A native Modal still gives this surface its
          own inset provider, so notch/status/navigation-bar metrics are
          measured independently and can never leak into the exported
          1080x1920 poster canvas. */}
      <SafeAreaProvider style={{ flex: 1 }}>
        <SafeAreaView
          style={{ flex: 1, backgroundColor: theme.colors.background }}
          edges={['top', 'right', 'bottom', 'left']}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('done.shareComposer.close')} disabled={busy} onPress={finish} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.controlBackground }}>
              <Icon name="x" size={18} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: 'center', color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 19, letterSpacing: 0.8 }}>
              {t('done.shareComposer.title').toUpperCase()}
            </Text>
            <View style={{ width: 42 }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            <View onLayout={onPreviewLayout} style={{ width: '100%', maxWidth: 360, alignSelf: 'center', aspectRatio: 9 / 16, borderRadius: 16, overflow: 'hidden', backgroundColor: '#03010F' }}>
              {previewWidth > 0 ? <Poster data={data} photo={photo} width={previewWidth} height={previewHeight} posterRef={posterRef} /> : null}
            </View>
            {photo ? (
              <Text style={{ textAlign: 'center', color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 9 }}>
                {t('done.shareComposer.adjustHint')}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <MediaAction label={t('done.shareComposer.camera')} icon="camera" disabled={busy} onPress={() => { void choosePhoto('camera'); }} />
              <MediaAction label={t('done.shareComposer.library')} icon="plus" disabled={busy} onPress={() => { void choosePhoto('library'); }} />
              <MediaAction label={t('done.shareComposer.noPhoto')} icon="x" disabled={busy} onPress={removePhoto} />
            </View>

            {message ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, textAlign: 'center', fontFamily: theme.fonts.uiMed, fontSize: 13, marginTop: 13 }}>
                {message}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('done.shareComposer.instagram')}
              accessibilityState={{ disabled: busy || previewWidth === 0 }}
              disabled={busy || previewWidth === 0}
              onPress={() => { void share('instagram'); }}
              style={{ minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18, backgroundColor: theme.colors.primaryEmphasis, opacity: busy ? 0.65 : 1 }}
            >
              {busy ? <ActivityIndicator color={theme.colors.primaryForeground} /> : (
                <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.display, fontSize: 17, letterSpacing: 1 }}>
                  {t('done.shareComposer.instagram').toUpperCase()}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('done.shareComposer.generic')}
              accessibilityState={{ disabled: busy || previewWidth === 0 }}
              disabled={busy || previewWidth === 0}
              onPress={() => { void share('generic'); }}
              style={{ minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.primaryBorderInteractive, alignItems: 'center', justifyContent: 'center', marginTop: 10, backgroundColor: theme.colors.controlBackground, opacity: busy ? 0.65 : 1 }}
            >
              <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.display, fontSize: 16, letterSpacing: 1 }}>
                {t('done.shareComposer.generic').toUpperCase()}
              </Text>
            </Pressable>

            {/* Not sharing is a first-class outcome — this must stay just as
                easy to reach as the share actions above it. */}
            <CtaButton
              ghost
              onPress={finish}
              disabled={busy}
              accessibilityLabel={t('done.backHome')}
              style={{ marginTop: 22 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 15, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  {t('done.backHome')}
                </Text>
                <Icon name="arrow-right" size={16} color={theme.colors.textPrimary} />
              </View>
            </CtaButton>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

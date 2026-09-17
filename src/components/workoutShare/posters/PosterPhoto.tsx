import { Image, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import type { WorkoutSharePhoto } from './types';

const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/**
 * Fills `width`x`height` with `photo`, cover-fit, repositionable by the user.
 *
 * The reposition pan is two-finger only (`minPointers(2)`, matching the
 * pinch it always travels with). The composer's design carousel now lives
 * directly on top of this same poster (dragging the poster left/right
 * switches designs), so a single-finger drag must belong to that swipe —
 * two fingers together (pinch + reposition) is the unambiguous "edit this
 * photo" gesture instead.
 */
export function PosterPhoto({ photo, width, height }: { photo: WorkoutSharePhoto; width: number; height: number }) {
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
    .minPointers(2)
    .maxPointers(2)
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

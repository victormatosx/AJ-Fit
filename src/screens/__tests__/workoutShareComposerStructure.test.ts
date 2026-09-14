import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const composer = readFileSync(
  new URL('../../components/workoutShare/WorkoutShareComposer.tsx', import.meta.url),
  'utf8',
);
const media = readFileSync(new URL('../../workoutShare/media.ts', import.meta.url), 'utf8');
const nativeAndroid = readFileSync(
  new URL('../../../modules/ajfit-instagram-stories/android/src/main/java/com/ajfit/instagramstories/AJFitInstagramStoriesModule.kt', import.meta.url),
  'utf8',
);
const nativeIos = readFileSync(
  new URL('../../../modules/ajfit-instagram-stories/ios/AJFitInstagramStoriesModule.swift', import.meta.url),
  'utf8',
);

describe('post-workout share architecture', () => {
  it('exposes the composer only inside the durable-success branch, as the terminal screen', () => {
    const finished = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(finished.indexOf('if (!completionConfirmed && !completionFailed)')).toBeLessThan(finished.indexOf('<WorkoutShareComposer'));
    expect(finished.indexOf('if (completionFailed)')).toBeLessThan(finished.indexOf('<WorkoutShareComposer'));
    expect(finished).toContain('data={buildWorkoutShareData');
    // No intermediate WorkoutDone screen anymore — the composer's `onDone`
    // is wired straight to WorkoutScreen's `onDone` prop (the finish/cleanup
    // callback owned by AppShell).
    expect(finished).not.toContain('<WorkoutDone');
  });

  it('the composer is the terminal screen: its onDone is the only exit, and it never runs lifecycle mutations itself', () => {
    expect(composer).not.toContain('onSessionCompleted');
    expect(composer).not.toContain('finalize');
    expect(composer).toContain('onDone: () => void');
    expect(composer).toContain('onPress={finish}');
  });

  it('supports camera, library, no-photo and one consistent poster', () => {
    expect(media).toContain('requestCameraPermissionsAsync');
    expect(media).toContain('requestMediaLibraryPermissionsAsync');
    expect(media).toContain("mediaTypes: ['images']");
    expect(composer).toContain("setPhoto(null)");
    expect(composer).toContain('workout-share-poster');
    expect(composer).toContain("colors={['#0B2A64', '#080526', '#03010F']}");
  });

  it('uses simultaneous pan and pinch for the exact captured view', () => {
    expect(composer).toContain('Gesture.Pinch()');
    expect(composer).toContain('Gesture.Pan()');
    expect(composer).toContain('Gesture.Simultaneous(pinch, pan)');
    expect(composer).toContain('captureWorkoutSharePoster(posterRef)');
  });

  it('measures safe-area insets inside the native modal without changing the poster', () => {
    const modalStart = composer.indexOf('<Modal visible');
    const modalEnd = composer.indexOf('</Modal>', modalStart);
    const modal = composer.slice(modalStart, modalEnd);
    expect(modal).toContain('<SafeAreaProvider style={{ flex: 1 }}>');
    expect(modal).toContain("edges={['top', 'right', 'bottom', 'left']}");
    expect(modal.indexOf('<SafeAreaProvider')).toBeLessThan(modal.indexOf('<SafeAreaView'));

    const posterStart = composer.indexOf('function Poster(');
    const posterEnd = composer.indexOf('function MediaAction(', posterStart);
    const poster = composer.slice(posterStart, posterEnd);
    expect(poster).not.toContain('SafeAreaProvider');
    expect(poster).not.toContain('SafeAreaView');
    expect(composer).toContain('aspectRatio: 9 / 16');
  });

  it('offers a clear, optional "back to home" exit that never forces a photo or a share', () => {
    expect(composer).toContain("accessibilityLabel={t('done.backHome')}");
    expect(composer).toContain('ghost');
    // Media selection and share destinations must stay independently
    // optional — none of them gate reaching `finish`.
    expect(composer).toContain('disabled={busy || previewWidth === 0}');
  });

  it('does not add any finalization or cardio side effect to the composer', () => {
    expect(composer).not.toContain('finalizeWorkoutSession');
    expect(composer).not.toContain('onSessionCompleted');
    expect(composer).not.toContain('restLiveActivity');
    expect(composer).not.toContain('onCardioCompleted');
  });

  it('uses the supported public Instagram Stories mechanisms', () => {
    expect(nativeAndroid).toContain('com.instagram.share.ADD_TO_STORY');
    expect(nativeAndroid).toContain('FLAG_GRANT_READ_URI_PERMISSION');
    expect(nativeAndroid).toContain('putExtra("source_application", metaAppId)');
    expect(nativeAndroid).toContain('setDataAndType(contentUri, JPEG_MIME)');
    expect(nativeIos).toContain('instagram-stories://share');
    expect(nativeIos).toContain('URLQueryItem(name: "source_application", value: metaAppID)');
    expect(nativeIos).toContain('com.instagram.sharedSticker.backgroundImage');
    expect(nativeIos.indexOf('UIPasteboard.general.setItems')).toBeLessThan(
      nativeIos.indexOf('openStoriesURL(urlScheme)'),
    );
    expect(nativeIos).toContain('expirationDate: Date().addingTimeInterval');
  });
});

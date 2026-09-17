import { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Icon } from '../../ui/Icon';
import { ProfileAvatar } from '../../ui/ProfileAvatar';
import { PosterPhoto } from './PosterPhoto';
import { useTheme } from '../../../theme';
import { useAuth } from '../../../state/AuthContext';
import { getDisplayFirstName } from '../../../lib/userName';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useAjLogoWhiteSource } from '../../../workoutShare/logo';
import type { WorkoutSharePosterProps } from './types';

const PHOTO_RECT_HORIZONTAL_INSET = 44;

/**
 * Design 6/6 — Social Feed (9:16). A social activity-feed post, not a
 * full-bleed poster: the real signed-in user's own avatar/name (`useAuth` +
 * `ProfileAvatar`, same as the Feed Post design — never fabricated) and a
 * real current timestamp, a "workout complete" headline, a bounded photo
 * card (the shared, user-picked photo, still repositionable via
 * `PosterPhoto`'s own pinch/two-finger-pan gesture — this design's
 * intentional exception to the other designs' full-bleed rule, matching
 * how a feed app frames one photo inside a fixed-size card), a row of
 * purely decorative like/comment/share glyphs (no fabricated counts — this
 * app has no such data), the same exercises/sets/duration stats every
 * design shows, and the same white AJ Fit wordmark the Feed Post design
 * closes with.
 *
 * A real flex column, not stacked absolute blocks: the photo card is the
 * one `flex: 1` child, so it simply absorbs whatever room the fixed-height
 * chrome around it doesn't use — no dead gaps, no manual pixel tuning.
 */
export function PosterSocial({ data, photo, posterRef, width, height }: WorkoutSharePosterProps) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['workout', 'profile']);
  const { user, profile } = useAuth();
  const [photoBoxHeight, setPhotoBoxHeight] = useState(0);
  const logoSource = useAjLogoWhiteSource();
  const scale = width / 360;
  const timeLabel = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const firstName = getDisplayFirstName({
    profileName: profile?.profile.name,
    authDisplayName: user?.displayName,
    email: user?.email ?? profile?.profile.email,
  });
  const displayName = firstName === 'Atleta' ? t('profile:fallback.athlete') : firstName;
  const stats = [
    [formatWorkoutShareDuration(data.durationSeconds), t('done.shareComposer.duration')],
    [String(data.exerciseCount), t('done.shareComposer.exercises')],
    [String(data.completedSetCount), t('done.shareComposer.sets')],
  ] as const;

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-poster"
      style={{ width, height, overflow: 'hidden', backgroundColor: '#0B0F1A' }}
    >
      <LinearGradient
        colors={theme.gradients.background}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View style={{ flex: 1, paddingHorizontal: 22 * scale, paddingTop: 30 * scale, paddingBottom: 20 * scale }}>
        {/* Header — the real signed-in user's own avatar + name. */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ProfileAvatar
            displayName={displayName}
            photoURL={profile?.profile.photoURL}
            photoVersion={profile?.profile.photoVersion}
            size={44 * scale}
          />
          <View style={{ marginLeft: 12 * scale }}>
            <Text style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 14.5 * scale }}>
              {displayName}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontFamily: theme.fonts.ui, fontSize: 11.5 * scale, marginTop: 2 * scale }}>
              {t('done.shareComposer.postTimestamp', { time: timeLabel })}
            </Text>
          </View>
        </View>

        {/* "Workout [name] complete!" headline. */}
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 19 * scale, marginTop: 18 * scale }}
        >
          {t('done.shareComposer.postCompletedTitle', { name: data.workoutName })}
        </Text>

        {/* The photo card — the one flex:1 child, so it fills whatever
            room is left between the fixed-height chrome above and below
            it. Measured via onLayout because `PosterPhoto` needs an exact
            pixel height up front, not a flex value. */}
        <View
          onLayout={(event) => setPhotoBoxHeight(Math.round(event.nativeEvent.layout.height))}
          style={{ flex: 1, marginTop: 16 * scale, borderRadius: 14 * scale, overflow: 'hidden', backgroundColor: '#050B1E' }}
        >
          {photo ? (
            photoBoxHeight > 0 ? (
              <PosterPhoto
                key={photo.uri}
                photo={photo}
                width={width - PHOTO_RECT_HORIZONTAL_INSET * scale}
                height={photoBoxHeight}
              />
            ) : null
          ) : (
            <LinearGradient
              colors={['#111827', '#0B121D', '#04070B']}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={{ flex: 1 }}
            />
          )}
        </View>

        {/* Purely decorative like/comment/share row — the heart intentionally
            renders in its selected state, but there are no fabricated counts. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 * scale, marginTop: 14 * scale }}>
          <Icon name="heart" size={20 * scale} color={theme.colors.danger} filled />
          <Icon name="message" size={20 * scale} color="rgba(255,255,255,0.85)" />
          <Icon name="share" size={20 * scale} color="rgba(255,255,255,0.85)" />
        </View>

        <View style={{ flexDirection: 'row', marginTop: 16 * scale }}>
          {stats.map(([value, label]) => (
            <View key={label} style={{ flex: 1, alignItems: 'flex-start' }}>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontFamily: theme.fonts.ui, fontSize: 11.5 * scale }}>
                {label}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 17 * scale, marginTop: 3 * scale }}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        {/* White brand mark + wordmark, matching the Feed Post design's footer. */}
        <View style={{ alignItems: 'center', marginTop: 16 * scale }}>
          <Image
            source={logoSource}
            contentFit="contain"
            tintColor="#FFFFFF"
            accessibilityLabel="AJ Fit"
            style={{ width: 20 * scale, height: 20 * scale }}
          />
          <Text style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiSemi, fontSize: 11 * scale, marginTop: 5 * scale, letterSpacing: 0.4 }}>
            AJ Fit App
          </Text>
        </View>
      </View>
    </View>
  );
}

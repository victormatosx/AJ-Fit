import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { BodyMuscleMap } from '../../fitness/BodyMuscleMap';
import { ProfileAvatar } from '../../ui/ProfileAvatar';
import { OutlineNumber } from '../../ui/OutlineNumber';
import { useTheme } from '../../../theme';
import { useAuth } from '../../../state/AuthContext';
import { getDisplayFirstName } from '../../../lib/userName';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useWorkoutShareGymArtSource } from '../../../workoutShare/backgroundArt';
import { useAjLogoWhiteSource } from '../../../workoutShare/logo';
import type { WorkoutSharePosterProps } from './types';

/**
 * Design 5/5 — Feed Post (9:16). Styled like a native in-app activity
 * screen: the top info column (avatar/name/title/stats) is flat app UI —
 * the app's own `theme.gradients.background`, never a photo. The bottom
 * "Workout" panel uses the fixed gym artwork behind the real
 * `BodyMuscleMap`, under a heavy blue veil so the photo remains subtle and
 * the workout information stays dominant.
 *
 * An account row (the real signed-in user's own avatar/name via `useAuth` +
 * `ProfileAvatar` — the same source HomeScreen/AppShell already use, never
 * fabricated) + timestamp, the workout name and a one-line summary, a stat
 * row right above the photo/BodyMap panel (highlighted in the same
 * `primaryEmphasis` blue Home uses for its own body map).
 *
 * Laid out as a real flex column (not stacked absolute blocks) — a single
 * flexible spacer between the summary and the stat row absorbs whatever
 * room is left, so there's never a dead empty gap in the middle regardless
 * of how long the workout name/summary are.
 *
 * The timestamp is the real current device time at render (this poster is
 * only ever shown right after a workout finishes, so "now" is an honest
 * stand-in for "when this was posted") — never a stored/invented workout
 * time.
 */
export function PosterCreative({ data, posterRef, width, height }: WorkoutSharePosterProps) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['workout', 'profile']);
  const { user, profile } = useAuth();
  const logoSource = useAjLogoWhiteSource();
  const gymArtSource = useWorkoutShareGymArtSource();
  const scale = width / 360;
  const hasBodyMap = data.bodyMap.primary.length > 0;
  // An even 50/50 split with the info column above — the BodyMap panel is
  // exactly half the poster whenever it has real data to show.
  const topHeight = hasBodyMap ? height / 2 : height;
  const bodyMapHeight = height - topHeight;
  const timeLabel = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const firstName = getDisplayFirstName({
    profileName: profile?.profile.name,
    authDisplayName: user?.displayName,
    email: user?.email ?? profile?.profile.email,
  });
  const displayName = firstName === 'Atleta' ? t('profile:fallback.athlete') : firstName;
  const summaryLine = [
    `${data.exerciseCount} ${t('done.shareComposer.exercises').toLowerCase()}`,
    `${data.completedSetCount} ${t('done.shareComposer.sets').toLowerCase()}`,
  ].join(' · ');
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
      style={{ width, height, overflow: 'hidden', backgroundColor: '#050B1E' }}
    >
      <LinearGradient
        colors={theme.gradients.background}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View style={{ height: topHeight, paddingHorizontal: 26 * scale, paddingTop: 34 * scale }}>
        {/* Same hollow "AJ" watermark ProfileScreen uses in its header —
            thin stroke, semi-opaque, top-right. Purely decorative. */}
        <OutlineNumber
          size={260 * scale}
          style={{ position: 'absolute', top: -30 * scale, right: -46 * scale, opacity: 0.35 }}
        >
          AJ
        </OutlineNumber>

        {/* Account row — the real signed-in user's own avatar/name, timestamp. */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ProfileAvatar
            displayName={displayName}
            photoURL={profile?.profile.photoURL}
            photoVersion={profile?.profile.photoVersion}
            size={48 * scale}
          />
          <View style={{ marginLeft: 12 * scale }}>
            <Text style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 15 * scale }}>
              {displayName}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: theme.fonts.ui, fontSize: 12 * scale, marginTop: 2 * scale }}>
              {t('done.shareComposer.postTimestamp', { time: timeLabel })}
            </Text>
          </View>
        </View>

        {/* Workout title + one-line summary — generous room below the avatar row. */}
        <View style={{ marginTop: 44 * scale }}>
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 28 * scale }}
          >
            {data.workoutName}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ color: 'rgba(255,255,255,0.72)', fontFamily: theme.fonts.ui, fontSize: 15 * scale, marginTop: 10 * scale }}
          >
            {summaryLine}
          </Text>
        </View>

        {/* Single flexible spacer — absorbs the remaining room so the stat
            row always sits right above the bottom panel, never floating in
            a dead middle gap. */}
        <View style={{ flex: 1, minHeight: 20 * scale }} />

        <View style={{ flexDirection: 'row', paddingBottom: 22 * scale }}>
          {stats.map(([value, label]) => (
            <View key={label} style={{ flex: 1, alignItems: 'flex-start' }}>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontFamily: theme.fonts.ui, fontSize: 12.5 * scale }}>
                {label}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 20 * scale, marginTop: 4 * scale }}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom "Workout" panel with the real BodyMap — an even 50/50 split
          with the info column above, and omitted (not faked) when no
          muscle resolves. The label sits near the top of the panel; the
          map fills the rest of this half, centered. */}
      {hasBodyMap ? (
        <View
          style={{
            height: bodyMapHeight,
            overflow: 'hidden',
            borderTopWidth: 1,
            borderTopColor: 'rgba(255,255,255,0.1)',
          }}
        >
          {/* Fixed gym artwork for this model only. The near-opaque blue
              veil keeps the image intentionally understated behind the
              muscle map and labels. */}
          <Image
            source={gymArtSource}
            contentFit="cover"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, width, height: bodyMapHeight }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2,32,88,0.92)' }}
          />

          <View style={{ flex: 1, paddingTop: 18 * scale, paddingBottom: 10 * scale, paddingHorizontal: 26 * scale }}>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: theme.fonts.uiSemi, fontSize: 14 * scale, marginBottom: 10 * scale }}>
              {t('done.shareComposer.bodyMapLabel')}
            </Text>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <BodyMuscleMap
                primaryMuscles={data.bodyMap.primary}
                secondaryMuscles={data.bodyMap.secondary}
                size={Math.max(70, (bodyMapHeight - 18 * scale - 10 * scale - 28 * scale - 38 * scale) / 1.85)}
                activeColor={theme.colors.primaryEmphasis}
                baseColor="rgba(255,255,255,0.14)"
                outlineColor="rgba(255,255,255,0.22)"
              />
            </View>

            {/* White brand mark + wordmark, closing out the panel. */}
            <View style={{ alignItems: 'center', marginTop: 8 * scale }}>
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
      ) : null}
    </View>
  );
}

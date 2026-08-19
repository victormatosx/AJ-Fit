import { Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Display } from './Display';
import { Icon } from './Icon';
import { useTheme } from '../../theme';
import { versionedPhotoURL, type PhotoCacheVersion } from '../../lib/profilePhotoUrl';

function initialsFor(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return initials || 'AJ';
}

export function ProfileAvatar({
  displayName,
  photoURL,
  photoVersion,
  /** Bundled local image (e.g. `require(...)`) — takes priority over `photoURL`
   * and skips cache-busting, since a bundled asset has no remote version. */
  photoSource,
  size,
  editable = false,
  onPress,
}: {
  displayName: string;
  photoURL?: string | null;
  photoVersion?: PhotoCacheVersion;
  photoSource?: ImageSourcePropType;
  size: number;
  editable?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('profile');
  const radius = Math.round(size * 0.22);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={
        editable
          ? t('photo.accessibility.editable')
          : t('photo.accessibility.avatar')
      }
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ width: size, height: size, opacity: pressed ? 0.78 : 1 })}
    >
      <LinearGradient
        colors={theme.gradients.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          borderBottomRightRadius: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Display size={Math.max(14, Math.round(size * 0.38))}>{initialsFor(displayName)}</Display>
      </LinearGradient>
      {photoSource || photoURL ? (
        <Image
          source={photoSource ?? versionedPhotoURL(photoURL as string, photoVersion)}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={120}
          priority="high"
          accessible={false}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, borderBottomRightRadius: 0 },
          ]}
        />
      ) : null}
      {editable ? (
        <View
          style={{
            position: 'absolute',
            right: -3,
            bottom: -3,
            width: 22,
            height: 22,
            borderRadius: 7,
            backgroundColor: theme.colors.background,
            borderWidth: 2,
            borderColor: theme.colors.primaryEmphasis,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="camera" size={11} color={theme.colors.textPrimary} stroke={2} />
        </View>
      ) : null}
    </Pressable>
  );
}

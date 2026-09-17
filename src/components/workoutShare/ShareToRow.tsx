import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontAwesome5 } from '@expo/vector-icons';

import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import {
  WORKOUT_SHARE_DESTINATIONS,
  type WorkoutShareDestinationConfig,
  type WorkoutShareDestinationIcon,
  type WorkoutShareDestinationId,
} from '../../workoutShare/shareDestinations';

// Minimal, uniform treatment across all 6 destinations: a plain white
// outline/glyph at a consistent size, no circular badge, no brand-color
// fill, no gradient. Instagram/Instagram Stories fall into the same
// FontAwesome5 brand-glyph path as TikTok/Facebook/WhatsApp now — the
// custom gradient Icon badge from previous passes is gone.
const ICON_SIZE = 26;
const ICON_COLOR = '#FFFFFF';

function DestinationIcon({ icon }: { icon: WorkoutShareDestinationIcon }) {
  if (icon.kind === 'system') {
    return <Icon name={icon.name} size={ICON_SIZE} color={ICON_COLOR} />;
  }
  return <FontAwesome5 name={icon.name} size={ICON_SIZE} color={ICON_COLOR} />;
}

function DestinationItem({
  destination,
  disabled,
  busy,
  onPress,
}: {
  destination: WorkoutShareDestinationConfig;
  disabled: boolean;
  busy: boolean;
  onPress: (id: WorkoutShareDestinationId) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const label = t(destination.labelKey as never) as string;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => onPress(destination.id)}
      hitSlop={8}
      style={{
        width: 64,
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <DestinationIcon icon={destination.icon} />
      <Text
        numberOfLines={2}
        style={{
          color: theme.colors.textSecondary,
          fontFamily: theme.fonts.uiMed,
          fontSize: 10.5,
          textAlign: 'center',
          lineHeight: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ShareToRow({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (id: WorkoutShareDestinationId) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');

  return (
    <View style={{ marginTop: 20 }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontFamily: theme.fonts.uiSemi,
          fontSize: 12,
          letterSpacing: 0.4,
          marginBottom: 12,
        }}
      >
        {t('done.shareComposer.shareTo')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 16, paddingRight: 8 }}
      >
        {WORKOUT_SHARE_DESTINATIONS.map((destination) => (
          <DestinationItem
            key={destination.id}
            destination={destination}
            disabled={disabled}
            busy={disabled}
            onPress={onSelect}
          />
        ))}
      </ScrollView>
    </View>
  );
}

import React from 'react';
import { ActivityIndicator, View, Text, Pressable, StyleProp, ViewStyle } from 'react-native';
import { Slash } from './Display';
import { Icon, IconName } from './Icon';
import { opacity, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';

export function SettingsHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <Slash style={[{ marginBottom: 10 }, style]}>{children}</Slash>;
}

export function SettingsDivider() {
  const { theme } = useTheme();

  return <View style={{ height: 1, backgroundColor: theme.colors.settingsDivider }} />;
}

export function SettingsValue({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  return (
    <Text
      style={{
        fontFamily: theme.fonts.mono,
        fontSize: 10.5,
        color: theme.colors.textMuted,
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}

export type SettingsItemData = {
  icon: IconName;
  label: string;
  description?: string;
  value?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Shows a small spinner in place of the chevron/value, e.g. while an async action is in flight. */
  loading?: boolean;
  onPress?: () => void;
};

export function SettingsItem({
  icon,
  label,
  description,
  value,
  danger,
  disabled = false,
  loading = false,
  onPress,
}: SettingsItemData) {
  const { theme } = useTheme();
  const accent = danger ? theme.colors.danger : theme.colors.primaryEmphasis;
  const interactive = !!onPress && !disabled && !loading;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { disabled } : undefined}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3.5],
        minHeight: 48,
        paddingVertical: spacing[3.5],
        paddingHorizontal: spacing[4],
        opacity: disabled ? opacity.disabled : 1,
        backgroundColor: pressed && interactive ? theme.colors.surfacePressed : 'transparent',
      })}
    >
      <Icon name={icon} size={16} color={accent} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: theme.fonts.uiSemi,
            fontSize: 14,
            color: danger ? theme.colors.dangerText : theme.colors.textPrimary,
          }}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              theme.typography.bodySmall,
              { color: theme.colors.textSecondary, marginTop: spacing[1] },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : (
        <>
          {value ? <SettingsValue>{value}</SettingsValue> : null}
          {onPress ? (
            <Icon name="chevron-right" size={14} color={theme.colors.textFaint} />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export function SettingsSection({
  title,
  description,
  items,
  style,
}: {
  title: string;
  description?: string;
  items: SettingsItemData[];
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();

  return (
    <View style={[{ paddingHorizontal: 22, paddingBottom: 16 }, style]}>
      <SettingsHeader style={description ? { marginBottom: spacing[2] } : undefined}>
        {title}
      </SettingsHeader>
      {description ? (
        <Text
          style={[
            theme.typography.bodySmall,
            {
              color: theme.colors.textSecondary,
              marginBottom: spacing[3],
              maxWidth: 360,
            },
          ]}
        >
          {description}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: 14,
          overflow: 'hidden',
          backgroundColor: theme.colors.settingsGroupBackground,
          borderWidth: 1,
          borderColor: theme.colors.settingsGroupBorder,
        }}
      >
        {items.map((it, i) => (
          <React.Fragment key={`${it.label}-${i}`}>
            {i > 0 && <SettingsDivider />}
            <SettingsItem {...it} />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

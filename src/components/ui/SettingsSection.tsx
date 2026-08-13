import React from 'react';
import { View, Text, Pressable, StyleProp, ViewStyle } from 'react-native';
import { Slash } from './Display';
import { Icon, IconName } from './Icon';
import { colors, fonts, opacity, spacing, typography } from '../../theme/tokens';

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
  return <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />;
}

export function SettingsValue({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 10.5,
        color: colors.mute,
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
  onPress?: () => void;
};

export function SettingsItem({
  icon,
  label,
  description,
  value,
  danger,
  disabled = false,
  onPress,
}: SettingsItemData) {
  const accent = danger ? colors.danger : colors.accentHi;
  const interactive = !!onPress && !disabled;

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
        backgroundColor: pressed && interactive ? colors.surfacePressed : 'transparent',
      })}
    >
      <Icon name={icon} size={16} color={accent} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fonts.uiSemi,
            fontSize: 14,
            color: danger ? colors.dangerText : colors.text,
          }}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              typography.bodySmall,
              { color: colors.textSecondary, marginTop: spacing[1] },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {value ? <SettingsValue>{value}</SettingsValue> : null}
      {onPress ? <Icon name="chevron-right" size={14} color={colors.faint} /> : null}
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
  return (
    <View style={[{ paddingHorizontal: 22, paddingBottom: 16 }, style]}>
      <SettingsHeader style={description ? { marginBottom: spacing[2] } : undefined}>
        {title}
      </SettingsHeader>
      {description ? (
        <Text
          style={[
            typography.bodySmall,
            {
              color: colors.textSecondary,
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
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.06)',
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

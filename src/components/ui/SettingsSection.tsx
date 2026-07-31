import React from 'react';
import { View, Text, Pressable, StyleProp, ViewStyle } from 'react-native';
import { Slash } from './Display';
import { Icon, IconName } from './Icon';
import { colors, fonts } from '../../theme/tokens';

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
  value?: string;
  danger?: boolean;
  onPress?: () => void;
};

export function SettingsItem({ icon, label, value, danger, onPress }: SettingsItemData) {
  const accent = danger ? '#ff7676' : colors.accentHi;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: pressed && onPress ? 'rgba(255,255,255,0.04)' : 'transparent',
      })}
    >
      <Icon name={icon} size={16} color={accent} />
      <Text
        style={{
          flex: 1,
          fontFamily: fonts.uiSemi,
          fontSize: 14,
          color: danger ? '#ff9a9a' : '#fff',
        }}
      >
        {label}
      </Text>
      {value ? <SettingsValue>{value}</SettingsValue> : null}
      {onPress ? <Icon name="chevron-right" size={14} color="rgba(255,255,255,0.3)" /> : null}
    </Pressable>
  );
}

export function SettingsSection({
  title,
  items,
  style,
}: {
  title: string;
  items: SettingsItemData[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ paddingHorizontal: 22, paddingBottom: 16 }, style]}>
      <SettingsHeader>{title}</SettingsHeader>
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

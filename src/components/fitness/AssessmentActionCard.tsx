import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';

function ActionOption({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flex: 1,
        padding: 16,
        borderRadius: 14,
        backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 10,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: 'rgba(11,112,249,0.16)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={17} color={colors.accentHi} />
      </View>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: '#fff' }}>{title}</Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, color: colors.mute }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

export function AssessmentActionCard({
  onGuided,
  onImport,
}: {
  onGuided: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation('assessment');
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <ActionOption
        icon="dumbbell"
        title={t('actions.guided.title')}
        subtitle={t('actions.guided.description')}
        onPress={onGuided}
        accessibilityLabel={t('accessibility.openGuided')}
      />
      <ActionOption
        icon="download"
        title={t('actions.import.title')}
        subtitle={t('actions.import.description')}
        onPress={onImport}
        accessibilityLabel={t('accessibility.openImport')}
      />
    </View>
  );
}

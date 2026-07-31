import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Icon, IconName } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';

function ActionOption({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <ActionOption
        icon="dumbbell"
        title="Avaliação Guiada"
        subtitle="Peso, medidas e dobras — o app calcula tudo"
        onPress={onGuided}
      />
      <ActionOption
        icon="download"
        title="Importar Avaliação"
        subtitle="Já tem os resultados? Registre direto"
        onPress={onImport}
      />
    </View>
  );
}

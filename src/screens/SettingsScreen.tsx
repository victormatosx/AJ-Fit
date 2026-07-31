import { View, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { SettingsSection } from '../components/ui/SettingsSection';

export function SettingsScreen({ onBack }: { onBack?: () => void }) {
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingBottom: 8,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable
            onPress={onBack}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>CONFIGURAÇÕES</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <SettingsSection
            title="CONTA"
            items={[
              { icon: 'user', label: 'Editar perfil', onPress: () => {} },
              { icon: 'crown', label: 'Assinatura', onPress: () => {} },
              { icon: 'key', label: 'Métodos de Login', onPress: () => {} },
              { icon: 'shield', label: 'Segurança', onPress: () => {} },
            ]}
          />

          <SettingsSection
            title="TREINO"
            items={[
              { icon: 'dumbbell', label: 'Preferências de treino', onPress: () => {} },
              { icon: 'timer', label: 'Timers e Sons', onPress: () => {} },
            ]}
          />

          <SettingsSection
            title="NOTIFICAÇÕES"
            items={[{ icon: 'bell', label: 'Notificações', onPress: () => {} }]}
          />

          <SettingsSection
            title="PREFERÊNCIAS"
            items={[
              { icon: 'moon', label: 'Tema', value: 'Escuro', onPress: () => {} },
              { icon: 'globe', label: 'Idioma', value: 'Português (Brasil)', onPress: () => {} },
              { icon: 'ruler', label: 'Unidades', value: 'kg • cm', onPress: () => {} },
            ]}
          />

          <SettingsSection
            title="PRIVACIDADE"
            items={[
              { icon: 'shield', label: 'Privacidade', onPress: () => {} },
              { icon: 'download', label: 'Exportar dados', onPress: () => {} },
              { icon: 'trash', label: 'Excluir conta', danger: true, onPress: () => {} },
            ]}
          />

          <SettingsSection
            title="SUPORTE"
            items={[
              { icon: 'help-circle', label: 'Central de ajuda', onPress: () => {} },
              { icon: 'message', label: 'Enviar feedback', onPress: () => {} },
              { icon: 'alert-triangle', label: 'Reportar problema', onPress: () => {} },
            ]}
          />

          <SettingsSection
            title="SOBRE"
            items={[
              { icon: 'info', label: 'Versão', value: 'v1.0.0' },
              { icon: 'file-text', label: 'Licenças', onPress: () => {} },
            ]}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

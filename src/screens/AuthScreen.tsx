import React from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash } from '../components/ui/Display';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';

export function AuthScreen({ onDone }: { onDone: () => void }) {
  return (
    <ScreenBg>
      <OutlineNumber
        size={260}
        style={{ position: 'absolute', top: -40, right: -50, opacity: 0.35 }}
      >
        AJ
      </OutlineNumber>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, paddingHorizontal: 26, paddingTop: 20, paddingBottom: 36 }}>
          <View>
            <Slash style={{ marginBottom: 14 }}>ÚLTIMO PASSO</Slash>
            <Display size={38}>GARANTA</Display>
            <Display size={38}>SEU PLANO.</Display>
            <Text
              style={{
                marginTop: 14,
                color: colors.mute,
                fontSize: 14.5,
                fontFamily: fonts.ui,
              }}
            >
              Crie sua conta para salvar o plano e ativar os 7 dias grátis.
            </Text>
          </View>

          <View style={{ marginTop: 30, gap: 12 }}>
            <AuthInput icon="mail" placeholder="seu@email.com" />
            <AuthInput icon="lock" placeholder="Senha" secure trailing="eye" />
          </View>

          <View style={{ flex: 1 }} />

          <View style={{ gap: 11 }}>
            <CtaButton onPress={onDone}>
              <Text
                style={{
                  color: '#fff',
                  fontFamily: fonts.display,
                  fontSize: 17,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                Começar teste grátis
              </Text>
              <Icon name="arrow-right" size={18} color="#fff" />
            </CtaButton>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.hair }} />
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
                OU
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.hair }} />
            </View>

            <CtaButton ghost onPress={onDone}>
              <Icon name="apple" size={19} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>
                Continuar com Apple
              </Text>
            </CtaButton>

            <CtaButton ghost onPress={onDone}>
              <Icon name="google" size={17} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 14 }}>
                Continuar com Google
              </Text>
            </CtaButton>

            <Text
              style={{
                textAlign: 'center',
                marginTop: 6,
                fontSize: 13,
                color: colors.mute,
                fontFamily: fonts.ui,
              }}
            >
              Já é membro?{' '}
              <Text style={{ color: colors.accentHi, fontFamily: fonts.uiSemi }}>Entrar</Text>
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

function AuthInput({
  icon,
  placeholder,
  secure,
  trailing,
}: {
  icon: IconName;
  placeholder: string;
  secure?: boolean;
  trailing?: IconName;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        height: 56,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.045)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.09)',
      }}
    >
      <Icon name={icon} size={18} color="rgba(255,255,255,0.45)" />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.35)"
        secureTextEntry={secure}
        autoCapitalize="none"
        keyboardType={icon === 'mail' ? 'email-address' : 'default'}
        style={{
          flex: 1,
          color: '#fff',
          fontSize: 15,
          fontFamily: fonts.ui,
        }}
      />
      {trailing && <Icon name={trailing} size={18} color="rgba(255,255,255,0.45)" />}
    </View>
  );
}

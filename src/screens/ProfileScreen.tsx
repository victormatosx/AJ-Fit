import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';

export function ProfileScreen() {
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          {/* athlete header */}
          <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18 }}>
            <OutlineNumber
              size={150}
              style={{ position: 'absolute', top: -16, right: -10, opacity: 0.35 }}
            >
              AJ
            </OutlineNumber>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: 16,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="user" size={32} color="rgba(255,255,255,0.35)" />
              </View>
              <View>
                <MonoLabel>MEMBRO Nº 0001 · DESDE 2026</MonoLabel>
                <Display size={26} style={{ marginTop: 6 }}>
                  ARNALDO
                </Display>
                <Display size={26}>JUNIOR</Display>
              </View>
            </View>
          </View>

          {/* level bar */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <Card style={{ padding: 16 }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}
              >
                <Slash>NÍVEL AJ · INTERMEDIÁRIO</Slash>
                <MonoLabel color={colors.accentHi}>2.450 XP</MonoLabel>
              </View>
              <SegBar value={0.62} segs={16} />
              <MonoLabel style={{ marginTop: 8 }}>
                FALTAM 950 XP PARA{' '}
                <Text style={{ color: colors.accentHi, fontFamily: fonts.monoBold }}>AVANÇADO</Text>
              </MonoLabel>
            </Card>
          </View>

          {/* subscription */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <LinearGradient
              colors={['rgba(11,112,249,0.28)', 'rgba(11,112,249,0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                padding: 18,
                borderRadius: 14,
                borderBottomRightRadius: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                borderWidth: 1,
                borderColor: 'rgba(11,112,249,0.4)',
              }}
            >
              <Icon name="crown" size={22} color={colors.accentHi} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 15,
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}
                >
                  MEMBRO AJ · ANUAL
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: colors.mute,
                    letterSpacing: 1,
                    marginTop: 3,
                  }}
                >
                  RENOVA EM 14 MAR 2027
                </Text>
              </View>
              <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.5)" />
            </LinearGradient>
          </View>

          <ProfileGroup
            title="OBJETIVOS & PLANO"
            items={[
              { i: 'target', l: 'Meu objetivo', d: 'Hipertrofia' },
              { i: 'dumbbell', l: 'Plano atual', d: 'AJ Apex · 12 sem' },
              { i: 'calendar', l: 'Frequência', d: '4 dias/sem' },
            ]}
          />
          <ProfileGroup
            title="CONTA"
            items={[
              { i: 'user', l: 'Editar perfil' },
              { i: 'crown', l: 'Assinatura' },
              { i: 'shield', l: 'Privacidade' },
            ]}
          />
          <ProfileGroup
            title="PREFERÊNCIAS"
            items={[
              { i: 'settings', l: 'Configurações' },
              { i: 'timer', l: 'Timers e sons' },
            ]}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function ProfileGroup({
  title,
  items,
}: {
  title: string;
  items: { i: IconName; l: string; d?: string }[];
}) {
  return (
    <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
      <Slash style={{ marginBottom: 10 }}>{title}</Slash>
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
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Icon name={it.i} size={16} color={colors.accentHi} />
            <Text
              style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: '#fff' }}
            >
              {it.l}
            </Text>
            {it.d && (
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 10.5,
                  color: colors.mute,
                  letterSpacing: 0.5,
                }}
              >
                {it.d}
              </Text>
            )}
            <Icon name="chevron-right" size={14} color="rgba(255,255,255,0.3)" />
          </View>
        ))}
      </View>
    </View>
  );
}

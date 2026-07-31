import React from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';

const SUBSCRIPTION_LABEL: Record<string, string> = {
  TRIAL: 'AJ PREMIUM · TESTE GRÁTIS',
  ACTIVE: 'AJ PREMIUM · ATIVO',
  CANCELED: 'AJ PREMIUM · CANCELADO',
  BILLING_ISSUE: 'AJ PREMIUM · PAGAMENTO PENDENTE',
  EXPIRED: 'AJ PREMIUM · EXPIRADO',
};

const PROVIDER_META: { id: string; label: string; icon: IconName }[] = [
  { id: 'google.com', label: 'Google', icon: 'google' },
  { id: 'apple.com', label: 'Apple', icon: 'apple' },
  { id: 'password', label: 'E-mail/Senha', icon: 'mail' },
];

export function ProfileScreen({
  onOpenAssessment,
  onOpenSettings,
}: {
  onOpenAssessment?: () => void;
  onOpenSettings?: () => void;
}) {
  const { user, profile, linkedProviders, logout } = useAuth();

  const email = profile?.email ?? user?.email ?? '';
  const displayName =
    profile?.name?.trim() ||
    user?.displayName?.trim() ||
    (email ? email.split('@')[0] : 'Atleta');
  const sinceYear = profile?.createdAt
    ? String(profile.createdAt.toDate().getFullYear())
    : '—';
  const subscriptionLabel = profile?.subscriptionStatus
    ? SUBSCRIPTION_LABEL[profile.subscriptionStatus] ?? 'AJ PREMIUM'
    : 'SEM ASSINATURA ATIVA';
  const subscriptionSub = profile?.subscriptionStatus
    ? 'Gerenciado pela loja (RevenueCat)'
    : 'Ative seu teste grátis de 7 dias';

  function confirmLogout() {
    Alert.alert('Sair da conta', 'Deseja realmente sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          logout().catch(() =>
            Alert.alert('Erro', 'Não foi possível sair. Tente novamente.'),
          );
        },
      },
    ]);
  }

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
              <View style={{ flex: 1 }}>
                <MonoLabel>MEMBRO · DESDE {sinceYear}</MonoLabel>
                <Display size={26} style={{ marginTop: 6 }} numberOfLines={1}>
                  {displayName.toUpperCase()}
                </Display>
                {email ? (
                  <Text
                    style={{
                      fontFamily: fonts.ui,
                      fontSize: 12.5,
                      color: colors.mute,
                      marginTop: 4,
                    }}
                    numberOfLines={1}
                  >
                    {email}
                  </Text>
                ) : null}
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
                  {subscriptionLabel}
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
                  {subscriptionSub}
                </Text>
              </View>
              <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.5)" />
            </LinearGradient>
          </View>

          {/* assessment entry */}
          {onOpenAssessment && (
            <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
              <Pressable onPress={onOpenAssessment}>
                <LinearGradient
                  colors={['rgba(11,112,249,0.2)', 'rgba(11,112,249,0.03)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    padding: 18,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(11,112,249,0.35)',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      backgroundColor: 'rgba(11,112,249,0.18)',
                      borderWidth: 1,
                      borderColor: 'rgba(11,112,249,0.4)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="chart" size={19} color={colors.accentHi} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: '#fff' }}>
                      Avaliação Física
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.ui,
                        fontSize: 12,
                        color: colors.mute,
                        marginTop: 2,
                      }}
                    >
                      Medidas, dobras cutâneas e evolução
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.5)" />
                </LinearGradient>
              </Pressable>
            </View>
          )}

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
              { i: 'settings', l: 'Configurações', onPress: onOpenSettings },
              { i: 'timer', l: 'Timers e sons' },
            ]}
          />
          {/* linked login methods */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <Slash style={{ marginBottom: 10 }}>MÉTODOS DE LOGIN</Slash>
            <View
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.06)',
              }}
            >
              {PROVIDER_META.map((p, i) => {
                const linked = linkedProviders.includes(p.id);
                return (
                  <View
                    key={p.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderTopWidth: i ? 1 : 0,
                      borderTopColor: 'rgba(255,255,255,0.05)',
                      opacity: linked ? 1 : 0.45,
                    }}
                  >
                    <Icon name={p.icon} size={16} color="#fff" />
                    <Text
                      style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: '#fff' }}
                    >
                      {p.label}
                    </Text>
                    {linked ? (
                      <Icon name="check" size={16} color={colors.accentHi} />
                    ) : (
                      <Text
                        style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.faint, letterSpacing: 1 }}
                      >
                        NÃO VINCULADO
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <ProfileGroup
            title="SESSÃO"
            items={[{ i: 'arrow-left', l: 'Sair da conta', danger: true, onPress: confirmLogout }]}
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
  items: { i: IconName; l: string; d?: string; danger?: boolean; onPress?: () => void }[];
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
        {items.map((it, i) => {
          const accent = it.danger ? '#ff7676' : colors.accentHi;
          return (
            <Pressable
              key={i}
              onPress={it.onPress}
              disabled={!it.onPress}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: 'rgba(255,255,255,0.05)',
                backgroundColor: pressed && it.onPress ? 'rgba(255,255,255,0.04)' : 'transparent',
              })}
            >
              <Icon name={it.i} size={16} color={accent} />
              <Text
                style={{
                  flex: 1,
                  fontFamily: fonts.uiSemi,
                  fontSize: 14,
                  color: it.danger ? '#ff9a9a' : '#fff',
                }}
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
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

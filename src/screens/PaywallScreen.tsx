import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash } from '../components/ui/Display';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon, IconName } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

export function PaywallScreen({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<'year' | 'month'>('year');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <Pressable
          onPress={onDone}
          style={{
            position: 'absolute',
            top: 60,
            right: 20,
            zIndex: 5,
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.09)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="x" size={17} color="rgba(255,255,255,0.6)" />
        </Pressable>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 36 }}
          showsVerticalScrollIndicator={false}
        >
          <Slash style={{ marginBottom: 14 }}>MEMBRO AJ</Slash>
          <Display size={40}>DESBLOQUEIE</Display>
          <Display size={40} color={colors.accentHi}>
            O MÉTODO.
          </Display>

          <View style={{ marginVertical: 24 }}>
            {[
              { i: 'sparkles', l: 'Plano adaptativo AJ', d: 'evolui toda semana com seus dados' },
              { i: 'chart', l: 'Métricas de elite', d: 'carga · volume · recordes · projeções' },
              { i: 'flame', l: 'Protocolo nutricional', d: 'calorias e macros do seu objetivo' },
              { i: 'trophy', l: 'Desafios e ranking', d: 'comunidade fechada de membros' },
            ].map((b, i) => (
              <View
                key={b.l}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 13,
                  borderBottomWidth: i < 3 ? 1 : 0,
                  borderBottomColor: 'rgba(255,255,255,0.06)',
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    backgroundColor: 'rgba(11,112,249,0.14)',
                    borderWidth: 1,
                    borderColor: 'rgba(11,112,249,0.3)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={b.i as IconName} size={17} color={colors.accentHi} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: '#fff' }}>
                    {b.l}
                  </Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.mute }}>
                    {b.d}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ gap: 10 }}>
            <PlanOpt
              id="year"
              sel={plan}
              onSel={setPlan}
              tag="-60%"
              title="ANUAL"
              sub="7 dias grátis · depois R$ 24,90/mês"
              price="R$ 299"
            />
            <PlanOpt
              id="month"
              sel={plan}
              onSel={setPlan}
              title="MENSAL"
              sub="Sem teste grátis"
              price="R$ 59"
            />
          </View>

          <CtaButton onPress={onDone} style={{ marginTop: 20 }}>
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

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 12,
            }}
          >
            <Icon name="shield" size={11} color={colors.faint} />
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 2,
                color: colors.faint,
              }}
            >
              CANCELE A QUALQUER MOMENTO
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function PlanOpt({
  id,
  sel,
  onSel,
  tag,
  title,
  sub,
  price,
}: {
  id: 'year' | 'month';
  sel: 'year' | 'month';
  onSel: (v: 'year' | 'month') => void;
  tag?: string;
  title: string;
  sub: string;
  price: string;
}) {
  const s = sel === id;
  return (
    <Pressable
      onPress={() => onSel(id)}
      style={{
        padding: 16,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: s ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.035)',
        borderWidth: s ? 1.5 : 1,
        borderColor: s ? colors.accent : 'rgba(255,255,255,0.07)',
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 17,
              color: '#fff',
              textTransform: 'uppercase',
            }}
          >
            {title}
          </Text>
          {tag && (
            <View
              style={{
                backgroundColor: colors.accent,
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderRadius: 5,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.monoBold,
                  fontSize: 9,
                  letterSpacing: 1,
                  color: '#fff',
                }}
              >
                {tag}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.mute, marginTop: 3 }}>
          {sub}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: fonts.display,
          fontSize: 20,
          color: '#fff',
          textTransform: 'uppercase',
        }}
      >
        {price}
      </Text>
    </Pressable>
  );
}

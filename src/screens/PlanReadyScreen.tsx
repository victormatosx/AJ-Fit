import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Slash, MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { RiseIn } from '../components/ui/RiseIn';
import { colors, fonts, displayLineHeight, spacing } from '../theme/tokens';
import { useAppState } from '../state/AppState';
import { deriveTrainingDaySlots } from '../lib/planDerivation';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Every value on this screen must trace back to a real answer — see
 * docs/onboarding_funnel_architecture.md §Plan Ready. This intentionally
 * does NOT show a specific weekly split (push/pull/legs), a body-composition
 * projection, or a program length in weeks/workout count: none of those are
 * computed by a real engine today, and presenting them would be fabricated
 * personalization. `deriveTrainingDaySlots` is the one derived value here —
 * a pure function of the real `days` answer.
 */
export function PlanReadyScreen({
  name,
  onContinue,
}: {
  name?: string | null;
  onContinue: () => void;
}) {
  const { t } = useTranslation(['plan', 'quiz']);
  const { quiz } = useAppState();
  const goalKey = quiz.goal ?? 'hyper';
  const levelKey = quiz.level ?? 'int';
  const days = quiz.days || 4;
  const durationMinutes = quiz.duration ?? '60';

  const goalLabel = t(`quiz:goal.options.${goalKey}.label` as 'quiz:goal.options.hyper.label');
  const levelLabel = t(`quiz:level.options.${levelKey}.label` as 'quiz:level.options.beg.label');
  const trainingSlots = deriveTrainingDaySlots(days);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 26,
            paddingTop: 40,
            paddingBottom: 30,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. HEADER ── */}
          <RiseIn delay={0}>
            <Slash style={{ marginBottom: 14 }}>{t('plan:header.eyebrow').toUpperCase()}</Slash>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 34,
                lineHeight: displayLineHeight(34),
                letterSpacing: 0.5,
                color: '#fff',
                textTransform: 'uppercase',
                transform: [{ skewX: '-8deg' }],
              }}
            >
              {name ? t('plan:header.titleWithName', { name }) : t('plan:header.titleNoName')}
            </Text>
            <Text
              style={{
                marginTop: 12,
                fontFamily: fonts.ui,
                fontSize: 14.5,
                lineHeight: 21,
                color: colors.mute,
              }}
            >
              {goalLabel} · {levelLabel} · {t('plan:summary.frequencyValue', { days })}
            </Text>
          </RiseIn>

          {/* ── 2. STRATEGY SUMMARY (all real answers) ── */}
          <RiseIn delay={80} style={{ marginTop: 30 }}>
            <Slash style={{ marginBottom: 14 }}>{t('plan:summary.title').toUpperCase()}</Slash>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <SummaryCard label={t('plan:summary.goal')} value={goalLabel} />
              <SummaryCard label={t('plan:summary.frequency')} value={t('plan:summary.frequencyValue', { days })} />
              <SummaryCard
                label={t('plan:summary.duration')}
                value={t('plan:summary.durationValue', { minutes: durationMinutes })}
              />
              <SummaryCard label={t('plan:summary.level')} value={levelLabel} />
            </View>
          </RiseIn>

          {/* ── 3. WEEKLY TRAINING DAYS (derived from `days`, no invented split) ── */}
          <RiseIn delay={160} style={{ marginTop: 30 }}>
            <Slash style={{ marginBottom: 14 }}>{t('plan:schedule.title').toUpperCase()}</Slash>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {trainingSlots.map((on, i) => (
                <View
                  key={DAY_ORDER[i]}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    paddingHorizontal: 2,
                    alignItems: 'center',
                    borderRadius: 10,
                    backgroundColor: on ? 'rgba(11,112,249,0.14)' : 'transparent',
                    borderWidth: 1,
                    borderColor: on ? 'rgba(11,112,249,0.4)' : 'rgba(255,255,255,0.07)',
                  }}
                >
                  <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, letterSpacing: 1, color: colors.faint }}>
                    {t(`plan:schedule.dayLabels.${DAY_ORDER[i]}` as 'plan:schedule.dayLabels.mon')}
                  </Text>
                  <View
                    style={{
                      marginTop: 6,
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: on ? colors.accentHi : 'rgba(255,255,255,0.2)',
                    }}
                  />
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
              <LegendDot on label={t('plan:schedule.trainLabel')} />
              <LegendDot on={false} label={t('plan:schedule.restLabel')} />
            </View>
          </RiseIn>

          <View style={{ flex: 1, minHeight: 20 }} />

          {/* ── 4. JOURNEY MESSAGE — no fabricated numeric projection ── */}
          <RiseIn delay={220} style={{ marginTop: 30 }}>
            <View
              style={{
                padding: 18,
                borderRadius: 16,
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.uiBold,
                  fontSize: 16,
                  color: '#fff',
                }}
              >
                {t('plan:journey.title')}
              </Text>
              <Text
                style={{
                  marginTop: 6,
                  fontFamily: fonts.ui,
                  fontSize: 13.5,
                  lineHeight: 20,
                  color: colors.mute,
                }}
              >
                {t('plan:journey.body')}
              </Text>
            </View>
          </RiseIn>

          {/* ── 5. STRONG CTA ── */}
          <RiseIn delay={280} style={{ marginTop: 24 }}>
            <Pressable
              onPress={onContinue}
              accessibilityRole="button"
              accessibilityLabel={t('plan:cta.label')}
              style={{
                position: 'relative',
                width: '100%',
                overflow: 'hidden',
                paddingVertical: 20,
                paddingHorizontal: 22,
                borderRadius: 16,
                backgroundColor: colors.accent,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                shadowColor: colors.accent,
                shadowOpacity: 0.55,
                shadowRadius: 44,
                shadowOffset: { width: 0, height: 14 },
                elevation: 16,
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 1,
                  backgroundColor: 'rgba(255,255,255,0.4)',
                }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 24,
                    letterSpacing: 1,
                    color: '#fff',
                    textTransform: 'uppercase',
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {t('plan:cta.label')}
                </Text>
              </View>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.35)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="arrow-right" size={20} color="#fff" stroke={2.2} />
              </View>
            </Pressable>
            <MonoLabel style={{ textAlign: 'center', marginTop: 14 }}>
              {t('plan:cta.footer').toUpperCase()}
            </MonoLabel>
          </RiseIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        padding: 14,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.07)',
      }}
    >
      <MonoLabel>{label.toUpperCase()}</MonoLabel>
      <Text
        style={{
          marginTop: 6,
          fontFamily: fonts.uiBold,
          fontSize: 15,
          color: '#fff',
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function LegendDot({ on, label }: { on: boolean; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: on ? colors.accentHi : 'rgba(255,255,255,0.2)',
        }}
      />
      <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.faint }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

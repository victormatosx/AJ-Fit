import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { PendingEvolutionType } from '../workoutLifecycle/types';

// Fixed-dark "poster" surface, independent of the app's theme setting —
// see EvoRing.tsx's trackColor comment for the rationale.
const CTA_BACKGROUND = '#0b70f9';

export function NewPlanRevealScreen({
  type,
  cycleNumber,
  levelLabel,
  currentPlan,
  newPlan,
  locale,
  exerciseReplacements,
  onClose,
  onBegin,
}: {
  type: PendingEvolutionType;
  cycleNumber: number;
  levelLabel: string;
  currentPlan: FinalWorkoutPlan;
  newPlan: FinalWorkoutPlan;
  locale: string;
  exerciseReplacements: readonly { sessionIndex: number; slotIndex: number }[];
  onClose: () => void;
  onBegin: () => void;
}) {
  const { t } = useTranslation('evolution');
  const tLoose = t as unknown as LooseTranslate;
  const isPromo = type === 'LEVEL_PROMOTION';
  const isRenewal = type === 'MOTIVATIONAL_RENEWAL';
  const [openSession, setOpenSession] = useState(0);

  const title = isPromo
    ? t('reveal.levelTitle', { level: levelLabel.toUpperCase() })
    : isRenewal
      ? t('reveal.renewalTitle')
      : t('reveal.cycleTitle', { number: cycleNumber });
  const subtitle = isPromo ? t('reveal.levelSubtitle') : isRenewal ? t('reveal.renewalSubtitle') : t('reveal.cycleSubtitle');
  const newSlotsBySession = new Map<number, Set<number>>();
  exerciseReplacements.forEach((r) => {
    if (!newSlotsBySession.has(r.sessionIndex)) newSlotsBySession.set(r.sessionIndex, new Set());
    newSlotsBySession.get(r.sessionIndex)!.add(r.slotIndex);
  });
  const totalExercises = newPlan.sessions.reduce((sum, session) => sum + session.exercises.length, 0);
  const newCount = isPromo ? totalExercises : exerciseReplacements.length;
  const cta = isPromo
    ? t('reveal.ctaLevel', { level: levelLabel })
    : isRenewal
      ? t('reveal.ctaRenewal')
      : t('reveal.ctaCycle', { number: cycleNumber });

  return (
    <View style={{ flex: 1, backgroundColor: '#020010' }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 62, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 2.5, color: 'rgba(255,255,255,0.32)' }}>
            {'// '}{t('reveal.kicker')}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('accessibility.close')}
            style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="x" size={15} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 46, color: '#fff', marginTop: 14 }}>{title}</Text>
        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 10 }}>{subtitle}</Text>

        <View style={{ flexDirection: 'row', marginTop: 26, paddingVertical: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
          {[
            [String(newCount), t('reveal.newCount')],
            [String(totalExercises), t('reveal.exerciseCount')],
            [`${newPlan.sessions.length}X`, t('reveal.perWeek')],
          ].map(([value, label], index) => (
            <View key={label} style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 28, color: index === 0 && newCount > 0 ? '#4da3ff' : '#fff' }}>{value}</Text>
              <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)', marginTop: 4 }}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 10 }}>
          {newPlan.sessions.map((session, sessionIndex) => {
            const isOpen = openSession === sessionIndex;
            const newSlots = newSlotsBySession.get(sessionIndex) ?? new Set<number>();
            // workoutExercisesFromPlan can throw on a catalog lookup miss —
            // same degrade-gracefully contract as EvolutionUnlockScreen.tsx's
            // WhatChanged: a bad exercise id must never crash this whole
            // reveal screen, only quietly empty that session's list.
            let exercises: ReturnType<typeof workoutExercisesFromPlan> = [];
            let oldExercises: ReturnType<typeof workoutExercisesFromPlan> = [];
            try {
              exercises = workoutExercisesFromPlan(newPlan, locale, sessionIndex);
              oldExercises = workoutExercisesFromPlan(currentPlan, locale, sessionIndex);
            } catch {
              // fall through with empty arrays
            }
            const sessionLabel = resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName);
            return (
              <View key={sessionIndex} style={{ borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
                <Pressable
                  onPress={() => setOpenSession(isOpen ? -1 : sessionIndex)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${sessionLabel}, ${exercises.length} ${t('reveal.exercisesLabel')}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 }}
                >
                  <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 22, width: 18, color: isOpen ? '#fff' : 'rgba(255,255,255,0.45)' }}>
                    {String.fromCharCode(65 + sessionIndex)}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15.5, fontFamily: 'Archivo_700Bold', color: '#fff' }}>{sessionLabel}</Text>
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                      {exercises.length} {t('reveal.exercisesLabel')}
                      {newSlots.size > 0 ? ` · ${newSlots.size} ${t('reveal.newLabel').toLowerCase()}` : ''}
                    </Text>
                  </View>
                  <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
                    <Icon name="chevron-down" size={16} color="rgba(255,255,255,0.45)" />
                  </View>
                </Pressable>
                {isOpen && (
                  <View style={{ paddingLeft: 32, paddingBottom: 14 }}>
                    {exercises.map((exercise, slotIndex) => {
                      const isNew = newSlots.has(slotIndex);
                      const oldName = oldExercises[slotIndex]?.name;
                      return (
                        <View key={slotIndex} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
                          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.35)', width: 18 }}>
                            {String(slotIndex + 1).padStart(2, '0')}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontFamily: 'Archivo_600SemiBold', color: isNew || isPromo ? '#fff' : 'rgba(255,255,255,0.75)' }}>
                              {exercise.name}
                            </Text>
                            {isNew && oldName && (
                              <Text style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                                {t('reveal.before', { name: oldName })}
                              </Text>
                            )}
                          </View>
                          {(isNew || isPromo) && (
                            <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 9, letterSpacing: 1.2, color: '#4da3ff', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(11,112,249,0.14)', borderWidth: 1, borderColor: 'rgba(77,163,255,0.4)' }}>
                              {t('reveal.newLabel')}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ padding: 24 }}>
        <Pressable
          onPress={onBegin}
          accessibilityRole="button"
          accessibilityLabel={cta}
          style={{ height: 58, borderRadius: 12, backgroundColor: CTA_BACKGROUND, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 17, letterSpacing: 1.5, color: '#fff' }}>{cta.toUpperCase()}</Text>
        </Pressable>
      </View>
    </View>
  );
}

import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../components/ui/Display';
import { WeekdayGlowCircle } from '../components/treino/WeekdayGlowCircle';
import { useTheme } from '../theme';
import { WEEKDAY_ORDER } from '../state/AppState';
import {
  AVAILABLE_FREQUENCIES,
  isWeeklyScheduleComplete,
  selectFixedSchedule,
  selectFlexibleFrequency,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../onboarding/weeklyScheduleSelection';
import type { ScheduleMode, Weekday } from '../state/AppState';
import { agendaChangeRequiresAdaptation } from './treinoAgendaPolicy';

export type AgendaSaveOutcome = 'OK' | 'ERROR';

/**
 * Editar agenda (docs §Alteração de agenda). Reuses the onboarding's own
 * pure selection helpers (`weeklyScheduleSelection.ts`) verbatim — the user
 * only ever answers "which days do you want to train", never sees
 * `template`/`programInstance`/`ScheduleState` concepts. The weekday/
 * frequency grid below is a Treino-specific restyle (`WeekdayGlowCircle`),
 * deliberately NOT the shared `WeeklySchedulePicker` component — reusing
 * that one here would also restyle onboarding's own schedule question.
 * Whether the save is a same-frequency agenda edit (`saveScheduleConfig`,
 * never touches the program) or a real frequency change
 * (`adaptWorkoutProgram`, regenerates the division) is decided here,
 * transparently, by comparing the selected day count against the program's
 * current prescribed frequency — never by the user picking a mode.
 */
export function TreinoAgendaSheet({
  initialScheduleMode,
  initialTrainingDays,
  currentFrequency,
  onClose,
  onSave,
  onChangeFrequency,
}: {
  initialScheduleMode: ScheduleMode;
  initialTrainingDays: Weekday[];
  currentFrequency: number;
  onClose: () => void;
  onSave: (value: { scheduleMode: ScheduleMode; trainingDays: Weekday[] }) => Promise<AgendaSaveOutcome>;
  onChangeFrequency: (value: { scheduleMode: ScheduleMode; trainingDays: Weekday[]; days: number }) => Promise<AgendaSaveOutcome>;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('treino');
  const { t: tQuiz } = useTranslation('quiz');
  const [value, setValue] = useState<WeeklyScheduleValue>({
    days: initialScheduleMode === 'fixed' ? (initialTrainingDays.length || null) : currentFrequency,
    scheduleMode: initialScheduleMode,
    trainingDays: initialScheduleMode === 'fixed' ? initialTrainingDays : null,
  });
  const [step, setStep] = useState<'edit' | 'confirmFrequency'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const flexible = value.scheduleMode === 'flexible';
  const selectedDays = value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [];
  const newCount = flexible ? value.days ?? currentFrequency : selectedDays.length;
  const complete = isWeeklyScheduleComplete(value);
  const frequencyChanged = agendaChangeRequiresAdaptation(value, currentFrequency);
  const canSave = complete && !submitting;

  const handleSavePress = () => {
    setError(false);
    if (!canSave) return;
    if (frequencyChanged) {
      setStep('confirmFrequency');
      return;
    }
    void commitAgendaOnly();
  };

  const commitAgendaOnly = async () => {
    setSubmitting(true);
    setError(false);
    try {
      const outcome = await onSave({
        scheduleMode: value.scheduleMode ?? 'fixed',
        trainingDays: value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [],
      });
      if (outcome === 'OK') onClose();
      else setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const commitFrequencyChange = async () => {
    setSubmitting(true);
    setError(false);
    try {
      const outcome = await onChangeFrequency({
        scheduleMode: value.scheduleMode ?? 'fixed',
        trainingDays: value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [],
        days: newCount,
      });
      if (outcome === 'OK') onClose();
      else setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Live preview of what Salvar/Continuar will do — purely a restatement of
  // already-real state (`complete`/`frequencyChanged`/`newCount`), never a
  // second validation rule.
  const liveNote = !complete
    ? { text: tQuiz('days.minimumSelectionHint'), warn: true }
    : frequencyChanged
      ? { text: t('agenda.liveFrequencyChange', { from: currentFrequency, to: newCount }), warn: false }
      : { text: t('agenda.liveSameFrequency', { count: newCount }), warn: false };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={submitting ? undefined : onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('agenda.accessibilityClose')}
        onPress={submitting ? undefined : onClose}
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.colors.workoutSheetBackground,
            borderTopLeftRadius: 26, borderTopRightRadius: 26,
            borderWidth: 1, borderBottomWidth: 0, borderColor: theme.colors.sheetBorder,
            paddingHorizontal: 24, paddingTop: 22, paddingBottom: 34,
            maxHeight: '85%',
          }}
        >
          {step === 'edit' ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Slash>{t('agenda.sheetTitle')}</Slash>
              <Display size={24} skew={false} style={{ marginTop: 12, marginBottom: 6 }}>
                {t('agenda.title')}
              </Display>
              <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.ui, fontSize: 13.5, marginBottom: 22 }}>
                {t('agenda.sheetQuestion')}
              </Text>

              {flexible ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {AVAILABLE_FREQUENCIES.map((frequency) => (
                    <WeekdayGlowCircle
                      key={frequency}
                      label={String(frequency)}
                      selected={value.days === frequency}
                      size={38}
                      onPress={() => setValue(selectFlexibleFrequency(frequency))}
                    />
                  ))}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {WEEKDAY_ORDER.map((day) => (
                    <WeekdayGlowCircle
                      key={day}
                      label={t(`agenda.weekday.${day}`)}
                      selected={selectedDays.includes(day)}
                      size={38}
                      onPress={() => setValue(toggleFixedTrainingDay(value, day))}
                    />
                  ))}
                </View>
              )}

              <View style={{ alignItems: 'center', marginTop: 18 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: flexible }}
                  onPress={() => setValue(flexible ? selectFixedSchedule() : selectFlexibleSchedule(value))}
                  style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                >
                  <Text style={{
                    color: theme.colors.textSecondary,
                    fontFamily: theme.fonts.ui,
                    fontSize: 13,
                    textDecorationLine: 'underline',
                    textDecorationColor: theme.colors.textFaint,
                  }}>
                    {flexible ? tQuiz('days.fixedModeLink') : tQuiz('days.flexible.label')}
                  </Text>
                </Pressable>
              </View>

              <Text style={{
                color: liveNote.warn ? theme.colors.warning : theme.colors.textSecondary,
                fontFamily: theme.fonts.ui, fontSize: 13, textAlign: 'center', marginTop: 18, lineHeight: 18,
              }}>
                {liveNote.text}
              </Text>

              {error && (
                <Text style={{ color: theme.colors.danger, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 10, textAlign: 'center' }}>
                  {t('agenda.error')}
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                onPress={handleSavePress}
                disabled={!canSave}
                style={{
                  marginTop: 22, height: 54, borderRadius: 12, borderBottomRightRadius: 2,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: theme.colors.inverseSurface, opacity: canSave ? 1 : 0.35,
                }}
              >
                <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.display, fontSize: 15, letterSpacing: 1.3, textTransform: 'uppercase' }}>
                  {submitting ? t('agenda.saving') : frequencyChanged ? t('changeWorkout.confirm') : t('agenda.save')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                disabled={submitting}
                style={{ marginTop: 12, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                  {t('changeWorkout.cancel')}
                </Text>
              </Pressable>
            </ScrollView>
          ) : (
            <View>
              <Slash>{t('agenda.frequencyChangeTitle')}</Slash>
              <Display size={22} skew={false} style={{ marginTop: 12, marginBottom: 10 }}>
                {t('agenda.frequencyChangeTitle')}
              </Display>
              <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20 }}>
                {t('agenda.frequencyChangeBody', { from: currentFrequency, to: newCount })}
              </Text>
              {error && (
                <Text style={{ color: theme.colors.danger, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 10 }}>
                  {t('agenda.error')}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setError(false); setStep('edit'); }}
                  disabled={submitting}
                  style={{ flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.inputBorder }}
                >
                  <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                    {t('agenda.frequencyChangeCancel')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={commitFrequencyChange}
                  disabled={submitting}
                  style={{
                    flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: theme.colors.inverseSurface, opacity: submitting ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                    {submitting ? t('agenda.updating') : t('agenda.frequencyChangeConfirm')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Slash } from '../components/ui/Display';
import { useTheme } from '../theme';
import { ScheduleModeLink, WeeklySchedulePicker } from '../components/onboarding/WeeklySchedulePicker';
import {
  isWeeklyScheduleComplete,
  type WeeklyScheduleValue,
} from '../onboarding/weeklyScheduleSelection';
import type { ScheduleMode, Weekday } from '../state/AppState';
import { agendaChangeRequiresAdaptation } from './treinoAgendaPolicy';

export type AgendaSaveOutcome = 'OK' | 'ERROR';

/**
 * Editar agenda (docs §Alteração de agenda). Reuses the onboarding's own
 * `WeeklySchedulePicker`/`weeklyScheduleSelection` helpers verbatim — the
 * user only ever answers "which days do you want to train", never sees
 * `template`/`programInstance`/`ScheduleState` concepts. Whether the save
 * is a same-frequency agenda edit (`saveScheduleConfig`, never touches the
 * program) or a real frequency change (`adaptWorkoutProgram`, regenerates
 * the division) is decided here, transparently, by comparing the selected
 * day count against the program's current prescribed frequency — never by
 * the user picking a mode.
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
  const [value, setValue] = useState<WeeklyScheduleValue>({
    days: initialScheduleMode === 'fixed' ? (initialTrainingDays.length || null) : currentFrequency,
    scheduleMode: initialScheduleMode,
    trainingDays: initialScheduleMode === 'fixed' ? initialTrainingDays : null,
  });
  const [step, setStep] = useState<'edit' | 'confirmFrequency'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const newCount = value.scheduleMode === 'flexible' ? value.days ?? currentFrequency : value.trainingDays?.length ?? 0;
  const frequencyChanged = agendaChangeRequiresAdaptation(value, currentFrequency);
  const canSave = isWeeklyScheduleComplete(value) && !submitting;

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
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingHorizontal: 22, paddingTop: 20, paddingBottom: 34,
            maxHeight: '85%',
          }}
        >
          {step === 'edit' ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Slash>{t('agenda.sheetTitle').toUpperCase()}</Slash>
              <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 16, marginTop: 10, marginBottom: 16 }}>
                {t('agenda.sheetQuestion')}
              </Text>
              <View style={{ alignItems: 'center', marginBottom: 10 }}>
                <ScheduleModeLink value={value} onChange={setValue} />
              </View>
              <WeeklySchedulePicker value={value} onChange={setValue} />
              {error && (
                <Text style={{ color: theme.colors.danger, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 10 }}>
                  {t('agenda.error')}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onClose}
                  disabled={submitting}
                  style={{ flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.inputBorder }}
                >
                  <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                    {t('changeWorkout.cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSavePress}
                  disabled={!canSave}
                  style={{
                    flex: 1, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: theme.colors.inverseSurface, opacity: canSave ? 1 : 0.5,
                  }}
                >
                  <Text style={{ color: theme.colors.inverseForeground, fontFamily: theme.fonts.uiSemi, fontSize: 14 }}>
                    {submitting ? t('agenda.saving') : t('agenda.save')}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View>
              <Slash>{t('agenda.frequencyChangeTitle').toUpperCase()}</Slash>
              <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20, marginTop: 12 }}>
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

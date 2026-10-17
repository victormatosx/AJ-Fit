import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui/Icon';
import { NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { NU, NuCap } from '../../components/nutrition/NuKit';
import { generationFailureCopyKey, generationStageKey, isGenerationRetryable, type GenerationStageKey } from '../../nutrition/ui/generationStage';
import type { NutritionGenerationJobDoc } from '../../services/nutritionGeneration';

/**
 * Mirrors the "montando treino" experience in spirit (`screens.md` §3):
 * a listener-driven status screen that survives navigation/background and
 * never fabricates a progress percentage the backend doesn't report.
 *
 * The 4-step list below (§3.10 "Gerando") is exactly `GenerationStageKey`'s
 * own real ordered sequence (`queued -> running -> validating ->
 * completing`, src/nutrition/ui/generationStage.ts) — no invented progress
 * steps, no percentage the backend doesn't report.
 */
const STAGE_ORDER: readonly GenerationStageKey[] = ['queued', 'running', 'validating', 'completing'];

export function NutritionGeneratingScreen({
  job, onRetry, onBack, retrying, observationFailed = false,
}: {
  job: NutritionGenerationJobDoc | null;
  onRetry: () => void;
  onBack: () => void;
  retrying: boolean;
  observationFailed?: boolean;
}) {
  const { t } = useTranslation('nutrition');

  if (observationFailed || job?.status === 'failed') {
    const copyKey = observationFailed ? 'genericError' : generationFailureCopyKey(job?.errorCode);
    const retryable = observationFailed || isGenerationRetryable(job?.errorCode);
    return (
      <View style={{ flex: 1, backgroundColor: NU.bg }}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center' }} edges={['top', 'bottom']}>
          <NutritionErrorState
            title={t(`generating.${copyKey}.title`)}
            body={t(`generating.${copyKey}.body`)}
            retryLabel={retryable ? t('generating.failed.retry') : undefined}
            onRetry={retryable ? onRetry : undefined}
            backLabel={t('generating.failed.back')}
            onBack={onBack}
          />
        </SafeAreaView>
      </View>
    );
  }

  const stageKey = job ? generationStageKey(job.status) : null;
  const currentIndex = stageKey ? STAGE_ORDER.indexOf(stageKey) : -1;

  return (
    <View style={{ flex: 1, backgroundColor: NU.bg }}>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 22 }} edges={['top', 'bottom']}>
        <View style={{ paddingTop: 34 }}>
          <NuCap>{t('onboarding.preparingTitle')}</NuCap>
          <Text style={{ fontFamily: 'Archivo_400Regular', color: NU.faint, marginTop: 12 }}>{t('onboarding.preparingBody')}</Text>
          {stageKey ? <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 22, color: NU.white, marginTop: 14, lineHeight: 28 }}>
            {t(`generating.stages.${stageKey}`)}
          </Text> : null}

          {job ? <View style={{ marginTop: 28 }}>
            {STAGE_ORDER.map((stage, index) => {
              const done = index < currentIndex || (retrying && index <= currentIndex);
              const current = index === currentIndex && !retrying;
              return (
                <View
                  key={stage}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15,
                    borderTopWidth: index ? 1 : 0, borderTopColor: NU.hairline,
                    opacity: done || current ? 1 : 0.35,
                  }}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    backgroundColor: done ? NU.blue : 'transparent',
                    borderWidth: done ? 0 : 1, borderColor: current ? NU.blueHi : 'rgba(255,255,255,0.25)',
                  }}>
                    {done ? <Icon name="check" size={12} color="#fff" /> : current ? (
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: NU.blueHi }} />
                    ) : null}
                  </View>
                  <Text style={{ fontFamily: current ? 'Archivo_600SemiBold' : 'Archivo_500Medium', fontSize: 14.5, color: NU.white }}>
                    {t(`generating.stages.${stage}`)}
                  </Text>
                </View>
              );
            })}
          </View> : null}

          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, lineHeight: 20, color: NU.faint, marginTop: 24 }}>
            {t('onboarding.preparingNote')}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

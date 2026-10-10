import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { useTheme } from '../../theme';
import { generationFailureCopyKey, generationStageKey, isGenerationRetryable } from '../../nutrition/ui/generationStage';
import type { NutritionGenerationJobDoc } from '../../services/nutritionGeneration';

/**
 * Mirrors the "montando treino" experience in spirit (`screens.md` §3):
 * a listener-driven status screen that survives navigation/background and
 * never fabricates a progress percentage the backend doesn't report.
 */
export function NutritionGeneratingScreen({
  job, onRetry, onBack, retrying,
}: {
  job: NutritionGenerationJobDoc | null;
  onRetry: () => void;
  onBack: () => void;
  retrying: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');

  if (job?.status === 'failed') {
    const copyKey = generationFailureCopyKey(job.errorCode);
    const retryable = isGenerationRetryable(job.errorCode);
    return (
      <ScreenBg>
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
      </ScreenBg>
    );
  }

  const stageKey = generationStageKey(job?.status ?? 'queued');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }} edges={['top', 'bottom']}>
        <View style={{
          width: 72, height: 72, borderRadius: theme.radii.pill, alignItems: 'center', justifyContent: 'center',
          backgroundColor: theme.colors.primarySurfaceSubtle, marginBottom: 24,
        }}>
          {retrying ? <ActivityIndicator color={theme.colors.primaryEmphasis} /> : <Icon name="sparkles" size={30} color={theme.colors.primaryEmphasis} />}
        </View>
        <Display size={22} style={{ textAlign: 'center' }}>{t('generating.title')}</Display>
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginTop: 10 }}>
          {t(`generating.stages.${stageKey}`)}
        </Text>
        <ActivityIndicator color={theme.colors.primaryEmphasis} style={{ marginTop: 28 }} />
      </SafeAreaView>
    </ScreenBg>
  );
}

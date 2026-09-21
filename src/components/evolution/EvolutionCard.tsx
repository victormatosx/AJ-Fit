import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Display, Slash, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import type { EvolutionViewModel } from '../../workoutEvolution/types';

/**
 * Compact evolution card — the real Training Level/Cycle presentation that
 * replaces Profile's old hardcoded XP/level bar (docs product §57/§AP-AR).
 * Presentation-only: consumes an already-built `EvolutionViewModel`, never
 * recomputes eligibility (docs §4/§B).
 */
export function EvolutionCard({
  viewModel,
  onPress,
}: {
  viewModel: EvolutionViewModel;
  onPress?: () => void;
}) {
  const { t } = useTranslation('evolution');
  const { theme } = useTheme();

  if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE' || viewModel.kind === 'SUMMARY_READY') {
    // Never fabricate a level/cycle while loading or on error (docs §76/§77).
    // SUMMARY_READY (Fase 5.2, Home-only progressive rendering) is treated
    // the same as LOADING here on purpose — Profile is out of this phase's
    // scope and keeps its exact pre-existing behavior.
    return (
      <Card style={{ padding: 16 }}>
        <MonoLabel>{t(viewModel.kind === 'ERROR'
          ? 'state.error'
          : viewModel.kind === 'UNAVAILABLE'
            ? 'state.unavailable'
            : 'state.loading')}</MonoLabel>
      </Card>
    );
  }

  const { summary } = viewModel;
  const isReady = viewModel.kind === 'EVOLUTION_READY';
  const isDeferred = viewModel.kind === 'EVOLUTION_DEFERRED';
  const isAutoActivated = viewModel.kind === 'AUTO_ACTIVATION_NOTICE';

  const headline = isAutoActivated
    ? t(`auto.card.${viewModel.activatedType}`)
    : isReady
      ? t(viewModel.pending.type === 'MOTIVATIONAL_RENEWAL'
        ? 'motivationalRenewal.cardReady'
        : viewModel.pending.type === 'LEVEL_PROMOTION'
          ? 'unlock.levelReadyCard'
          : 'unlock.cycleReadyCard')
    : isDeferred
      ? t(viewModel.pending.deferralCount >= 2 ? 'unlock.secondDeferConsequence' : 'unlock.deferredStatus')
      : t(summary.proximity ? `proximity.${summary.proximity}` : 'state.evaluationPaused');

  const canOpen = Boolean(onPress) && (isReady || isDeferred || isAutoActivated);

  return (
    <Pressable
      onPress={canOpen ? onPress : undefined}
      disabled={!canOpen}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={canOpen ? headline : undefined}
      accessibilityHint={canOpen ? t('accessibility.openDetails') : undefined}
    >
      <Card style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <View>
            <MonoLabel>{t('activePrescription').toUpperCase()}</MonoLabel>
            <Slash>{t(`level.${summary.activeLevel}`).toUpperCase()}</Slash>
          </View>
          <MonoLabel color={theme.colors.primaryEmphasis}>
            {t('cycle', { number: summary.cycleNumber }).toUpperCase()}
          </MonoLabel>
        </View>

        {summary.earnedLevel !== summary.activeLevel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Icon name="sparkles" size={14} color={theme.colors.primaryEmphasis} />
            <MonoLabel color={theme.colors.primaryEmphasis}>
              {t('careerLevel', { level: t(`level.${summary.earnedLevel}`) }).toUpperCase()}
            </MonoLabel>
          </View>
        ) : null}

        <Display size={16} style={{ marginTop: 10 }} skew={false}>
          {headline}
        </Display>

        {summary.activeDays !== null || summary.sessionsCompleted !== null ? (
          <MonoLabel style={{ marginTop: 8 }}>
            {summary.activeDays !== null ? t('stats.activeDays', { count: summary.activeDays }) : ''}
            {summary.activeDays !== null && summary.sessionsCompleted !== null ? '  ·  ' : ''}
            {summary.sessionsCompleted !== null ? t('stats.sessionsCompleted', { count: summary.sessionsCompleted }) : ''}
          </MonoLabel>
        ) : null}
        {summary.adherenceQuality ? (
          <MonoLabel color={summary.adherenceQuality === 'HIGH' ? theme.colors.primaryEmphasis : undefined} style={{ marginTop: 6 }}>
            {t(`adherence.${summary.adherenceQuality}`)}
          </MonoLabel>
        ) : null}
      </Card>
    </Pressable>
  );
}

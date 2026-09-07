import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import { filledProgramProgressSegments, PROGRAM_PROGRESS_SEGMENT_COUNT } from '../../home/programProgress';

/**
 * Compact "Evolução do programa" strip for Home, placed below the Treino de
 * Hoje card (docs task — new element, distinct from the existing
 * `EvolutionTicker` marquee above the card, which stays untouched). Presents
 * the SAME `EvolutionViewModel` Home already holds — no new fetch, no new
 * listener. Renders nothing while LOADING/UNAVAILABLE/ERROR: the ticker
 * above already communicates those states, so this never duplicates a
 * skeleton.
 */
export function ProgramProgressStrip({
  viewModel,
  onPress,
}: {
  viewModel: EvolutionViewModel;
  onPress?: () => void;
}) {
  const { t } = useTranslation(['home', 'evolution']);
  const { theme } = useTheme();

  if (viewModel.kind === 'LOADING' || viewModel.kind === 'UNAVAILABLE' || viewModel.kind === 'ERROR') return null;

  const { summary } = viewModel;
  const isActionable = viewModel.kind === 'EVOLUTION_READY'
    || viewModel.kind === 'EVOLUTION_DEFERRED'
    || viewModel.kind === 'AUTO_ACTIVATION_NOTICE';
  const segments = filledProgramProgressSegments(viewModel.kind, summary.proximity);
  const canOpen = Boolean(onPress) && isActionable;

  const statusLabel = viewModel.kind === 'AUTO_ACTIVATION_NOTICE'
    ? t(`evolution:auto.card.${viewModel.activatedType}`)
    : viewModel.kind === 'EVOLUTION_READY'
      ? t(viewModel.pending.type === 'MOTIVATIONAL_RENEWAL'
          ? 'evolution:motivationalRenewal.cardReady'
          : viewModel.pending.type === 'LEVEL_PROMOTION'
            ? 'evolution:unlock.levelReadyCard'
            : 'evolution:unlock.cycleReadyCard')
      : viewModel.kind === 'EVOLUTION_DEFERRED'
        ? t('evolution:unlock.deferredStatus')
        : t(summary.proximity ? `evolution:proximity.${summary.proximity}` : 'evolution:state.evaluationPaused');

  return (
    <Pressable
      onPress={canOpen ? onPress : undefined}
      disabled={!canOpen}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={canOpen ? `${t('home:activity.programProgress.title')}. ${statusLabel}` : undefined}
      style={{ paddingHorizontal: 22, paddingVertical: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <MonoLabel>{t('home:activity.programProgress.title').toUpperCase()}</MonoLabel>
        <MonoLabel color={theme.colors.textSecondary}>
          {`${t(`evolution:level.${summary.activeLevel}`)} · ${t('evolution:cycle', { number: summary.cycleNumber })}`.toUpperCase()}
        </MonoLabel>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <View style={{ flexDirection: 'row', gap: 4, flex: 1 }}>
          {Array.from({ length: PROGRAM_PROGRESS_SEGMENT_COUNT }, (_, index) => (
            <View
              key={index}
              style={{
                flex: 1,
                height: 3,
                borderRadius: theme.radii.pill,
                backgroundColor: index < segments ? theme.colors.primaryEmphasis : theme.colors.progressTrack,
              }}
            />
          ))}
        </View>
        {canOpen && <Icon name="chevron-right" size={12} color={theme.colors.primaryEmphasis} />}
      </View>

      <Text
        numberOfLines={1}
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 10.5,
          letterSpacing: 1,
          color: isActionable ? theme.colors.primaryEmphasis : theme.colors.textFaint,
          marginTop: 8,
        }}
      >
        {statusLabel.toUpperCase()}
      </Text>
    </Pressable>
  );
}

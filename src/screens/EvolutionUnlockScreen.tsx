import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Card, HudCorners } from '../components/ui/Card';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { useTheme } from '../theme';
import { sizes, spacing } from '../theme/tokens';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import type { PrescriptionDiffSummary } from '../workoutEvolution/diff';

/**
 * Fase 5 — the dedicated unlock/decision experience for an earned evolution
 * (Level Promotion, Cycle Evolution) and the neutral Motivational Renewal
 * variant. Presentation-only: every fact shown comes from the already-built
 * `EvolutionViewModel`; `onStart`/`onDefer` call the Fase 4 canonical
 * services (docs product §26-34/§41-54, §X/§Y).
 */
export function EvolutionUnlockScreen({
  viewModel,
  diff,
  actionPending,
  actionError,
  onStart,
  onDefer,
  onClose,
}: {
  viewModel: Extract<EvolutionViewModel, { kind: 'EVOLUTION_READY' | 'EVOLUTION_DEFERRED' | 'AUTO_ACTIVATION_NOTICE' }>;
  diff: PrescriptionDiffSummary | null;
  actionPending: boolean;
  actionError: string | null;
  onStart: () => void;
  onDefer: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('evolution');
  const { theme } = useTheme();

  if (viewModel.kind === 'AUTO_ACTIVATION_NOTICE') {
    const isRenewal = viewModel.activatedType === 'MOTIVATIONAL_RENEWAL';
    return (
      <ScreenBg>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: sizes.screenGutter, paddingVertical: spacing[8], justifyContent: 'center' }}>
            <Card style={{ padding: 24 }}>
              <HudCorners />
              <MonoLabel color={isRenewal ? theme.colors.textMuted : theme.colors.primaryEmphasis}>
                {t(`auto.eyebrow.${viewModel.activatedType}`)}
              </MonoLabel>
              <Display size={24} style={{ marginTop: 10 }}>{t(`auto.title.${viewModel.activatedType}`)}</Display>
              <Text style={{ fontFamily: theme.fonts.ui, color: theme.colors.textMuted, marginTop: 12, fontSize: 14 }}>
                {t(`auto.body.${viewModel.activatedType}`)}
              </Text>
              <MonoLabel style={{ marginTop: 14 }}>
                {t('auto.activeNow', {
                  level: t(`level.${viewModel.summary.activeLevel}`),
                  cycle: viewModel.summary.cycleNumber,
                })}
              </MonoLabel>
              <WhatChanged diff={diff} framing="auto" />
              <CtaButton
                onPress={onClose}
                accessibilityLabel={t('auto.ackCta')}
                style={{ marginTop: 24 }}
              >
                <CtaText>{t('auto.ackCta')}</CtaText>
              </CtaButton>
            </Card>
          </ScrollView>
        </SafeAreaView>
      </ScreenBg>
    );
  }

  const { pending, summary } = viewModel;
  const isReady = viewModel.kind === 'EVOLUTION_READY';
  const isLevelPromotion = pending.type === 'LEVEL_PROMOTION';
  const isMotivationalRenewal = pending.type === 'MOTIVATIONAL_RENEWAL';
  const isHigh = pending.quality === 'HIGH';

  const eyebrow = isMotivationalRenewal
    ? t('motivationalRenewal.eyebrow')
    : isLevelPromotion
      ? t('unlock.levelPromotionEyebrow')
      : t('unlock.cycleEvolutionEyebrow');

  const title = isMotivationalRenewal
    ? t('motivationalRenewal.title')
    : isLevelPromotion
      ? t(`level.${pending.toLevel}`)
      : t('unlock.cycleTitle', { number: summary.cycleNumber + 1 });

  const reason = isMotivationalRenewal
    ? t('motivationalRenewal.body')
    : isHigh
      ? t('unlock.reasonHigh')
      : t('unlock.reasonStandard');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']} accessibilityViewIsModal>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('accessibility.close')}
          hitSlop={10}
          style={{ position: 'absolute', right: sizes.screenGutter, top: spacing[6], zIndex: 2, padding: 8 }}
        >
          <Icon name="x" size={18} color={theme.colors.textPrimary} />
        </Pressable>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: sizes.screenGutter, paddingTop: spacing[6], paddingBottom: spacing[4] }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <Card style={{ padding: 24, ...(isHigh ? { borderColor: theme.colors.primaryEmphasis } : {}) }}>
            <HudCorners color={isHigh ? theme.colors.primaryEmphasis : undefined} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name={isMotivationalRenewal ? 'sparkles' : 'trophy'} size={18} color={theme.colors.primaryEmphasis} />
              <MonoLabel color={theme.colors.primaryEmphasis}>{eyebrow}</MonoLabel>
            </View>
            <Display size={30}>{title}</Display>
            {!isMotivationalRenewal ? (
              <Text style={{ fontFamily: theme.fonts.ui, color: theme.colors.textMuted, marginTop: 12, fontSize: 14, lineHeight: 20 }}>
                {reason}
              </Text>
            ) : (
              <Text style={{ fontFamily: theme.fonts.ui, color: theme.colors.textMuted, marginTop: 12, fontSize: 14, lineHeight: 20 }}>
                {reason}
              </Text>
            )}
            {pending.sessionsCompletedAtEarn > 0 ? (
              <MonoLabel style={{ marginTop: 14 }}>
                {t('stats.sessionsCompleted', { count: pending.sessionsCompletedAtEarn })}
              </MonoLabel>
            ) : null}
          </Card>

          {/* What changed */}
          <WhatChanged
            diff={diff}
            framing={isMotivationalRenewal ? 'renewal' : isLevelPromotion ? 'level' : 'cycle'}
          />

          {viewModel.kind === 'EVOLUTION_DEFERRED' ? (
            <Card style={{ padding: 16, marginTop: 16 }}>
              <DiffRow icon="check" text={t('unlock.deferredCurrentActive')} />
              <View style={{ height: 8 }} />
              <DiffRow icon="sparkles" text={t('unlock.deferredAvailable')} />
            </Card>
          ) : null}

          {actionError ? (
            <Text style={{ color: theme.colors.danger ?? '#ef4444', marginTop: 16, fontFamily: theme.fonts.ui, fontSize: 13 }}>
              {t('unlock.errorRetry')}
            </Text>
          ) : null}

          <View style={{ flexGrow: 1, minHeight: spacing[6] }} />

          {/* CTAs */}
          <CtaButton
            onPress={onStart}
            disabled={actionPending}
            accessibilityLabel={t(isMotivationalRenewal ? 'motivationalRenewal.cta' : 'unlock.startCta')}
            accessibilityState={{ busy: actionPending }}
            style={{ marginTop: 12 }}
          >
            {actionPending ? <ActivityIndicator color={theme.colors.primaryForeground} /> : <CtaText>{t(isMotivationalRenewal ? 'motivationalRenewal.cta' : 'unlock.startCta')}</CtaText>}
          </CtaButton>
          {isReady ? (
            <CtaButton
              ghost
              onPress={onDefer}
              disabled={actionPending}
              accessibilityLabel={t(isMotivationalRenewal ? 'motivationalRenewal.keepCta' : 'unlock.keepCta')}
              accessibilityState={{ busy: actionPending }}
              style={{ marginTop: 10 }}
            >
              <Text style={{ fontFamily: theme.fonts.ui, color: theme.colors.textPrimary, fontSize: 14 }}>
                {t(isMotivationalRenewal ? 'motivationalRenewal.keepCta' : 'unlock.keepCta')}
              </Text>
            </CtaButton>
          ) : null}
          {isReady ? (
            <MonoLabel style={{ marginTop: 10, textAlign: 'center' }}>
              {t(pending.deferralCount >= 1 ? 'unlock.secondDeferConsequence' : 'unlock.keepConsequence')}
            </MonoLabel>
          ) : (
            <MonoLabel style={{ marginTop: 10, textAlign: 'center' }}>
              {t('unlock.deferredStatus')}
            </MonoLabel>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function WhatChanged({
  diff,
  framing,
}: {
  diff: PrescriptionDiffSummary | null;
  framing: 'level' | 'cycle' | 'renewal' | 'auto';
}) {
  const { t } = useTranslation('evolution');
  if (!diff) return null;
  const rows: { icon: 'swap' | 'check' | 'calendar' | 'list' | 'sparkles'; text: string }[] = [];
  if (diff.exerciseReplacements.length > 0) rows.push({ icon: 'swap', text: t('diff.replacements', { count: diff.exerciseReplacements.length }) });
  if (diff.addedExerciseCount > 0) rows.push({ icon: 'list', text: t('diff.added', { count: diff.addedExerciseCount }) });
  if (diff.removedExerciseCount > 0) rows.push({ icon: 'list', text: t('diff.removed', { count: diff.removedExerciseCount }) });
  if (diff.reorderedSessionCount > 0) rows.push({ icon: 'swap', text: t('diff.reordered', { count: diff.reorderedSessionCount }) });
  if (diff.setsChangedCount > 0) rows.push({ icon: 'list', text: t('diff.sets', { count: diff.setsChangedCount }) });
  if (diff.repsChangedCount > 0) rows.push({ icon: 'list', text: t('diff.reps', { count: diff.repsChangedCount }) });
  if (diff.restChangedCount > 0) rows.push({ icon: 'list', text: t('diff.rest', { count: diff.restChangedCount }) });
  if (diff.frequencyChange) rows.push({ icon: 'calendar', text: t('diff.frequencyChanged', diff.frequencyChange) });
  if (diff.sessionCountChange) rows.push({ icon: 'calendar', text: t('diff.sessionCountChanged', diff.sessionCountChange) });
  if (diff.splitChanged || diff.addedSessionCount > 0 || diff.removedSessionCount > 0) {
    rows.push({ icon: 'list', text: t('diff.structureChanged') });
  }
  if (!diff.hasObservableChanges) rows.push({ icon: 'check', text: t('diff.noObservableChange') });
  return (
    <Card style={{ padding: 20, marginTop: 16 }}>
      <Slash>{t(`diff.title.${framing}`).toUpperCase()}</Slash>
      <View style={{ marginTop: 12, gap: 8 }}>
        {rows.map((row, index) => <DiffRow key={`${row.text}:${index}`} {...row} />)}
      </View>
    </Card>
  );
}

function DiffRow({ icon, text }: { icon: 'swap' | 'check' | 'calendar' | 'list' | 'sparkles'; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={16} color={theme.colors.textMuted} />
      <Text style={{ fontFamily: theme.fonts.ui, color: theme.colors.textPrimary, fontSize: 13.5, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

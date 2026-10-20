import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { palette } from '../../theme/tokens';
import { EvoRing } from './EvoRing';
import { EvoRingCelebration } from './EvoRingCelebration';
import { useEvoRingCelebration } from './useEvoRingCelebration';
import { StreakFlame } from './StreakFlame';
import { CountUp } from './CountUp';
import { ADHERENCE_EARNED_THRESHOLD_PERCENT, INTERMEDIATE_CYCLES_FOR_ADVANCED } from '../../home/evoRingMetrics';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { Streak } from '../../home/streak';
import type { DailyActivityStreak } from '../../home/dailyActivityStreak';

const evCap = { fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)' } as const;
const NOOP = () => {};
// This whole redesign is a fixed-dark "poster" surface, independent of the
// app's light/dark theme setting (same reasoning as `EvoRing.tsx`'s own
// `trackColor` comment) — colors below are deliberately `palette.*`/literal
// hex, never `theme.colors.*`.

/** Same formula the component used to compute inline, lifted out so it can
 * run unconditionally (before the LOADING/ERROR/UNAVAILABLE early return)
 * for `useEvoRingCelebration`'s trigger effect, which — like every hook —
 * must never be called conditionally. */
function cyclePctFromViewModel(viewModel: EvolutionViewModel): number {
  if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE') return 0;
  if (viewModel.kind === 'EVOLUTION_READY' || viewModel.kind === 'EVOLUTION_DEFERRED') return 100;
  const { summary } = viewModel;
  return summary.requiredActiveDays > 0
    ? Math.min(100, Math.round(((summary.activeDays ?? 0) / summary.requiredActiveDays) * 100))
    : 0;
}

export function CycleProgressBlock({
  viewModel,
  streak,
  dailyStreak,
  celebrationRequest = null,
  onCelebrationFinished,
}: {
  viewModel: EvolutionViewModel;
  streak: Streak | null;
  /** Daily activity streak (workout OR food entry) — drives the flame and the "Sequência" number. */
  dailyStreak: DailyActivityStreak | null;
  /** Bumps (new `token`) to play the "evolution reached" ring celebration — set by `AppShell` only after a real `activatePendingEvolution` success, or by the `__DEV__`-only `EvolutionDebugPanel`. `null` outside those triggers. */
  celebrationRequest?: { token: number } | null;
  /** Fires once, when the celebration's full sequence ends — never during the normal (non-celebrating) ring. */
  onCelebrationFinished?: () => void;
}) {
  const { t } = useTranslation('home');
  const cyclePct = cyclePctFromViewModel(viewModel);
  const celebration = useEvoRingCelebration(onCelebrationFinished ?? NOOP);
  const startedCelebrationTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!celebrationRequest || startedCelebrationTokenRef.current === celebrationRequest.token) return;
    startedCelebrationTokenRef.current = celebrationRequest.token;
    celebration.start(cyclePct);
    // Narrow deps are intentional: this must fire exactly once per new
    // `token`, driven by whatever `cyclePct` was current at that moment —
    // not re-run just because `celebration`'s identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrationRequest, cyclePct]);

  if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE') return null;

  const { summary } = viewModel;
  const pendingKind = viewModel.kind === 'EVOLUTION_READY' || viewModel.kind === 'EVOLUTION_DEFERRED'
    ? viewModel.pending.type
    : null;
  const paused = summary.pausedAtLocalDate !== null;
  const activeDays = summary.activeDays ?? 0;
  const daysLeft = Math.max(0, summary.requiredActiveDays - activeDays);
  const statusText = celebration.celebrating
    ? t('evoRing.cycleComplete')
    : pendingKind
      ? t('evoRing.unlocked')
      : paused
        ? t('evoRing.paused')
        : t('evoRing.daysLeft', { count: daysLeft });
  const adherencePercent = summary.adherenceRatio !== null ? Math.round(summary.adherenceRatio * 100) : null;
  const belowAdherenceThreshold = adherencePercent !== null && adherencePercent < ADHERENCE_EARNED_THRESHOLD_PERCENT;
  const adherenceColor = belowAdherenceThreshold ? palette.amber500 : '#fff';
  const intermediate = summary.activeLevel === 'INTERMEDIATE';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 8 }}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        {celebration.celebrating ? (
          <EvoRingCelebration
            fromPercent={cyclePct}
            progress={celebration.progress}
            glow={celebration.glow}
            burst={celebration.burst}
            check={celebration.check}
            numberOpacity={celebration.numberOpacity}
          />
        ) : (
          <EvoRing
            size={150}
            strokeWidth={11}
            progress={cyclePct}
            color={paused ? palette.amber500 : palette.blue500}
            accessibilityLabel={`${cyclePct}% ${t('evoRing.ofCycle').toLowerCase()}`}
          >
            <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 40, color: '#fff', lineHeight: 48 }}>
              <CountUp to={cyclePct} style={{ fontFamily: 'Anton_400Regular', fontSize: 40, color: '#fff' }} />
              <Text style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)' }}>%</Text>
            </Text>
            <Text style={[evCap, { marginTop: 6 }]}>{t('evoRing.ofCycle')}</Text>
          </EvoRing>
        )}
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: '#fff', textAlign: 'center' }}>
          {statusText}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        {/* The "Sequência" indicator is the DAILY ACTIVITY streak — consecutive
            days with a workout or a food entry (`src/home/dailyActivityStreak.ts`).
            It is always a count of days, so the unit label no longer branches.
            `streak` (obligations/weeks) is still received for the other
            schedule-driven metrics and is deliberately NOT used here. */}
        {/* The unit sits beside a number that is rendered separately, so it
            has to agree with that number on its own: a streak of one is
            "1 dia", never "1 dias". */}
        <Row last={!intermediate} accessibilityLabel={`${t('evoRing.streakLabel')} ${dailyStreak?.current ?? 0} ${t('evoRing.streakUnit', { count: dailyStreak?.current ?? 0 })}`}>
          <Text style={evCap}>{t('evoRing.streakLabel')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <StreakFlame days={dailyStreak?.current ?? 0} size={42} />
            <CountUp to={dailyStreak?.current ?? 0} style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: '#fff' }} />
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t('evoRing.streakUnit', { count: dailyStreak?.current ?? 0 })}</Text>
          </View>
        </Row>
        <Row last={!intermediate} accessibilityLabel={adherencePercent !== null ? `${t('evoRing.adherenceLabel')} ${adherencePercent}%${belowAdherenceThreshold ? t('evoRing.adherenceBelowThreshold') : ''}` : t('evoRing.adherenceLabel')}>
          <Text style={evCap}>{t('evoRing.adherenceLabel')}</Text>
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: adherenceColor, marginTop: 8 }}>
            {adherencePercent !== null ? <CountUp to={adherencePercent} style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: adherenceColor }} /> : '—'}
            {adherencePercent !== null ? '%' : ''}
          </Text>
          {adherencePercent !== null && (
            <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 10, position: 'relative' }}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${adherencePercent}%`, borderRadius: 2, backgroundColor: belowAdherenceThreshold ? palette.amber500 : palette.blue500 }} />
              <View style={{ position: 'absolute', left: `${ADHERENCE_EARNED_THRESHOLD_PERCENT}%`, top: -3, width: 2, height: 10, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.6)' }} />
            </View>
          )}
        </Row>
        {intermediate && (
          <Row last accessibilityLabel={`${t('evoRing.towardAdvanced')} ${summary.intermediateCyclesEarned ?? 0} ${t('evoRing.towardAdvancedUnit', { count: INTERMEDIATE_CYCLES_FOR_ADVANCED })}`}>
            <Text style={evCap}>{t('evoRing.towardAdvanced')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: '#fff' }}>
                {summary.intermediateCyclesEarned ?? 0}
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                {t('evoRing.towardAdvancedUnit', { count: INTERMEDIATE_CYCLES_FOR_ADVANCED })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 10 }}>
              {Array.from({ length: INTERMEDIATE_CYCLES_FOR_ADVANCED }, (_, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: i < (summary.intermediateCyclesEarned ?? 0) ? palette.blue500 : 'rgba(255,255,255,0.08)',
                  }}
                />
              ))}
            </View>
          </Row>
        )}
      </View>
    </View>
  );
}

function Row({
  children,
  last = false,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  last?: boolean;
  /** Static, settled-value label for screen readers — the row's `CountUp` children animate rapidly and must never be the thing announced. */
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={{ paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}
    >
      {children}
    </View>
  );
}

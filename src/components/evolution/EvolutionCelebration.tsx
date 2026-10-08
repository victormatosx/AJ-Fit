import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { CountUp } from '../home/CountUp';
import { Icon } from '../ui/Icon';
import type { PendingEvolutionType } from '../../workoutLifecycle/types';

type Phase = 0 | 1 | 2 | 3;

/**
 * Fires strictly after `activatePendingEvolution` has already returned
 * success (the caller, `AppShell.tsx`, only mounts this component once that
 * resolved) — this component never calls any activation logic itself, it is
 * pure presentation of an event that already happened. `onDone` hands off to
 * the new-workout reveal screen (Task 19).
 */
export function EvolutionCelebration({
  type,
  cycleNumber,
  levelLabel,
  swapCount,
  onDone,
}: {
  type: PendingEvolutionType;
  cycleNumber: number;
  levelLabel: string;
  swapCount: number;
  onDone: () => void;
}) {
  const { t } = useTranslation('evolution');
  const [phase, setPhase] = useState<Phase>(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const doneFiredRef = useRef(false);
  const toExplosionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toTitleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toDoneRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared, idempotent terminal path: every way this component can finish
  // (tap-to-skip, the 5200ms timeout, or reduce-motion convergence) must
  // funnel through here so `onDone` fires exactly once and no stray timer
  // can revive the UI after the user already dismissed it.
  const finish = () => {
    if (toExplosionRef.current) clearTimeout(toExplosionRef.current);
    if (toTitleRef.current) clearTimeout(toTitleRef.current);
    if (toDoneRef.current) clearTimeout(toDoneRef.current);
    toExplosionRef.current = null;
    toTitleRef.current = null;
    toDoneRef.current = null;
    if (!doneFiredRef.current) {
      doneFiredRef.current = true;
      onDone();
    }
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setPhase(3);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    toExplosionRef.current = setTimeout(() => {
      setPhase(1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }, 1700);
    toTitleRef.current = setTimeout(() => setPhase(2), 2500);
    toDoneRef.current = setTimeout(() => finish(), 5200);
    return () => {
      if (toExplosionRef.current) clearTimeout(toExplosionRef.current);
      if (toTitleRef.current) clearTimeout(toTitleRef.current);
      if (toDoneRef.current) clearTimeout(toDoneRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, onDone]);

  // Reduced-motion shortcut: skip straight to the outcome (Task 19 mounts
  // immediately after `onDone`), per the design's own "respect reduce
  // motion" rule. This effect must stay unconditional (not nested inside
  // the early return below) so hook order never changes between renders.
  useEffect(() => {
    if (reduceMotion) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  if (phase === 3 || reduceMotion) {
    return null;
  }

  const isRenewal = type === 'MOTIVATIONAL_RENEWAL';
  const isPromo = type === 'LEVEL_PROMOTION';
  const doneLabel = isPromo ? t('celebration.levelDone') : isRenewal ? t('celebration.renewalDone') : t('celebration.cycleDone', { number: cycleNumber });
  const bigTop = isPromo ? t('celebration.levelBigTop') : isRenewal ? t('celebration.renewalBigTop') : t('celebration.cycleBigTop');
  const bigBottom = isPromo ? levelLabel : isRenewal ? t('celebration.renewalBigBottom') : String(cycleNumber).padStart(2, '0');
  const sub = isPromo ? t('celebration.levelSub') : isRenewal ? t('celebration.renewalSub') : t('celebration.cycleSub', { count: swapCount });

  return (
    <Pressable
      onPress={() => { setPhase(3); finish(); }}
      style={{ flex: 1, backgroundColor: '#020010', alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 210, height: 210, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={210} height={210} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Defs>
            <SvgLinearGradient id="celebrationRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#9fd6ff" />
              <Stop offset="1" stopColor="#0b70f9" />
            </SvgLinearGradient>
          </Defs>
          <Circle cx={105} cy={105} r={100} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
          <Circle cx={105} cy={105} r={100} fill="none" stroke="url(#celebrationRing)" strokeWidth={10} strokeLinecap="round" />
        </Svg>
        {phase === 0 ? (
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 54, color: '#fff' }}>
            <CountUp to={100} durationMs={1600} style={{ fontFamily: 'Anton_400Regular', fontSize: 54, color: '#fff' }} />
            <Text style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)' }}>%</Text>
          </Text>
        ) : (
          <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: '#0b70f9', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={46} color="#fff" stroke={3} />
          </View>
        )}
      </View>

      <View style={{ alignItems: 'center', marginTop: 44, minHeight: 150 }}>
        {phase >= 1 && (
          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 11, letterSpacing: 3, color: '#4da3ff' }}>
            {doneLabel}
          </Text>
        )}
        {phase >= 2 && (
          <>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 22, color: 'rgba(255,255,255,0.55)' }}>{bigTop}</Text>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: bigBottom.length > 6 ? 40 : 64, color: '#fff' }}>{bigBottom}</Text>
            </View>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 16, textAlign: 'center' }}>{sub}</Text>
          </>
        )}
      </View>

      {phase >= 2 && (
        <Text style={{ position: 'absolute', bottom: 40, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          {t('celebration.tapHint')}
        </Text>
      )}
    </Pressable>
  );
}

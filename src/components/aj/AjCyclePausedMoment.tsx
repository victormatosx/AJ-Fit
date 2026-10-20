import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AjMoment } from './AjMoment';
import { AJ_CYCLE_PAUSED_DELAY_MS } from './ajMomentTiming';

/**
 * The paused-cycle moment: Active Time stopped because prescribed
 * opportunities were missed in a row, and AJ asks whether the user wants to
 * train today to pick the cycle back up.
 *
 * This is the only one of AJ's three moments that had no modal before, so
 * everything about WHEN it may appear is deliberately narrow and lives
 * entirely in the caller's hands:
 *
 * - `eligible` is the caller's already-computed pause fact
 *   (`summary.pausedAtLocalDate !== null`, the same one `CycleProgressBlock`
 *   renders as "pausado"). Nothing here recomputes misses, reads the
 *   progression snapshot, or counts anything — and because the summary does
 *   not carry the miss count, the copy stays generic rather than claiming a
 *   number it cannot prove.
 * - `allowed` is the caller's "this is a safe surface right now" gate: Home
 *   focused and settled, no workout in progress, no other overlay open.
 * - Once per app session, tracked in a ref. Nothing is persisted, so a real
 *   restart (or a different account, which unmounts the whole shell) starts
 *   fresh — exactly like every other in-memory presentation guard.
 *
 * The answers do not introduce a start path of their own: "yes" calls the
 * very same `onStartWorkout` the Home card's CTA already uses (AppShell's
 * `requestStartWorkout`), so the missed-session decision, the recovery
 * precedence check and the Premium gate all still happen in exactly the
 * order they do for a normal tap. "Agora não" only closes.
 *
 * The prototype also offered a second path ("Preciso de uma pausa" -> "Uma
 * semana / Ainda não sei", i.e. freezing the cycle). The app has no such
 * capability — nothing can freeze or extend Active Time on request — so it
 * is deliberately not implemented and not hinted at in the copy.
 */
export function AjCyclePausedMoment({
  eligible,
  allowed,
  onStartWorkout,
}: {
  /** The cycle really is paused (caller reads `summary.pausedAtLocalDate`). */
  eligible: boolean;
  /** Home is focused/settled and no other surface owns the screen. */
  allowed: boolean;
  /** The one real "iniciar treino" entry point, passed straight through. */
  onStartWorkout: () => void;
}) {
  const { t } = useTranslation('home');
  const [visible, setVisible] = useState(false);
  // In-memory only, by design: "once per app session" must never become
  // persisted state (docs: no new persisted flag for a presentation rule).
  const shownRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!eligible || !allowed || shownRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return () => undefined;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      shownRef.current = true;
      setVisible(true);
    }, AJ_CYCLE_PAUSED_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [eligible, allowed]);

  // Leaving Home (or any overlay opening) while the moment is up closes it
  // without consuming anything else — it has already been "shown".
  useEffect(() => {
    if (!allowed && visible) setVisible(false);
  }, [allowed, visible]);

  return (
    <AjMoment
      visible={visible}
      lines={[t('schedule.cyclePaused.aj.context'), t('schedule.cyclePaused.aj.question')]}
      options={[
        {
          key: 'start',
          label: t('schedule.cyclePaused.aj.start'),
          onPress: () => {
            setVisible(false);
            onStartWorkout();
          },
          primary: true,
          // `requestStartWorkout` opens StartWorkoutConfirmation (or the
          // missed-session decision), both native Modals — this overlay has
          // to be unmounted before either presents.
          closesMoment: true,
        },
        {
          key: 'later',
          label: t('schedule.cyclePaused.aj.later'),
          onPress: () => setVisible(false),
          closesMoment: true,
        },
      ]}
      dismissible
      onDismiss={() => setVisible(false)}
      closeAccessibilityLabel={t('schedule.cyclePaused.aj.later')}
    />
  );
}

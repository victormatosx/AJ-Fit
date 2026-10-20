import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { AqPrimaryButton, AqRise, AqSheet } from '../ui/AcquisitionControls';
import { AjBot, type AjBotPhase } from '../aj/AjBot';
import { AjSpeechText } from '../aj/AjSpeechText';
import {
  AJ_GATE,
  AJ_REDUCED_TRANSITION_MS,
  AJ_TYPING_MS_PER_CHAR,
} from '../aj/ajMomentTiming';
import { AJ_BOT_NOD } from '../aj/ajBotMotion';
import { useReducedMotionPreference } from '../../lib/reducedMotion';

export type OnboardingSafetyBlockStatus = 'REQUIRES_CLEARANCE' | 'BLOCKED';

/**
 * The safety notice, as the approved design's bottom sheet.
 *
 * This is a restyle and nothing more. When the notice opens, what it says and
 * how it closes are all decided elsewhere — `onboardingSafetyGate.ts` produces
 * the verdict and `QuestionStepScreen` holds it in state. Dismissing still
 * does NOT let the step through; only changing an answer does.
 *
 * AJ is rendered inline *inside* this Modal rather than being borrowed from
 * the funnel's stage: the funnel's mascot sits in the screen below, which a
 * native Modal covers. A second native Modal (wrapping this in `AjMoment`) is
 * the one thing that must not happen here — two stacked native windows is the
 * failure mode documented on `closesMoment`.
 */
export function ProfessionalClearanceModal({
  status,
  onDismiss,
}: {
  status: OnboardingSafetyBlockStatus | null;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();
  const blocked = status === 'BLOCKED';
  const copyKey = blocked ? 'safety.blocked' : 'safety.clearanceRequired';
  const tone = blocked ? theme.colors.safetyCritical : theme.colors.safetyWarning;

  const [sheetHeight, setSheetHeight] = useState(0);
  const [phase, setPhase] = useState<AjBotPhase>('idle');
  const [talking, setTalking] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (status === null || reduceMotion) return () => undefined;
    // AJ acknowledges the notice once the sheet has fully arrived and the CTA
    // is on screen — a nod, not a hop: nothing here is being celebrated.
    timers.current.push(
      setTimeout(() => {
        setPhase('nod');
        timers.current.push(setTimeout(() => setPhase('idle'), AJ_BOT_NOD.durationMs));
      }, AJ_GATE.nodAtMs),
    );
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [status, reduceMotion]);

  return (
    <Modal
      visible={status !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('safety.dismissAccessibility')}
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'flex-end' }}
      >
        {/* AJ perches on the sheet's top edge. Positioned from the measured
            sheet height so he follows it on any copy length or text scale. */}
        {sheetHeight > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: (width - AJ_GATE.size) / 2,
              bottom: sheetHeight - AJ_GATE.perchOffsetY,
            }}
          >
            <AjBot
              size={AJ_GATE.size}
              mood={talking ? 'talk' : 'think'}
              phase={phase}
              talking={talking}
              reduceMotion={reduceMotion}
            />
          </View>
        ) : null}

        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{ width: '100%' }}
        >
          <AqSheet
            alternate
            reduceMotion={reduceMotion}
            onSheetLayout={setSheetHeight}
            style={{ paddingTop: 58, paddingHorizontal: 24, gap: 14 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: tone,
                  shadowColor: tone,
                  shadowOpacity: 1,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 0 },
                }}
              />
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.8, color: tone }}>
                {blocked ? t('safety.kickerBlocked') : t('safety.kickerClearance')}
              </Text>
            </View>

            <AjSpeechText
              text={t(`${copyKey}.title` as 'safety.blocked.title')}
              msPerChar={AJ_TYPING_MS_PER_CHAR.question}
              startDelayMs={reduceMotion ? 0 : AJ_GATE.titleTypesAtMs}
              reduceMotion={reduceMotion}
              onStart={() => setTalking(true)}
              onDone={() => setTalking(false)}
              style={{
                fontFamily: theme.fonts.uiSemi,
                fontSize: 23,
                lineHeight: 29,
                letterSpacing: -0.3,
                color: theme.colors.textPrimary,
              }}
            />

            <AqRise delay={reduceMotion ? 0 : AJ_GATE.bodyRiseAtMs} reduceMotion={reduceMotion}>
              <Text
                style={{
                  fontFamily: theme.fonts.ui,
                  fontSize: 15,
                  lineHeight: 22.5,
                  color: theme.colors.textBodySoft,
                }}
              >
                {t(`${copyKey}.body` as 'safety.blocked.body')}
              </Text>
            </AqRise>

            <AqRise
              delay={reduceMotion ? 0 : AJ_GATE.ctaRiseAtMs}
              duration={reduceMotion ? AJ_REDUCED_TRANSITION_MS : undefined}
              reduceMotion={reduceMotion}
              style={{ marginTop: 10 }}
            >
              {/* Closing never unblocks the step — it returns the user to the
                  answers, which is the only thing that can change the verdict. */}
              <AqPrimaryButton label={t('safety.reviewAction')} onPress={onDismiss} />
            </AqRise>
          </AqSheet>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

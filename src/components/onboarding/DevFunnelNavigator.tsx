import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ONBOARDING_STEPS, getStepIndex, type OnboardingStepId } from '../../onboarding/steps';
import { Icon } from '../ui/Icon';
import { fonts, colors } from '../../theme/tokens';

/**
 * Replaces the legacy `DevQuizNav` (which had no `__DEV__` guard at all —
 * see docs/onboarding_funnel_architecture.md §Dev Funnel Navigator for the
 * finding). Covers all 26 funnel steps. `auth`/`paywall` are shown but
 * disabled: jumping there would require either faking auth/subscription
 * state (forbidden) or genuinely finishing the funnel — so tapping them is
 * a no-op with an explanatory label instead of a fabricated shortcut.
 *
 * Guarded twice by design: once here (`if (!__DEV__) return null`) and once
 * at every mount site (`{__DEV__ && <DevFunnelNavigator .../>}`).
 */
export function DevFunnelNavigator({
  currentStepId,
  onJump,
}: {
  currentStepId: OnboardingStepId;
  onJump: (id: OnboardingStepId) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!__DEV__) return null;

  const currentIndex = getStepIndex(currentStepId);

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 54, right: 12, zIndex: 999 }}>
      {!open && (
        <Pressable
          onPress={() => setOpen(true)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            backgroundColor: 'rgba(255,168,64,0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255,168,64,0.55)',
          }}
        >
          <Text style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.5, color: '#ffa840' }}>
            DEV · {String(currentIndex + 1).padStart(2, '0')}/{ONBOARDING_STEPS.length}
          </Text>
        </Pressable>
      )}
      {open && (
        <View
          style={{
            width: 260,
            maxHeight: 480,
            padding: 8,
            borderRadius: 12,
            backgroundColor: 'rgba(6,2,32,0.97)',
            borderWidth: 1,
            borderColor: 'rgba(255,168,64,0.4)',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 6,
              paddingVertical: 4,
              marginBottom: 4,
            }}
          >
            <Text style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.5, color: '#ffa840' }}>
              DEV · JUMP TO
            </Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <Icon name="x" size={14} color="rgba(255,255,255,0.5)" />
            </Pressable>
          </View>
          {ONBOARDING_STEPS.map((step, i) => {
            const current = step.id === currentStepId;
            const disabled = !step.devJumpable;
            return (
              <Pressable
                key={step.id}
                disabled={disabled}
                onPress={() => {
                  onJump(step.id);
                  setOpen(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 6,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  opacity: disabled ? 0.35 : 1,
                  backgroundColor: current ? 'rgba(11,112,249,0.18)' : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: current ? colors.accentHi : 'rgba(255,255,255,0.35)',
                    minWidth: 20,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.ui,
                    fontSize: 11,
                    color: current ? '#fff' : 'rgba(255,255,255,0.75)',
                  }}
                  numberOfLines={1}
                >
                  {step.id}
                  {disabled ? ' · requer sessão real' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

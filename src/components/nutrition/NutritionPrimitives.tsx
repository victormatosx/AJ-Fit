import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { HudCorners } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { NU } from './NuKit';

/**
 * NOTE for the Nutrição redesign: `SelectableRow`/`SelectableChip` below are
 * NOT restyled here — they're also used by `NutritionProfileScreen.tsx` (the
 * nutrition-profile wizard), which is outside the requested redesign scope
 * ("Aplique somente o novo visual à tela Nutrição... e a todas as
 * telas/sheets abertas a partir dela" — the wizard isn't in that list).
 * `MealFeedbackSheet.tsx`'s own reason-picker/dislike-chips use new,
 * separate local components instead, so this pair stays exactly as it was.
 */

/**
 * Selectable row/chip primitives for Nutrition screens, visually matching
 * `src/components/onboarding/QuestionRenderer.tsx`'s `ChoiceList`/`MultiList`
 * (same `choice*` tokens, radii, shadow-on-select) without that module's
 * hardcoded `useTranslation('quiz')` + `${questionId}.options.*` key
 * lookup — Nutrition passes an already-resolved label, so this is reusable
 * for both quiz-style single-select questions AND catalog food rows.
 */
export function SelectableRow({
  label, description, selected, onPress, disabled, role = 'radio',
}: {
  label: string;
  description?: string | null;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  role?: 'radio' | 'checkbox';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={{ checked: selected, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      style={{
        padding: 16,
        borderRadius: theme.radii.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: selected ? theme.colors.choiceSelectedBackground : theme.colors.choiceBackground,
        borderWidth: 1,
        borderColor: selected ? theme.colors.choiceSelectedBorder : theme.colors.choiceBorder,
        opacity: disabled ? theme.opacity.disabled : 1,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {selected && <HudCorners />}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.choiceText }}>{label}</Text>
        {description ? (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted, marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected && <Icon name="check" size={20} color={theme.colors.primaryEmphasis} stroke={2.8} />}
    </Pressable>
  );
}

export function SelectableChip({
  label, selected, onPress, disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: theme.radii.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: selected ? theme.colors.choiceSelectedBackground : theme.colors.choiceBackground,
        borderWidth: 1,
        borderColor: selected ? theme.colors.choiceSelectedBorder : theme.colors.choiceBorder,
        opacity: disabled ? theme.opacity.disabled : 1,
      }}
    >
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.choiceText, textAlign: 'center' }}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={16} color={theme.colors.primaryEmphasis} stroke={2.8} /> : null}
    </Pressable>
  );
}

/**
 * A structural placeholder for data still loading — never a central spinner
 * (`states_and_loading.md` §3). Pulses per the redesign's loading-state spec
 * (section 3.10 "Carregando": blocks pulsing 1.4s) — purely a visual
 * animation addition, same component/props as before.
 */
export function SkeletonBlock({ height = 60, style }: { height?: number; style?: object }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[{ height, borderRadius: 6, backgroundColor: NU.surfaceSubtleStrong, opacity }, style]}
    />
  );
}

export function Pill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'accent' }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: tone === 'accent' ? 'rgba(11,112,249,0.16)' : NU.surfaceSubtleStrong,
      }}
    >
      <Text
        style={{
          fontFamily: 'JetBrainsMono_400Regular',
          fontSize: 9,
          letterSpacing: 1.2,
          color: tone === 'accent' ? NU.blueHi : NU.faint,
        }}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

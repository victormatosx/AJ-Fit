import React from 'react';
import { Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { CtaButton, CtaText } from '../ui/CtaButton';
import { CompletedTodayButton, useCompletedTodayEntrance } from '../workout/CompletedTodayButton';
import { AdvanceWorkoutButton } from '../workout/AdvanceWorkoutButton';
import { NextWorkoutRow } from '../workout/NextWorkoutRow';
import { BodyMuscleMap } from '../fitness/BodyMuscleMap';
import { useTheme } from '../../theme';
import { displayLineHeight } from '../../theme/tokens';
import type { Sex } from '../../state/AppState';
import type { MuscleId } from '../../types/exercise';

const METRIC_VALUE_SIZE = 20;

/**
 * Linear RGB interpolation between two `#rrggbb` endpoints. Purely visual —
 * drives the muscle-dot intensity ramp, whose endpoints come from the theme
 * so the ramp keeps its "primary muscle reads strongest" direction in both
 * Dark (bright blue -> deep blue) and Light (deep blue -> brighter blue).
 */
function lerpHexColor(from: string, to: string, t: number): string {
  const channels = (hex: string) => {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const [fromR, fromG, fromB] = channels(from);
  const [toR, toG, toB] = channels(to);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(fromR, toR)}, ${mix(fromG, toG)}, ${mix(fromB, toB)})`;
}

export interface TreinoTodayBlockMuscleItem {
  id: MuscleId;
  name: string;
}

export interface TreinoTodayBlockMetric {
  value: string;
  unit?: string;
  label: string;
}

export function TreinoTodayBlock({
  kicker,
  sessionLabel,
  title,
  muscles,
  sex,
  primaryMuscles,
  secondaryMuscles,
  showBodyMap,
  bodyMapSize,
  frontOffsetX,
  metrics,
  ctaVisible,
  ctaLabel,
  ctaDisabled,
  onPressCta,
  completedLabel,
  completedNote,
  advanceLabel,
  onPressAdvance,
  nextWorkoutLabel,
  nextWorkoutValue,
}: {
  kicker: string | null;
  sessionLabel: string | null;
  title: string;
  muscles: TreinoTodayBlockMuscleItem[];
  sex: Sex;
  primaryMuscles: readonly MuscleId[];
  secondaryMuscles: readonly MuscleId[];
  showBodyMap: boolean;
  bodyMapSize: number;
  frontOffsetX: number;
  metrics: TreinoTodayBlockMetric[];
  ctaVisible: boolean;
  ctaLabel: string;
  ctaDisabled: boolean;
  onPressCta: () => void;
  /**
   * Today's session is already done: the start CTA's slot shows a blocked,
   * non-interactive button instead. Only read when `ctaVisible` is false —
   * the two states are mutually exclusive by construction.
   */
  completedLabel: string | null;
  completedNote: string | null;
  /**
   * Rest day whose next session may be pulled forward: the same "adiantar
   * treino" affordance Home's Today card offers, in the same slot. Null
   * whenever `AppShell`'s `advancedWorkoutTarget` says advancing isn't on
   * offer — this block never decides that itself.
   */
  advanceLabel: string | null;
  onPressAdvance: (() => void) | null;
  /**
   * Last resort for the slot: a blocked day with nothing to act on still says
   * when the next workout is, exactly as Home's Today card does — otherwise
   * the slot would simply be empty.
   */
  nextWorkoutLabel: string | null;
  nextWorkoutValue: string | null;
}) {
  const { theme } = useTheme();
  const completedEntering = useCompletedTodayEntrance(!ctaVisible && completedLabel != null, ctaVisible);

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 16, paddingTop: 24, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        {kicker ? <MonoLabel>{kicker}</MonoLabel> : <View />}
        {sessionLabel && (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted }}>
            {sessionLabel}
          </Text>
        )}
      </View>

      <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={2}
            style={{ fontFamily: theme.fonts.uiBold, fontSize: 30, lineHeight: 33, color: theme.colors.textPrimary }}
          >
            {title}
          </Text>

          {muscles.length > 0 && (
            <View style={{ marginTop: 18, gap: 6 }}>
              {muscles.map((muscle, index) => (
                <View key={muscle.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: lerpHexColor(
                        theme.colors.primaryEmphasis,
                        theme.colors.primary,
                        muscles.length > 1 ? index / (muscles.length - 1) : 0,
                      ),
                    }}
                  />
                  <Text
                    style={{
                      fontFamily: theme.fonts.ui,
                      fontSize: 13,
                      color: index === 0 ? theme.colors.textPrimary : theme.colors.textMuted,
                    }}
                  >
                    {muscle.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {showBodyMap && (
          <View style={{ minHeight: 150, justifyContent: 'flex-end' }}>
            <BodyMuscleMap
              sex={sex}
              primaryMuscles={primaryMuscles}
              secondaryMuscles={secondaryMuscles}
              activeColor={theme.colors.primaryEmphasis}
              baseColor="transparent"
              outlineColor={theme.colors.iconStrong}
              size={bodyMapSize}
              gap={12}
              frontOffsetX={frontOffsetX}
            />
          </View>
        )}
      </View>

      {metrics.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            marginTop: 22,
            paddingVertical: 14,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: theme.colors.divider,
          }}
        >
          {metrics.map((metric, index) => (
            <View
              key={metric.label}
              style={{
                flex: 1,
                minWidth: 0,
                alignItems: 'center',
                paddingHorizontal: 4,
                borderLeftWidth: index > 0 ? 1 : 0,
                borderLeftColor: theme.colors.divider,
              }}
            >
              {/* Anton crops its own glyph tops on iOS at any lineHeight below
                  1.45x (see `displayLineHeight`'s note in theme/tokens.ts) —
                  never hardcode one next to `fonts.display`. */}
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: theme.fonts.display,
                  fontSize: METRIC_VALUE_SIZE,
                  lineHeight: displayLineHeight(METRIC_VALUE_SIZE),
                  color: theme.colors.textPrimary,
                }}
              >
                {metric.value}
                {metric.unit && <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}> {metric.unit}</Text>}
              </Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textMuted, marginTop: 5 }}
              >
                {metric.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {ctaVisible && (
        <CtaButton
          disabled={ctaDisabled}
          onPress={onPressCta}
          style={{ marginTop: 20 }}
          accessibilityLabel={ctaLabel}
        >
          <Icon name="play" size={15} color={theme.colors.primaryForeground} />
          <CtaText>{ctaLabel}</CtaText>
        </CtaButton>
      )}

      {!ctaVisible && completedLabel && (
        <CompletedTodayButton
          theme={theme}
          label={completedLabel}
          note={completedNote}
          animate={completedEntering}
          style={{ marginTop: 20 }}
        />
      )}

      {!ctaVisible && !completedLabel && advanceLabel && onPressAdvance && (
        <AdvanceWorkoutButton
          theme={theme}
          label={advanceLabel}
          onPress={onPressAdvance}
          style={{ marginTop: 20 }}
        />
      )}

      {/* Same order Home's card resolves the slot in: start CTA, then today's
          completion, then the advance offer, and only then this. */}
      {!ctaVisible && !completedLabel && !advanceLabel && nextWorkoutLabel && nextWorkoutValue && (
        <NextWorkoutRow
          theme={theme}
          label={nextWorkoutLabel}
          value={nextWorkoutValue}
          style={{ marginTop: 20 }}
        />
      )}
    </View>
  );
}

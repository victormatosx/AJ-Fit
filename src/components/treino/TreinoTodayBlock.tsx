import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
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
}) {
  const { theme } = useTheme();

  return (
    <View style={{ paddingHorizontal: 22, marginTop: 28, paddingTop: 24, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaDisabled }}
          disabled={ctaDisabled}
          onPress={onPressCta}
          style={{
            marginTop: 20,
            paddingVertical: 17,
            borderRadius: 12,
            backgroundColor: theme.colors.primary,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            opacity: ctaDisabled ? 0.6 : 1,
          }}
        >
          <Icon name="play" size={13} color={theme.colors.primaryForeground} />
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 16, color: theme.colors.primaryForeground }}>
            {ctaLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

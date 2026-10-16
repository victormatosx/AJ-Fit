import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { BodyMuscleMap } from '../fitness/BodyMuscleMap';
import { useTheme } from '../../theme';
import type { Sex } from '../../state/AppState';
import type { MuscleId } from '../../types/exercise';

const SESSION_LABEL_FAINT = 'rgba(255,255,255,0.45)'; // spec §3.2.C — no exact 0.45 white token
const METRIC_LABEL_FAINT = 'rgba(255,255,255,0.45)';
const METRIC_UNIT_FAINT = 'rgba(255,255,255,0.45)';
const MUSCLE_SECONDARY_TEXT = 'rgba(255,255,255,0.55)'; // == alpha.white55 / theme.colors.textMuted exactly — kept literal here for locality with the dot-color scale below
const MUSCLE_DOT_FROM = '#4da3ff';
const MUSCLE_DOT_TO = '#1f6fd6';

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Linear RGB interpolation between two `#rrggbb` literals — purely visual, the 3-stop "intensity scale" from spec §3.1. */
function muscleDotColor(index: number, total: number): string {
  const t = total > 1 ? index / (total - 1) : 0;
  const from = parseInt(MUSCLE_DOT_FROM.slice(1), 16);
  const to = parseInt(MUSCLE_DOT_TO.slice(1), 16);
  const r = clampByte(((from >> 16) & 255) + (((to >> 16) & 255) - ((from >> 16) & 255)) * t);
  const g = clampByte(((from >> 8) & 255) + (((to >> 8) & 255) - ((from >> 8) & 255)) * t);
  const b = clampByte((from & 255) + ((to & 255) - (from & 255)) * t);
  return `rgb(${r}, ${g}, ${b})`;
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
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: SESSION_LABEL_FAINT }}>
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
                      backgroundColor: muscleDotColor(index, muscles.length),
                    }}
                  />
                  <Text
                    style={{
                      fontFamily: theme.fonts.ui,
                      fontSize: 13,
                      color: index === 0 ? theme.colors.textPrimary : MUSCLE_SECONDARY_TEXT,
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
              outlineColor="rgba(255,255,255,0.85)"
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
                alignItems: 'center',
                borderLeftWidth: index > 0 ? 1 : 0,
                borderLeftColor: theme.colors.divider,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.display, fontSize: 20, lineHeight: 20, color: theme.colors.textPrimary }}>
                {metric.value}
                {metric.unit && <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: METRIC_UNIT_FAINT }}> {metric.unit}</Text>}
              </Text>
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: METRIC_LABEL_FAINT, marginTop: 5 }}>
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

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '../ui/Card';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { useTheme } from '../../theme';
import { radii, sizes, spacing } from '../../theme/tokens';
import { useUnits } from '../../state/UnitsContext';
import { workoutLoadUnit } from '../../units/workoutLoadConversions';
import { PULSE_METRIC_IDS, type PulseMetricId, type WorkoutPulse } from '../../workoutSummary/pulse';

function formatMetricValue(metric: PulseMetricId, value: number, unit: string): string {
  if (metric === 'volume' || metric === 'maxLoad') return `${value.toFixed(0)} ${unit}`;
  return String(Math.round(value));
}

export function WorkoutPulseSection({ pulse }: { pulse: WorkoutPulse }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const { resolvedUnits } = useUnits();
  const [selected, setSelected] = useState<PulseMetricId>('volume');
  const unit = workoutLoadUnit(resolvedUnits);

  return (
    <View style={{ marginTop: spacing[7] }}>
      <Slash style={{ marginBottom: spacing[1] }}>{t('done.summary.pulse.title')}</Slash>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted, marginBottom: spacing[3] }}>
        {t('done.summary.pulse.subtitle')}
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing[2] }}>
        {PULSE_METRIC_IDS.map((metric) => {
          const active = metric === selected;
          return (
            <Pressable
              key={metric}
              onPress={() => setSelected(metric)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: sizes.controlSm,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radii.control,
                borderWidth: 1,
                borderColor: active ? theme.colors.primaryEmphasis : theme.colors.border,
                backgroundColor: active ? theme.colors.surfaceSelected : theme.colors.surface,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <MonoLabel size={8.5} color={active ? theme.colors.textPrimary : theme.colors.textFaint}>
                {t(`done.summary.pulse.options.${metric}`).toUpperCase()}
              </MonoLabel>
            </Pressable>
          );
        })}
      </View>

      <Card style={{ marginTop: spacing[4], padding: spacing[4] }}>
        {!pulse.hasPreviousSession || !pulse.metrics ? (
          <View>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary }}>
              {t('done.summary.pulse.emptyTitle')}
            </Text>
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, lineHeight: 18, color: theme.colors.textMuted, marginTop: spacing[1] }}>
              {t('done.summary.pulse.emptySubtitle')}
            </Text>
          </View>
        ) : (
          (() => {
            const comparison = pulse.metrics[selected];
            const maxValue = Math.max(comparison.currentValue, comparison.previousValue, 1);
            const deltaColor = comparison.direction === 'positive'
              ? theme.colors.success
              : comparison.direction === 'negative'
                ? theme.colors.dangerText
                : theme.colors.textFaint;
            const deltaArrow = comparison.direction === 'positive' ? '↑' : comparison.direction === 'negative' ? '↓' : '';

            return (
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
                  <Display size={40}>{formatMetricValue(selected, comparison.currentValue, unit)}</Display>
                  {comparison.direction !== 'neutral' ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: deltaColor }}>
                      {deltaArrow} {comparison.deltaPercent != null
                        ? `${Math.abs(comparison.deltaPercent).toFixed(0)}%`
                        : formatMetricValue(selected, Math.abs(comparison.deltaAbsolute), unit)}
                    </Text>
                  ) : (
                    <MonoLabel size={9}>{t('done.summary.pulse.noChange')}</MonoLabel>
                  )}
                </View>
                <MonoLabel size={9} style={{ marginTop: 2 }}>{t('done.summary.pulse.currentLabel').toUpperCase()}</MonoLabel>

                <View style={{ marginTop: spacing[4], gap: spacing[2] }}>
                  <View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.progressTrack, overflow: 'hidden' }}>
                      <View style={{ height: 8, borderRadius: 4, width: `${(comparison.currentValue / maxValue) * 100}%`, backgroundColor: theme.colors.primaryEmphasis }} />
                    </View>
                    <MonoLabel size={8} style={{ marginTop: 3 }}>{t('done.summary.pulse.currentLabel').toUpperCase()}</MonoLabel>
                  </View>
                  <View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.progressTrack, overflow: 'hidden' }}>
                      <View style={{ height: 8, borderRadius: 4, width: `${(comparison.previousValue / maxValue) * 100}%`, backgroundColor: theme.colors.textFaint }} />
                    </View>
                    <MonoLabel size={8} style={{ marginTop: 3 }}>{t('done.summary.pulse.previousLabel').toUpperCase()}</MonoLabel>
                  </View>
                </View>
              </View>
            );
          })()
        )}
      </Card>
    </View>
  );
}

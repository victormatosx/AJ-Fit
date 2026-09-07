import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { GRID_COLUMNS, type FrequencyWindowViewModel } from '../../home/frequencyHeatmap';

const GAP = 4;
const MAX_CELL = 30;
// A known Monday — only used to derive Monday-first weekday letters, never as an actual date.
const WEEKDAY_HEADER_ANCHOR_MONDAY = '2024-01-01';

function cellSizeForWidth(width: number): number {
  if (width <= 0) return 0;
  const raw = (width - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  return Math.max(0, Math.min(MAX_CELL, Math.floor(raw)));
}

function formatLocalDate(localDate: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  // `T12:00:00` avoids any UTC-midnight rollover onto the adjacent calendar
  // day for locales far from UTC.
  const date = new Date(`${localDate}T12:00:00`);
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function weekdayLetter(columnIndex: number, locale: string): string {
  const date = new Date(`${WEEKDAY_HEADER_ANCHOR_MONDAY}T12:00:00`);
  date.setDate(date.getDate() + columnIndex);
  return new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date).toUpperCase();
}

/**
 * "Sua frequência" — a compact 30-day grid of real completed workout dates
 * only, one 30-day block at a time (never the old 16-week strip). Grid
 * shape/padding comes entirely from `buildFrequencyWindow` (pure, tested);
 * this component only turns it into pixels from the measured available
 * width, so it never recomputes calendar math itself.
 */
export function FrequencyHeatmap({
  window: freqWindow,
  loading,
  canGoNext,
  onPrev,
  onNext,
}: {
  window: FrequencyWindowViewModel | null;
  /** A newer period was selected but isn't displayed yet — `window` is still the previous one. Only ever dims in place, never unmounts/resizes the section. */
  loading: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, i18n } = useTranslation('home');
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const cellSize = useMemo(() => cellSizeForWidth(width), [width]);

  // Very subtle cross-fade when the selected window changes — content
  // first, alignment/functionality unaffected either way.
  const fade = useRef(new Animated.Value(1)).current;
  const offsetWindows = freqWindow?.offsetWindows;
  useEffect(() => {
    if (offsetWindows === undefined) return;
    fade.setValue(0.3);
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [offsetWindows, fade]);

  const rangeLabel = freqWindow
    ? `${formatLocalDate(freqWindow.startLocalDate, locale, { day: '2-digit', month: 'short' })} — ${formatLocalDate(freqWindow.endLocalDate, locale, { day: '2-digit', month: 'short' })}`.toUpperCase()
    : '';

  const summary = freqWindow
    ? (freqWindow.isCurrentWindow
        ? t('activity.frequency.summaryCurrent', { count: freqWindow.completedCount })
        : t('activity.frequency.summaryPeriod', { count: freqWindow.completedCount })
      ).toUpperCase()
    : '';

  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12, opacity: loading ? 0.55 : 1 }}>
      <MonoLabel>{t('activity.frequency.title').toUpperCase()}</MonoLabel>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 10 }}>
        <Pressable
          onPress={onPrev}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('activity.frequency.prev')}
        >
          <Icon name="arrow-left" size={14} color={theme.colors.textSecondary} />
        </Pressable>

        <Animated.View style={{ opacity: fade }}>
          <MonoLabel color={theme.colors.textSecondary}>{rangeLabel}</MonoLabel>
        </Animated.View>

        <Pressable
          onPress={canGoNext ? onNext : undefined}
          disabled={!canGoNext}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('activity.frequency.next')}
          accessibilityState={{ disabled: !canGoNext }}
          style={{ opacity: canGoNext ? 1 : 0.25 }}
        >
          <Icon name="arrow-right" size={14} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <Animated.View onLayout={onLayout} style={{ marginTop: 12, alignItems: 'center', opacity: fade }}>
        {cellSize > 0 && freqWindow && (
          <>
            <View style={{ flexDirection: 'row', gap: GAP, marginBottom: 6 }}>
              {Array.from({ length: GRID_COLUMNS }, (_, index) => (
                <View key={index} style={{ width: cellSize, alignItems: 'center' }}>
                  <MonoLabel size={9} color={theme.colors.textFaint}>{weekdayLetter(index, locale)}</MonoLabel>
                </View>
              ))}
            </View>
            <View style={{ gap: GAP }}>
              {freqWindow.weeks.map((row, rowIndex) => (
                <View key={rowIndex} style={{ flexDirection: 'row', gap: GAP }}>
                  {row.map((day, columnIndex) => (
                    <View
                      // Positional, not date-based: navigating swaps this
                      // cell's props in place instead of unmounting/
                      // remounting a brand-new node for every date, which
                      // is what made period navigation feel heavy.
                      key={columnIndex}
                      accessibilityLabel={day
                        ? (day.completed
                            ? t('activity.frequency.cellCompleted', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) })
                            : t('activity.frequency.cellEmpty', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) }))
                        : undefined}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRadius: theme.radii.xs,
                        backgroundColor: day?.completed ? theme.colors.primaryEmphasis : theme.colors.surfaceMuted,
                        borderWidth: day?.isToday ? 1.5 : 0,
                        borderColor: theme.colors.primaryBorderMuted,
                        opacity: day ? 1 : 0,
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </Animated.View>

      <View style={{ marginTop: 10 }}>
        <MonoLabel color={theme.colors.textSecondary}>{summary}</MonoLabel>
      </View>
    </View>
  );
}

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { GRID_COLUMNS, GRID_ROWS, type FrequencyWindowViewModel } from '../../home/frequencyHeatmap';

// Matches the design spec's explicit "gap 3" between heatmap cells (section
// 2.6) — also the single source of truth for `cellSizeForWidth`'s sizing
// math below, so the rendered gap and the sizing math can never drift apart
// again (they did briefly during the GitHub-grid restyle).
const GAP = 3;
const MAX_CELL = 30;
// Fixed width of the weekday-letter gutter column — unlike every other
// column, it is NOT `cellSize`-wide. See `cellSizeForWidth` below.
const LABEL_GUTTER = 14;
// A known Monday — only used to derive Monday-first weekday letters, never as an actual date.
const WEEKDAY_HEADER_ANCHOR_MONDAY = '2024-01-01';

/**
 * The rendered grid is 1 fixed-width label gutter + `GRID_ROWS` (calendar
 * weeks, rendered as columns) `cellSize`-wide columns, with `GAP` between
 * every adjacent element (`GRID_ROWS` gaps total, since `GRID_ROWS + 1`
 * elements sit side by side). Keep this in sync with the actual JSX below —
 * this is the single place cell size is computed from available width.
 */
function cellSizeForWidth(width: number): number {
  if (width <= 0) return 0;
  const raw = (width - LABEL_GUTTER - GAP * GRID_ROWS) / GRID_ROWS;
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
  source = 'AUTHORITATIVE',
  knownThroughLocalDate,
}: {
  window: FrequencyWindowViewModel | null;
  /** A newer period was selected but isn't displayed yet — `window` is still the previous one. Only ever dims in place, never unmounts/resizes the section. */
  loading: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  source?: 'CACHE' | 'CURRENT_SESSION' | 'AUTHORITATIVE';
  knownThroughLocalDate?: string;
}) {
  const { t, i18n } = useTranslation('home');
  const { width: windowWidth } = useWindowDimensions();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  // The section has a deterministic 22pt inset on both sides. Deriving the
  // grid from the already-known viewport width means its cells exist in the
  // same commit as the final data; the old width=0 -> onLayout -> grid path
  // injected five rows one commit later and was the measured Home jump.
  const cellSize = useMemo(() => cellSizeForWidth(windowWidth - 44), [windowWidth]);

  // Very subtle cross-fade when the selected window changes — content
  // first, alignment/functionality unaffected either way.
  const fade = useRef(new Animated.Value(1)).current;
  const hasCommittedInitialWindowRef = useRef(false);
  const offsetWindows = freqWindow?.offsetWindows;
  useEffect(() => {
    if (offsetWindows === undefined) return;
    if (!hasCommittedInitialWindowRef.current) {
      hasCommittedInitialWindowRef.current = true;
      fade.setValue(1);
      return;
    }
    fade.setValue(0.3);
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [offsetWindows, fade]);

  const rangeLabel = freqWindow
    ? `${formatLocalDate(freqWindow.startLocalDate, locale, { day: '2-digit', month: 'short' })} — ${formatLocalDate(freqWindow.endLocalDate, locale, { day: '2-digit', month: 'short' })}`.toUpperCase()
    : '';

  const summary = source === 'CACHE'
    ? t('activity.frequency.cachedSummary')
    : source === 'CURRENT_SESSION'
      ? t('activity.frequency.refreshingSummary')
    : freqWindow
    ? (freqWindow.isCurrentWindow
        ? t('activity.frequency.summaryCurrent', { count: freqWindow.completedCount })
        : t('activity.frequency.summaryPeriod', { count: freqWindow.completedCount })
      ).toUpperCase()
    : '';

  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12, opacity: loading ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <MonoLabel>{t('activity.frequency.title').toUpperCase()}</MonoLabel>
        <Animated.View style={{ opacity: fade }}>
          <MonoLabel color={'rgba(255,255,255,0.5)'}>{summary}</MonoLabel>
        </Animated.View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 10 }}>
        <Pressable
          onPress={source === 'AUTHORITATIVE' ? onPrev : undefined}
          disabled={source !== 'AUTHORITATIVE'}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('activity.frequency.prev')}
        >
          <Icon name="arrow-left" size={14} color={'rgba(255,255,255,0.5)'} />
        </Pressable>
        <Animated.View style={{ opacity: fade }}>
          <MonoLabel color={'rgba(255,255,255,0.5)'}>{rangeLabel}</MonoLabel>
        </Animated.View>
        <Pressable
          onPress={source === 'AUTHORITATIVE' && canGoNext ? onNext : undefined}
          disabled={source !== 'AUTHORITATIVE' || !canGoNext}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('activity.frequency.next')}
          accessibilityState={{ disabled: source !== 'AUTHORITATIVE' || !canGoNext }}
          style={{ opacity: canGoNext ? 1 : 0.25 }}
        >
          <Icon name="arrow-right" size={14} color={'rgba(255,255,255,0.5)'} />
        </Pressable>
      </View>

      <Animated.View style={{ marginTop: 14, opacity: fade, flexDirection: 'row', gap: GAP }}>
        {cellSize > 0 && freqWindow && (
          <>
            <View style={{ width: LABEL_GUTTER, justifyContent: 'space-between' }}>
              {Array.from({ length: GRID_COLUMNS }, (_, i) => i).map((row) => (
                <View key={row} style={{ height: cellSize, justifyContent: 'center' }}>
                  {/* GitHub's own convention: label every other weekday row to reduce clutter (Mon/Wed/Fri/Sun here, since rows are Monday-first). */}
                  {row % 2 === 0 && (
                    <MonoLabel size={8} color={'rgba(255,255,255,0.32)'}>{weekdayLetter(row, locale)}</MonoLabel>
                  )}
                </View>
              ))}
            </View>
            {freqWindow.weeks.map((week, columnIndex) => (
              // Positional, not date-based: navigating swaps this cell's
              // props in place instead of unmounting/remounting a brand-new
              // node for every date, which is what made period navigation
              // feel heavy.
              <View key={columnIndex} style={{ gap: GAP }}>
                {week.map((day, rowIndex) => (
                  <View
                    key={rowIndex}
                    accessibilityLabel={day && (source !== 'CACHE' || !knownThroughLocalDate || day.localDate <= knownThroughLocalDate)
                      ? (day.completed
                          ? t('activity.frequency.cellCompleted', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) })
                          : t('activity.frequency.cellEmpty', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) }))
                      : undefined}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 3,
                      backgroundColor: source === 'CACHE' && day && knownThroughLocalDate && day.localDate > knownThroughLocalDate
                        ? '#020010'
                        : day?.completed ? '#4da3ff' : 'rgba(255,255,255,0.05)',
                      borderWidth: day?.isToday ? 1 : 0,
                      borderColor: 'rgba(77,163,255,0.8)',
                      opacity: day ? (source === 'CACHE' && knownThroughLocalDate && day.localDate > knownThroughLocalDate ? 0.45 : 1) : 0,
                    }}
                  />
                ))}
              </View>
            ))}
          </>
        )}
      </Animated.View>

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 12 }}>
        <MonoLabel size={9} color={'rgba(255,255,255,0.32)'}>{t('activity.frequency.less').toUpperCase()}</MonoLabel>
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.05)' }} />
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#4da3ff' }} />
        <MonoLabel size={9} color={'rgba(255,255,255,0.32)'}>{t('activity.frequency.more').toUpperCase()}</MonoLabel>
      </View>
    </View>
  );
}

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { GRID_COLUMNS, GRID_ROWS, type FrequencyWindowViewModel } from '../../home/frequencyHeatmap';
import type { WeeklyFrequency } from '../../home/weeklyFrequency';

// Calendar-grid layout (2026-10-08 restyle) — `GRID_COLUMNS` (7, Monday-first
// weekdays) cells per row, `GAP` between every adjacent cell. Single source
// of truth for `cellSizeForWidth`'s sizing math below, so the rendered gap
// and the sizing math can never drift apart.
const GAP = 6;
const MAX_CELL = 32;
// A known Monday — only used to derive Monday-first weekday letters, never as an actual date.
const WEEKDAY_HEADER_ANCHOR_MONDAY = '2024-01-01';

/**
 * The rendered grid is `GRID_COLUMNS`-wide, `cellSize`-tall rows, with `GAP`
 * between every adjacent column (`GRID_COLUMNS - 1` gaps total). Keep this in
 * sync with the actual JSX below — this is the single place cell size is
 * computed from available width.
 */
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
  source = 'AUTHORITATIVE',
  knownThroughLocalDate,
  weeklyFrequency = null,
}: {
  window: FrequencyWindowViewModel | null;
  /** A newer period was selected but isn't displayed yet — `window` is still the previous one. Only ever dims in place, never unmounts/resizes the section. */
  loading: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /**
   * "Frequência desta semana" — distinct days trained this week over the
   * weekly goal. Rendered as one compact row above the 30-day grid, which
   * keeps its own, different semantics untouched. `null`, or a `null`
   * `percent` (no usable goal), renders nothing at all rather than a
   * misleading 0%.
   */
  weeklyFrequency?: WeeklyFrequency | null;
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
      <MonoLabel>{t('activity.frequency.title').toUpperCase()}</MonoLabel>

      {/* "Frequência desta semana" — compact row, existing tokens only (same
          MonoLabel, same accent `#4da3ff`, same muted white, same 8px radius
          as the grid cells). Deliberately NOT a card and NOT a replacement for
          the 30-day grid below: the two answer different questions, and the
          streak answers a third. Hidden entirely when there is no usable
          weekly goal — a 0% would claim the user trained nothing. */}
      {weeklyFrequency && weeklyFrequency.percent !== null && (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <MonoLabel color={'rgba(255,255,255,0.5)'}>
              {t('activity.frequency.weekly.label').toUpperCase()}
            </MonoLabel>
            <MonoLabel color={'#4da3ff'}>{`${weeklyFrequency.percent}%`}</MonoLabel>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: weeklyFrequency.percent }}
            style={{ height: 3, borderRadius: 8, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}
          >
            <View style={{ width: `${weeklyFrequency.percent}%`, height: '100%', backgroundColor: '#4da3ff' }} />
          </View>
          <View style={{ marginTop: 8 }}>
            <MonoLabel color={'rgba(255,255,255,0.5)'}>
              {t('activity.frequency.weekly.summary', {
                trained: weeklyFrequency.trainedDays,
                goal: weeklyFrequency.goal,
              }).toUpperCase()}
            </MonoLabel>
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14 }}>
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

      <Animated.View style={{ marginTop: 18, opacity: fade }}>
        {cellSize > 0 && freqWindow && (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: GAP, marginBottom: 8 }}>
              {Array.from({ length: GRID_COLUMNS }, (_, i) => i).map((col) => (
                <View key={col} style={{ width: cellSize, alignItems: 'center' }}>
                  <MonoLabel size={10} color={'rgba(255,255,255,0.4)'}>{weekdayLetter(col, locale)}</MonoLabel>
                </View>
              ))}
            </View>
            <View style={{ gap: GAP }}>
              {freqWindow.weeks.map((week, rowIndex) => (
                // Positional, not date-based: navigating swaps this cell's
                // props in place instead of unmounting/remounting a brand-new
                // node for every date, which is what made period navigation
                // feel heavy.
                <View key={rowIndex} style={{ flexDirection: 'row', justifyContent: 'center', gap: GAP }}>
                  {week.map((day, colIndex) => (
                    <View
                      key={colIndex}
                      accessibilityLabel={day && (source !== 'CACHE' || !knownThroughLocalDate || day.localDate <= knownThroughLocalDate)
                        ? (day.completed
                            ? t('activity.frequency.cellCompleted', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) })
                            : t('activity.frequency.cellEmpty', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) }))
                        : undefined}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRadius: 8,
                        backgroundColor: source === 'CACHE' && day && knownThroughLocalDate && day.localDate > knownThroughLocalDate
                          ? '#020010'
                          : day?.completed ? '#4da3ff' : 'rgba(255,255,255,0.05)',
                        borderWidth: day?.isToday ? 1.5 : 0,
                        borderColor: 'rgba(77,163,255,0.8)',
                        opacity: day ? (source === 'CACHE' && knownThroughLocalDate && day.localDate > knownThroughLocalDate ? 0.45 : 1) : 0,
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </Animated.View>

      <Animated.View style={{ marginTop: 14, opacity: fade }}>
        <MonoLabel color={'rgba(255,255,255,0.5)'}>{summary}</MonoLabel>
      </Animated.View>
    </View>
  );
}

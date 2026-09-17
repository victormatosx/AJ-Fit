import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import type { WeekDayStatus, WeekOverviewViewModel } from '../../home/weekOverview';

const CELL_SIZE = 30;

function weekdayLetter(localDate: string, locale: string): string {
  // `T-12:00` avoids any UTC-midnight rollover onto the adjacent calendar
  // day for locales far from UTC — only the weekday label is derived here.
  const date = new Date(`${localDate}T12:00:00`);
  const letter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date);
  return letter.toUpperCase();
}

function CellGlyph({ status, color }: { status: WeekDayStatus; color: string }) {
  const { theme } = useTheme();
  if (status === 'COMPLETED' || status === 'TODAY_COMPLETED') {
    return <Icon name="check" size={12} color={color} stroke={2.2} />;
  }
  if (status === 'FULFILLED_EARLY') {
    return <Icon name="arrow-right" size={11} color={color} stroke={2} />;
  }
  if (status === 'MISSED') {
    return <Icon name="x" size={11} color={color} stroke={2} />;
  }
  if (status === 'REST' || status === 'ACTIVE_RECOVERY' || status === 'BEFORE_PROGRAM') {
    return <View style={{ width: 4, height: 1.5, borderRadius: 1, backgroundColor: color }} />;
  }
  // TODAY_PENDING / UPCOMING — an open ring, no fabricated fill.
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: theme.radii.pill,
        borderWidth: 1.5,
        borderColor: color,
      }}
    />
  );
}

/**
 * "Esta semana" — reads in ~1s: which training days are done, which is
 * today, which are still ahead, which are rest. Every day's `status` comes
 * from `buildWeekOverview` (pure projection of the real Schedule Engine
 * config + real completed dates) — never recomputed here.
 */
export function WeeklyOverview({ overview }: { overview: WeekOverviewViewModel }) {
  const { t, i18n } = useTranslation('home');
  const { theme } = useTheme();
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <MonoLabel>{t('activity.week.title').toUpperCase()}</MonoLabel>
        <MonoLabel color={theme.colors.textSecondary}>
          {t('activity.week.summary', {
            completed: overview.completedCount,
            scheduled: overview.scheduledCount,
          }).toUpperCase()}
        </MonoLabel>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        {overview.days.map((day) => {
          const isDim = day.status === 'REST' || day.status === 'ACTIVE_RECOVERY' || day.status === 'BEFORE_PROGRAM';
          const glyphColor = day.status === 'COMPLETED' || day.status === 'TODAY_COMPLETED' || day.status === 'FULFILLED_EARLY'
            ? theme.colors.primaryEmphasis
            : day.status === 'MISSED'
              ? theme.colors.textMuted
              : isDim
                ? theme.colors.indicatorRest
                : theme.colors.textFaint;

          return (
            <View key={day.localDate} style={{ alignItems: 'center', width: CELL_SIZE }}>
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 10,
                  color: day.isToday ? theme.colors.primaryEmphasis : theme.colors.textFaint,
                }}
              >
                {weekdayLetter(day.localDate, locale)}
              </Text>
              <View
                accessibilityLabel={t(`activity.week.status.${day.status}`)}
                accessibilityRole="text"
                style={{
                  marginTop: 6,
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: day.isToday ? theme.colors.primarySurfaceSubtle : 'transparent',
                  borderWidth: day.isToday ? 1 : 0,
                  borderColor: theme.colors.primaryBorderQuiet,
                }}
              >
                <CellGlyph status={day.status} color={glyphColor} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';
import { macroStatus } from '../../nutrition/ui/planView';
import type { NutritionTotals } from '../../types/nutrition';

const STATUS_TOKENS = {
  below: { text: 'statusOffText', bg: 'statusOffBackground' },
  near: { text: 'statusSuccessText', bg: 'statusSuccessBackground' },
  above: { text: 'statusCautionText', bg: 'statusCautionBackground' },
} as const;

/** One macro row — reusable for kcal/protein/carbs/fat/fiber. Never punitive (`components.md` §2). */
export function MacroProgress({ label, value, goal, unit }: { label: string; value: number; goal: number; unit: string }) {
  const { theme } = useTheme();
  const status = macroStatus(value, goal);
  const tokens = STATUS_TOKENS[status];
  const ratio = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <MonoLabel color={theme.colors.textFaint}>{label}</MonoLabel>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: (theme.colors as Record<string, string>)[tokens.text] }}>
          {Math.round(value)} / {Math.round(goal)}{unit}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: theme.radii.pill, backgroundColor: theme.colors.progressTrack, overflow: 'hidden' }}>
        <View
          style={{
            height: '100%',
            width: `${Math.round(ratio * 100)}%`,
            borderRadius: theme.radii.pill,
            backgroundColor: (theme.colors as Record<string, string>)[tokens.text],
          }}
        />
      </View>
    </View>
  );
}

export function DailyNutritionSummary({ totals, goals }: { totals: NutritionTotals; goals: NutritionTotals }) {
  const { t } = useTranslation('nutrition');
  const { theme } = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <MonoLabel color={theme.colors.textSecondary}>{t('home.summary.title')}</MonoLabel>
      <MacroProgress label={t('home.summary.kcalGoal')} value={totals.kcal} goal={goals.kcal} unit={t('units.kcal')} />
      <MacroProgress label={t('home.summary.protein')} value={totals.proteinG} goal={goals.proteinG} unit={t('units.gramsShort')} />
      <MacroProgress label={t('home.summary.carbs')} value={totals.carbsG} goal={goals.carbsG} unit={t('units.gramsShort')} />
      <MacroProgress label={t('home.summary.fat')} value={totals.fatG} goal={goals.fatG} unit={t('units.gramsShort')} />
      <MacroProgress label={t('home.summary.fiber')} value={totals.fiberG} goal={goals.fiberG} unit={t('units.gramsShort')} />
    </View>
  );
}

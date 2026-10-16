import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NU, NuRing } from './NuKit';
import { displayLineHeight } from '../../theme/tokens';
import type { NutritionTotals } from '../../types/nutrition';

/** One macro ring — reusable for protein/carbs/fat/fiber. Never punitive (`components.md` §2). */
export function MacroProgress({ label, value, goal, unit }: { label: string; value: number; goal: number; unit: string }) {
  const pct = goal > 0 ? (value / goal) * 100 : 0;
  return (
    <View style={{ alignItems: 'center', gap: 8, width: 64 }}>
      <NuRing size={60} stroke={4.5} pct={pct} color={NU.strong} accessibilityLabel={`${label} ${Math.round(value)}/${Math.round(goal)}${unit}`}>
        <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 17, lineHeight: displayLineHeight(17), color: NU.white, textTransform: 'uppercase' }}>{Math.round(value)}</Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 9.5, color: NU.faint, marginTop: 2 }}>/{Math.round(goal)}{unit}</Text>
      </NuRing>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 8.5, letterSpacing: 1.1, color: NU.legend, textTransform: 'uppercase', width: '100%', textAlign: 'center' }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The kcal hero ring + 4 macro rings below it (spec §3.3/§3.4). Same props/semantics as before — real consumption vs. the active plan's goal, never the plan's own totals. */
export function DailyNutritionSummary({ totals, goals }: { totals: NutritionTotals; goals: NutritionTotals }) {
  const { t } = useTranslation('nutrition');
  const left = goals.kcal - totals.kcal;
  return (
    <View>
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <NuRing size={212} stroke={12} pct={goals.kcal > 0 ? (totals.kcal / goals.kcal) * 100 : 0} accessibilityLabel={t('home.summary.kcalGoal')}>
          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: NU.legend, textTransform: 'uppercase' }}>
            {left >= 0 ? t('home.summary.remaining') : t('home.summary.over')}
          </Text>
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 46, lineHeight: displayLineHeight(46), color: left >= 0 ? NU.white : NU.warn, marginTop: 10, textTransform: 'uppercase' }}>
            {Math.round(Math.abs(left))}
          </Text>
          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: NU.legend, marginTop: 10, textTransform: 'uppercase' }}>
            {t('units.kcal')}
          </Text>
          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint, marginTop: 12 }}>
            {Math.round(totals.kcal)} {t('home.summary.of')} {Math.round(goals.kcal)}
          </Text>
        </NuRing>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 28 }}>
        <MacroProgress label={t('home.summary.protein')} value={totals.proteinG} goal={goals.proteinG} unit={t('units.gramsShort')} />
        <MacroProgress label={t('home.summary.carbs')} value={totals.carbsG} goal={goals.carbsG} unit={t('units.gramsShort')} />
        <MacroProgress label={t('home.summary.fat')} value={totals.fatG} goal={goals.fatG} unit={t('units.gramsShort')} />
        <MacroProgress label={t('home.summary.fiber')} value={totals.fiberG} goal={goals.fiberG} unit={t('units.gramsShort')} />
      </View>
    </View>
  );
}

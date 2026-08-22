import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';
import { radii, spacing } from '../../theme/tokens';
import { useUnits } from '../../state/UnitsContext';
import {
  formatWeightFromKg,
  weightUnit,
} from '../../units/weightConversions';
import { formatHeightFromCm, heightUnit } from '../../units/heightConversions';

export type AssessmentHistoryRow = {
  id: string;
  date: string;
  weight: number;
  /** null when the assessment has no body-fat estimate (e.g. an imported record without it). */
  bodyFat: number | null;
  bmi: number | null;
  leanMass: number | null;
  fatMass: number | null;
  height: number;
  source: 'guided' | 'imported';
  protocolLabel?: string;
  age?: number;
  sex?: 'm' | 'f';
  skinfolds?: Array<{ label: string; value: number }>;
  bodyWater?: number;
  basalMetabolism?: number;
  visceralFat?: number;
  notes?: string;
};

function MiniStat({ l, v, u }: { l: string; v: string; u: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 15,
            color: theme.colors.textPrimary,
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {v}
        </Text>
        {u ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textFaint, marginLeft: 1 }}>
            {u}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 8,
          color: theme.colors.textFaint,
          letterSpacing: 0.5,
          marginTop: 3,
        }}
      >
        {l}
      </Text>
    </View>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ marginTop: spacing[5] }}>
      <MonoLabel color={theme.colors.primaryEmphasis}>{label}</MonoLabel>
      <View style={{ marginTop: spacing[2.5] }}>{children}</View>
    </View>
  );
}

function DetailValue({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: '48%',
        minHeight: 62,
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2.5],
        borderRadius: radii.md,
        backgroundColor: theme.colors.surfaceRaised,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <MonoLabel size={8}>{label}</MonoLabel>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: spacing[1.5] }}>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.textPrimary }}>{value}</Text>
        {unit ? (
          <Text style={{ marginLeft: 3, fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textFaint }}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: spacing[2.5],
      }}
    >
      {children}
    </View>
  );
}

function HistoryRow({
  entry,
  highlight,
  expanded,
  onToggle,
}: {
  entry: AssessmentHistoryRow;
  highlight: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  const displayedHeightUnit = heightUnit(resolvedUnits);
  const chevronRot = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevronRot, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded, chevronRot]);

  const hasComposition = entry.leanMass != null && entry.fatMass != null;
  const isImported = entry.source === 'imported';
  const hasImportedDetails =
    entry.bodyWater != null ||
    entry.basalMetabolism != null ||
    entry.visceralFat != null;
  const notAvailable = t('history.details.notAvailable');

  return (
    <View
      style={{
        position: 'relative',
        paddingLeft: 34,
        marginBottom: highlight ? 18 : 14,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 8,
          top: 18,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: highlight ? theme.colors.primary : theme.colors.borderStrong,
          borderWidth: 2,
          borderColor: highlight
            ? theme.colors.primaryEmphasis
            : theme.colors.equipmentCheckboxBorder,
          shadowColor: highlight ? theme.colors.primary : 'transparent',
          shadowOpacity: highlight ? 0.7 : 0,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
          elevation: highlight ? 4 : 0,
        }}
      />
      <Card
        style={{
          padding: highlight ? 17 : 15,
          borderColor: highlight ? theme.colors.primaryBorderStrong : theme.colors.cardBorder,
          shadowColor: highlight ? theme.colors.primary : 'transparent',
          shadowOpacity: highlight ? 0.16 : 0,
          shadowRadius: highlight ? 14 : 0,
          shadowOffset: { width: 0, height: 6 },
          elevation: highlight ? 3 : 0,
        }}
      >
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MonoLabel color={highlight ? theme.colors.primaryEmphasis : theme.colors.textFaint}>{entry.date}</MonoLabel>
            {entry.source === 'imported' && (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 5,
                  backgroundColor: theme.colors.badgeBackground,
                }}
              >
                <MonoLabel size={8}>
                  {t('history.labels.importedBadge').toUpperCase()}
                </MonoLabel>
              </View>
            )}
          </View>
          <Pressable
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={t(
              expanded ? 'accessibility.closeAssessment' : 'accessibility.openAssessment',
              { date: entry.date },
            )}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 10,
                letterSpacing: 1,
                color: theme.colors.textSubtle,
              }}
            >
              {t(expanded ? 'history.labels.hideDetails' : 'history.labels.viewDetails').toUpperCase()}
            </Text>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: chevronRot.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '90deg'],
                    }),
                  },
                ],
              }}
            >
              <Icon name="chevron-right" size={12} color={theme.colors.textSubtle} />
            </Animated.View>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <MiniStat
            l={t('metrics.weight').toUpperCase()}
            v={formatWeightFromKg(entry.weight, resolvedUnits)}
            u={massUnit}
          />
          <MiniStat
            l={t('metrics.bmi').toUpperCase()}
            v={entry.bmi != null ? entry.bmi.toFixed(1) : '—'}
            u=""
          />
          <MiniStat
            l={t('metrics.bodyFat').toUpperCase()}
            v={entry.bodyFat != null ? entry.bodyFat.toFixed(1) : '—'}
            u={t('units.percent')}
          />
        </View>
        {expanded && (
          <View
            style={{
              marginTop: spacing[4],
              paddingTop: spacing[4],
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radii.control,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={isImported ? 'download' : 'ruler'} size={15} color={theme.colors.primaryEmphasis} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14.5, color: theme.colors.textPrimary }}>
                  {t('history.details.title')}
                </Text>
                <Text style={{ marginTop: 2, fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textMuted }}>
                  {isImported
                    ? t('history.labels.importedBadge')
                    : t('history.labels.guidedBadge')}
                  {entry.protocolLabel ? ` · ${entry.protocolLabel}` : ''}
                </Text>
              </View>
            </View>

            <DetailSection label={t('history.details.sections.composition').toUpperCase()}>
              <DetailGrid>
                <DetailValue
                  label={t('metrics.leanMass').toUpperCase()}
                  value={
                    entry.leanMass != null
                      ? formatWeightFromKg(entry.leanMass, resolvedUnits)
                      : notAvailable
                  }
                  unit={entry.leanMass != null ? massUnit : undefined}
                />
                <DetailValue
                  label={t('metrics.fatMass').toUpperCase()}
                  value={
                    entry.fatMass != null
                      ? formatWeightFromKg(entry.fatMass, resolvedUnits)
                      : notAvailable
                  }
                  unit={entry.fatMass != null ? massUnit : undefined}
                />
              </DetailGrid>
              {!hasComposition ? (
                <Text
                  style={{
                    marginTop: spacing[2.5],
                    fontFamily: theme.fonts.ui,
                    fontSize: 11.5,
                    lineHeight: 17,
                    color: theme.colors.textMuted,
                  }}
                >
                  {t('history.details.compositionUnavailable')}
                </Text>
              ) : null}
            </DetailSection>

            <DetailSection label={t('history.details.sections.context').toUpperCase()}>
              <DetailGrid>
                <DetailValue
                  label={t('fields.height.label').toUpperCase()}
                  value={formatHeightFromCm(entry.height, resolvedUnits)}
                  unit={displayedHeightUnit}
                />
                <DetailValue
                  label={t('guided.protocolLabel').toUpperCase()}
                  value={entry.protocolLabel ?? (isImported ? t('history.labels.importedBadge') : notAvailable)}
                />
                {entry.age != null ? (
                  <DetailValue
                    label={t('fields.ageAtAssessment.label').toUpperCase()}
                    value={String(entry.age)}
                    unit={t('units.years')}
                  />
                ) : null}
                {entry.sex ? (
                  <DetailValue
                    label={t('guided.sexLabel').toUpperCase()}
                    value={t(entry.sex === 'm' ? 'guided.male' : 'guided.female')}
                  />
                ) : null}
              </DetailGrid>
            </DetailSection>

            {entry.skinfolds?.length ? (
              <DetailSection label={t('history.details.sections.skinfolds').toUpperCase()}>
                <DetailGrid>
                  {entry.skinfolds.map((fold) => (
                    <DetailValue
                      key={fold.label}
                      label={fold.label.toUpperCase()}
                      value={fold.value.toFixed(1).replace(/\.0$/, '')}
                      unit={t('units.mm')}
                    />
                  ))}
                </DetailGrid>
              </DetailSection>
            ) : null}

            {isImported && hasImportedDetails ? (
              <DetailSection label={t('history.details.sections.additional').toUpperCase()}>
                <DetailGrid>
                  {entry.bodyWater != null ? (
                    <DetailValue
                      label={t('fields.bodyWater.label').toUpperCase()}
                      value={entry.bodyWater.toFixed(1)}
                      unit={t('units.percent')}
                    />
                  ) : null}
                  {entry.basalMetabolism != null ? (
                    <DetailValue
                      label={t('fields.basalMetabolism.label').toUpperCase()}
                      value={entry.basalMetabolism.toFixed(0)}
                      unit={t('units.kcal')}
                    />
                  ) : null}
                  {entry.visceralFat != null ? (
                    <DetailValue
                      label={t('fields.visceralFat.label').toUpperCase()}
                      value={entry.visceralFat.toFixed(1).replace(/\.0$/, '')}
                    />
                  ) : null}
                </DetailGrid>
              </DetailSection>
            ) : null}

            {entry.notes ? (
              <DetailSection label={t('history.details.sections.notes').toUpperCase()}>
                <View
                  style={{
                    padding: spacing[3],
                    borderRadius: radii.md,
                    backgroundColor: theme.colors.surfaceRaised,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, lineHeight: 18, color: theme.colors.textSecondary }}>
                    {entry.notes}
                  </Text>
                </View>
              </DetailSection>
            ) : null}
          </View>
        )}
      </Card>
    </View>
  );
}

export function AssessmentHistoryCard({
  entries,
  expandedId,
  onToggle,
}: {
  entries: AssessmentHistoryRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ position: 'relative', paddingLeft: 4 }}>
      <View
        style={{
          position: 'absolute',
          left: 15,
          top: 6,
          bottom: 6,
          width: 1.5,
          backgroundColor: theme.colors.timeline,
        }}
      />
      {entries.map((e, i) => (
        <HistoryRow
          key={e.id}
          entry={e}
          highlight={i === 0}
          expanded={expandedId === e.id}
          onToggle={() => onToggle(e.id)}
        />
      ))}
    </View>
  );
}

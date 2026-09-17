import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Animated, Easing, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import type { Timestamp } from 'firebase/firestore';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { AssessmentSection } from '../components/fitness/AssessmentSection';
import { AssessmentMetricCard } from '../components/fitness/AssessmentMetricCard';
import { PhysicalAssessmentSummaryCard } from '../components/fitness/PhysicalAssessmentSummaryCard';
import { AssessmentEvolutionCard } from '../components/fitness/AssessmentEvolutionCard';
import type { EvolutionPoint } from '../components/fitness/EvolutionLineChart';
import { AssessmentActionCard } from '../components/fitness/AssessmentActionCard';
import {
  AssessmentHistoryCard,
  AssessmentHistoryRow,
} from '../components/fitness/AssessmentHistoryCard';
import { AssessmentHistoryModal } from '../components/fitness/AssessmentHistoryModal';
import { useTheme } from '../theme';
import { radii, sizes, spacing } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';
import { useAssessments, type SaveOutcome } from '../hooks/useAssessments';
import { usePremiumCapabilities } from '../hooks/usePremiumCapabilities';
import {
  classifyAssessmentError,
  type GuidedAssessmentInput,
  type ImportedAssessmentInput,
} from '../services/assessments';
import {
  SKINFOLD_PROTOCOLS,
  computeBmi,
  computeFatMass,
  computeGuidedBodyFat,
  computeLeanMass,
  isValidAge,
  protocolById,
  type Sex,
  type SiteKey,
  type SkinfoldProtocolId,
} from '../lib/skinfoldCalculator';
import {
  formatAssessmentDateForLocale,
  formatAssessmentShortDateForLocale,
  isFutureDate,
  isSameCalendarDay,
} from '../lib/dateUtils';
import { computeAge } from '../lib/ageCalculator';
import { logError } from '../lib/logError';
import { useDateParts } from '../hooks/useDateParts';
import { NativeDatePickerField } from '../components/ui/NativeDatePickerField';
import { useUnits } from '../state/UnitsContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import {
  formatWeightFromKg,
  formatWeightInputFromKg,
  weightToKg,
  weightUnit,
} from '../units/weightConversions';
import { normalizeDecimalInput, parseDecimalInput } from '../lib/decimalInput';


const SITE_TRANSLATION_KEYS: Record<SiteKey, `skinfolds.${SiteKey}`> = {
  chest: 'skinfolds.chest',
  axilla: 'skinfolds.axilla',
  tricep: 'skinfolds.tricep',
  subscap: 'skinfolds.subscap',
  abdom: 'skinfolds.abdom',
  supra: 'skinfolds.supra',
  thigh: 'skinfolds.thigh',
};

const PROTOCOL_TRANSLATION_KEYS: Record<SkinfoldProtocolId, 'protocols.jp3' | 'protocols.jp7'> = {
  jp3: 'protocols.jp3',
  jp7: 'protocols.jp7',
};

type BmiClassification = 'underweight' | 'normal' | 'overweight' | 'obesity';
const BMI_BANDS: ReadonlyArray<{ max: number; classification: BmiClassification; c: string }> = [
  { max: 18.5, classification: 'underweight', c: '#4da3ff' },
  { max: 25, classification: 'normal', c: '#22c55e' },
  { max: 30, classification: 'overweight', c: '#f5a623' },
  { max: Infinity, classification: 'obesity', c: '#f0563f' },
];

function formatAssessmentDate(
  ts: Timestamp | null | undefined,
  todayLabel: string,
  locale: string,
): string {
  if (!ts) return todayLabel;
  return formatAssessmentDateForLocale(ts.toDate(), locale);
}

export function AssessmentScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['assessment', 'common']);
  const { resolvedUnits } = useUnits();
  // Translated label for the empty-timestamp fallback shown by
  // `formatAssessmentDate`. Passed explicitly rather than accessed via t()
  // inside the helper — keeps the formatter pure and unit-testable.
  const todayLabel = t('date.today').toUpperCase();
  const { user, profile, questionnaire } = useAuth();
  const {
    assessments,
    loading,
    error,
    latest,
    previous,
    evolutionSincePrevious,
    saveGuided,
    saveImported,
    refresh,
  } = useAssessments(user?.uid ?? null);

  // AssessmentScreen is prewarmed + kept materialized (docs/23_navegacao_e_
  // lifecycle.md §14) — `useAssessments`'s own `useEffect(refresh, [refresh])`
  // still fires once per mount, but a persistent screen only mounts once
  // per session, so a save made elsewhere (or on another device) wouldn't
  // otherwise be reflected the next time the user actually looks at this
  // screen. This re-fetches on every real activation instead. `refresh`
  // already guards against out-of-order responses via its own monotonic
  // sequence token, so firing it again here duplicates neither the listener
  // nor the risk of stale data winning a race — worst case on the very
  // first activation is one harmless extra read (the mount effect and this
  // one both fire close together), not polling.
  useScreenFocusEffect(() => {
    refresh();
  });

  // FASE 5: AssessmentActionCard gates CREATE_ASSESSMENT itself via
  // <PremiumAction> — this screen hands over plain callbacks and no longer
  // needs to know the capability exists for that. `usePremiumCapabilities`
  // is still used further below, inside each modal's own `handleSave`
  // (Fase 3 defense-in-depth, intentionally kept).
  const [showGuided, setShowGuided] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAssessmentActions, setShowAssessmentActions] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const hasAssessments = assessments.length > 0;
  // Fallback source is ALWAYS the persisted questionnaire from Firestore
  // (users/{uid}/questionnaires, loaded by AuthContext on sign-in) — never
  // the in-memory AppState quiz, which resets to hardcoded defaults on every
  // cold start and would silently show fake numbers before the real
  // questionnaire has loaded (or when it genuinely doesn't exist, e.g. a
  // social login that skipped onboarding).
  const onboardingAnswers = questionnaire?.answers ?? null;
  const displayWeight = hasAssessments ? latest!.weight : onboardingAnswers?.weight ?? null;
  // Height is profile data, not an assessment input. `profile.profile.height`
  // is the mutable value edited via EditProfileScreen and takes precedence;
  // the persisted onboarding questionnaire is the next fallback, and the
  // latest assessment is only a legacy fallback for accounts created before
  // that field was available.
  const registeredHeight =
    profile?.profile.height ?? onboardingAnswers?.height ?? latest?.height ?? null;
  // Sex comes from the persisted onboarding questionnaire. A previous guided
  // assessment is only a compatibility fallback for older accounts whose
  // questionnaire is incomplete; the new form never asks for it again.
  const lastGuidedSex = assessments.find((a) => a.source === 'guided')?.sex ?? null;
  const defaultSex: Sex | null = onboardingAnswers?.sex ?? lastGuidedSex;
  // Birth date is the only source of truth for age — resolved once in
  // userProfile.ts (with legacy-`age` compat baked in there), so by the time
  // it reaches this screen it's always a real Date or genuinely unknown. A
  // past assessment's own `age` field is intentionally NOT reused as a
  // fallback here: it was the user's age at that specific measuredAt, not a
  // birth date, and can't be projected forward.
  const birthDate =
    profile?.profile.birthDate?.toDate() ?? onboardingAnswers?.birthDate ?? null;

  // Charts read chronologically (oldest → newest); `assessments` is sorted
  // measuredAt desc for the history list, so reverse just for this. Body fat
  // only includes entries where it's actually known — an imported entry
  // without it is a gap, never plotted as 0.
  const chronological = [...assessments].reverse();
  const weightPoints: EvolutionPoint[] = chronological.map((a) => ({
    dateLabel: formatAssessmentShortDateForLocale(a.measuredAt.toDate(), i18n.language),
    value: a.weight,
  }));
  const bodyFatPoints: EvolutionPoint[] = chronological
    .filter((a) => a.bodyFat != null)
    .map((a) => ({
      dateLabel: formatAssessmentShortDateForLocale(a.measuredAt.toDate(), i18n.language),
      value: a.bodyFat as number,
    }));

  const historyRows: AssessmentHistoryRow[] = assessments.map((a) => ({
    id: a.id,
    date: formatAssessmentDate(a.measuredAt, todayLabel, i18n.language),
    weight: a.weight,
    bodyFat: a.bodyFat,
    bmi: a.bmi,
    leanMass: a.leanMass,
    fatMass: a.fatMass,
    height: a.height,
    notes: a.notes,
    source: a.source,
    protocolLabel:
      a.source === 'guided'
        ? t(`assessment:${PROTOCOL_TRANSLATION_KEYS[a.protocol]}`)
        : undefined,
    age: a.source === 'guided' ? a.age : undefined,
    sex: a.source === 'guided' ? a.sex : undefined,
    skinfolds:
      a.source === 'guided'
        ? Object.entries(a.folds).map(([site, value]) => ({
            label: t(`assessment:${SITE_TRANSLATION_KEYS[site as SiteKey]}`),
            value,
          }))
        : undefined,
    bodyWater: a.source === 'imported' ? a.bodyWater : undefined,
    basalMetabolism: a.source === 'imported' ? a.basalMetabolism : undefined,
    visceralFat: a.source === 'imported' ? a.visceralFat : undefined,
  }));
  const visibleHistoryRows = historyRows.slice(0, 3);

  // The original entry callbacks stay unchanged. Once either flow opens, the
  // compact selector is dismissed so returning from a form lands on the dashboard.
  useEffect(() => {
    if (showGuided || showImport) setShowAssessmentActions(false);
  }, [showGuided, showImport]);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            paddingHorizontal: sizes.screenGutter,
            paddingBottom: spacing[2],
            paddingTop: spacing[3],
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('common:actions.back')}
            style={{
              width: 44,
              height: 44,
              borderRadius: radii.control,
              backgroundColor: theme.colors.surfaceRaised,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color={theme.colors.textSecondary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>{t('header.title').toUpperCase()}</MonoLabel>
          </View>
          <Pressable
            onPress={() => setShowAssessmentActions(true)}
            accessibilityRole="button"
            accessibilityLabel={t('assessment:accessibility.addAssessment')}
            hitSlop={4}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: radii.control,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.accentHi : theme.colors.accent,
              borderWidth: 1,
              borderColor: theme.colors.accentHi,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <Icon name="plus" size={20} color={theme.colors.text} stroke={2.2} />
          </Pressable>
        </View>

        {error ? (
          <View style={{ paddingHorizontal: 22, paddingTop: 40, alignItems: 'center' }}>
            <Icon name="alert-triangle" size={26} color={theme.colors.danger} />
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 14, color: theme.colors.textPrimary, marginTop: 10 }}>
              {t('errors.loadFailedTitle')}
            </Text>
            <Text
              style={{
                fontFamily: theme.fonts.ui,
                fontSize: 12.5,
                color: theme.colors.textMuted,
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              {t('errors.loadFailedMessage')}
            </Text>
            <Pressable
              onPress={() => refresh()}
              style={{
                marginTop: 16,
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: theme.colors.primarySoft,
                borderWidth: 1,
                borderColor: theme.colors.primaryBorderMuted,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 12.5, color: theme.colors.primaryEmphasis }}>
                {t('errors.retry').toUpperCase()}
              </Text>
            </Pressable>
          </View>
        ) : loading && !hasAssessments ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.primaryEmphasis} />
            <Text style={{ marginTop: 10, fontFamily: theme.fonts.ui, color: theme.colors.textMuted }}>
              {t('assessment:loading.title')}
            </Text>
          </View>
        ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing[10] }} showsVerticalScrollIndicator={false}>
          {hasAssessments ? (
          <>
          {/* ESTADO ATUAL */}
          <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
            <PhysicalAssessmentSummaryCard
              weight={latest?.weight ?? null}
              bodyFat={latest?.bodyFat ?? null}
              leanMass={latest?.leanMass ?? null}
              bmi={latest?.bmi ?? null}
              lastDateLabel={
                hasAssessments
                  ? formatAssessmentDate(latest!.measuredAt, todayLabel, i18n.language)
                  : t('assessment:summary.noRecords')
              }
            />
          </View>

          {/* EVOLUÇÃO — conectada ao snapshot, sem bloco intermediário de ações. */}
          <AssessmentSection title={t('assessment:sections.evolution').toUpperCase()}>
            <AssessmentEvolutionCard
              hasPrevious={!!evolutionSincePrevious}
              weightPoints={weightPoints}
              bodyFatPoints={bodyFatPoints}
              weightDelta={evolutionSincePrevious?.weightDelta ?? 0}
              bodyFatDelta={evolutionSincePrevious?.bodyFatDelta ?? null}
              leanMassDelta={evolutionSincePrevious?.leanMassDelta ?? null}
              onViewHistory={() => setShowHistoryModal(true)}
            />
          </AssessmentSection>
          </>
          ) : null}

          {/* HISTÓRICO */}
          <AssessmentSection
            title={t('assessment:sections.history').toUpperCase()}
            style={{ paddingTop: hasAssessments ? spacing[8] : spacing[5] }}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
                <MonoLabel size={9}>
                  {t('assessment:history.records', { count: assessments.length }).toUpperCase()}
                </MonoLabel>
                {hasAssessments ? (
                  <Pressable
                    onPress={() => setShowAssessmentActions(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t('assessment:accessibility.addAssessment')}
                    hitSlop={4}
                    style={({ pressed }) => ({
                      width: 44,
                      height: 44,
                      borderRadius: radii.control,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <Icon name="plus" size={20} color={theme.colors.accentHi} stroke={2.2} />
                  </Pressable>
                ) : null}
              </View>
            }
          >
            {assessments.length === 0 ? (
              <Card style={{ padding: spacing[8], alignItems: 'center' }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: radii.lg,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="chart" size={22} color={theme.colors.accentHi} />
                </View>
                <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.text, marginTop: spacing[4] }}>
                  {t('history.empty.title')}
                </Text>
                <Text
                  style={{
                    fontFamily: theme.fonts.ui,
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: theme.colors.mute,
                    marginTop: spacing[1.5],
                    textAlign: 'center',
                  }}
                >
                  {t('history.empty.message')}
                </Text>
                <Pressable
                  onPress={() => setShowAssessmentActions(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('assessment:accessibility.addFirstAssessment')}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    marginTop: spacing[6],
                    paddingHorizontal: spacing[5],
                    borderRadius: radii.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: spacing[2],
                    backgroundColor: pressed ? theme.colors.accentHi : theme.colors.accent,
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <Icon name="plus" size={18} color={theme.colors.text} stroke={2.2} />
                  <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.text }}>
                    {t('assessment:actions.firstAssessment')}
                  </Text>
                </Pressable>
              </Card>
            ) : (
              <>
                <AssessmentHistoryCard
                  entries={visibleHistoryRows}
                  expandedId={expandedHistoryId}
                  onToggle={(id) => setExpandedHistoryId((cur) => (cur === id ? null : id))}
                />
                {historyRows.length > 3 && (
                  <Pressable
                    onPress={() => setShowHistoryModal(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t('assessment:accessibility.viewHistory')}
                    style={{ alignItems: 'center', paddingVertical: 10 }}
                  >
                    <Text
                      style={{
                        fontFamily: theme.fonts.mono,
                        fontSize: 11,
                        letterSpacing: 1,
                        color: theme.colors.primaryEmphasis,
                      }}
                    >
                      {t('history.toggle.showAll').toUpperCase()}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </AssessmentSection>
        </ScrollView>
        )}
      </SafeAreaView>

      <AssessmentActionCard
        visible={showAssessmentActions}
        onClose={() => setShowAssessmentActions(false)}
        onGuided={() => setShowGuided(true)}
        onImport={() => setShowImport(true)}
      />

      <AssessmentHistoryModal
        visible={showHistoryModal}
        entries={historyRows}
        expandedId={expandedHistoryId}
        onToggle={(id) => setExpandedHistoryId((cur) => (cur === id ? null : id))}
        onClose={() => setShowHistoryModal(false)}
      />

      {showGuided && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 }}>
          <GuidedAssessmentModal
            onBack={() => setShowGuided(false)}
            onSave={saveGuided}
            defaultWeight={displayWeight}
            defaultHeight={registeredHeight}
            defaultSex={defaultSex}
            birthDate={birthDate}
          />
        </View>
      )}

      {showImport && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 }}>
          <ImportAssessmentModal
            onBack={() => setShowImport(false)}
            onSave={saveImported}
            defaultWeight={displayWeight}
            defaultHeight={registeredHeight}
          />
        </View>
      )}
    </ScreenBg>
  );
}

function MeasureField({
  label,
  unit,
  value,
  onChange,
  error,
  small,
  shakeX,
  placeholder,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  small?: boolean;
  shakeX?: Animated.Value;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const { theme } = useTheme();
  // IMPORTANT: never define the wrapper as a local component (e.g.
  // `const Wrapper = shakeX ? (props) => <Animated.View .../> : ...`).
  // That expression creates a brand-new function identity on every render,
  // and React treats a changed component identity as a different type at
  // that tree position — it unmounts and remounts the subtree (including
  // this TextInput) on every keystroke, which drops focus and dismisses the
  // keyboard after each character. Returning JSX conditionally instead keeps
  // stable component references (Animated.View/View themselves never change).
  const content = (
    <>
      <MonoLabel color={error ? theme.colors.inputBorderError : theme.colors.textFaint} style={{ marginBottom: 6 }}>
        {label}
      </MonoLabel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: small ? 10 : 13,
          paddingHorizontal: small ? 12 : 14,
          borderRadius: 12,
          backgroundColor: theme.colors.inputBackgroundSubtle,
          borderWidth: 1,
          borderColor: error
            ? theme.colors.inputBorderError
            : focused
              ? theme.colors.inputBorderFocusStrong
              : theme.colors.inputBorderSubtle,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.textFaint}
          selectionColor={theme.colors.primaryEmphasis}
          keyboardType="decimal-pad"
          style={{
            flex: 1,
            minWidth: 0,
            color: theme.colors.inputText,
            fontFamily: theme.fonts.display,
            fontSize: small ? 18 : 22,
            padding: 0,
          }}
        />
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.textFaint }}>{unit}</Text>
      </View>
    </>
  );

  if (shakeX) {
    return (
      <Animated.View style={{ flex: small ? undefined : 1, transform: [{ translateX: shakeX }] }}>
        {content}
      </Animated.View>
    );
  }
  return <View style={{ flex: small ? undefined : 1 }}>{content}</View>;
}

/**
 * `measuredAt` field state for both modals — thin wrapper around the shared
 * `useDateParts` adding the "not in the future" / "is it today" semantics
 * specific to logging an assessment (as opposed to picking a birth date).
 */
function useMeasuredAtFields() {
  const today = useMemo(() => new Date(), []);
  const fields = useDateParts(today);

  const isFuture = fields.date != null && isFutureDate(fields.date);
  const isValid = fields.date != null && !isFuture;
  const isToday = fields.date != null && isSameCalendarDay(fields.date, today);

  return { ...fields, date: isValid ? fields.date : null, isValid, isToday };
}

function Spinner() {
  const { theme } = useTheme();
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [rot]);
  return (
    <Animated.View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.choiceIndex,
        borderTopColor: theme.colors.choiceIndicator,
        transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}
    />
  );
}

/** success = write + refresh both OK · warning = write OK but the screen didn't refresh · error = the write itself failed. */
type ToastTone = 'success' | 'warning' | 'error';

const TOAST_TONE_ICON: Record<ToastTone, 'check' | 'alert-triangle'> = {
  success: 'check',
  warning: 'alert-triangle',
  error: 'alert-triangle',
};

function Toast({
  opacity,
  y,
  tone,
  title,
  subtitle,
}: {
  opacity: Animated.Value;
  y: Animated.Value;
  tone: ToastTone;
  title: string;
  subtitle: string;
}) {
  const { theme } = useTheme();
  const accent =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.toastWarning
        : theme.colors.danger;
  const accentBorder =
    tone === 'success'
      ? theme.colors.toastSuccessBorder
      : tone === 'warning'
        ? theme.colors.toastWarningBorder
        : theme.colors.toastErrorBorder;
  const icon = TOAST_TONE_ICON[tone];
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top: 70,
        left: 22,
        right: 22,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: theme.colors.toastBackground,
        borderWidth: 1,
        borderColor: accentBorder,
        shadowColor: accent,
        shadowOpacity: 0.25,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 0 },
        elevation: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity,
        transform: [{ translateY: y }],
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={16} color={theme.colors.statusForeground} stroke={2.6} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: theme.fonts.uiBold, color: theme.colors.textPrimary }}>{title}</Text>
        <Text style={{ fontSize: 11.5, color: theme.colors.textMuted, marginTop: 2, fontFamily: theme.fonts.ui }}>
          {subtitle}
        </Text>
      </View>
    </Animated.View>
  );
}

type ToastContent = { tone: ToastTone; title: string; subtitle: string };

function useToast() {
  const [content, setContent] = useState<ToastContent | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(-40)).current;
  useEffect(() => {
    if (!content) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(y, { toValue: -40, duration: 250, useNativeDriver: true }),
      ]).start();
      setContent(null);
    }, 2800);
    return () => clearTimeout(t);
  }, [content, opacity, y]);
  return { content, show: (c: ToastContent) => setContent(c), opacity, y };
}

function ModalHeader({ onBack, title }: { onBack: () => void; title: string }) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View
      style={{
        width: '100%',
        maxWidth: sizes.contentMaxWidth,
        alignSelf: 'center',
        paddingHorizontal: sizes.screenGutter,
        paddingTop: spacing[3],
        paddingBottom: spacing[2],
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t('actions.back')}
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: theme.colors.controlBackground,
          borderWidth: 1,
          borderColor: theme.colors.controlBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="arrow-left" size={17} color={theme.colors.iconStrong} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel>{title}</MonoLabel>
      </View>
      <View style={{ width: 44 }} />
    </View>
  );
}

function AssessmentFormIntro({
  icon,
  title,
  description,
}: {
  icon: 'ruler' | 'download';
  title: string;
  description: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: '100%',
        maxWidth: sizes.contentMaxWidth,
        alignSelf: 'center',
        paddingHorizontal: sizes.screenGutter,
        paddingTop: spacing[5],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radii.md,
            backgroundColor: theme.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={18} color={theme.colors.primaryEmphasis} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 17, color: theme.colors.textPrimary }}>
            {title}
          </Text>
          <Text
            style={{
              marginTop: spacing[1],
              fontFamily: theme.fonts.ui,
              fontSize: 12.5,
              lineHeight: 18,
              color: theme.colors.textMuted,
            }}
          >
            {description}
          </Text>
        </View>
      </View>
    </View>
  );
}

function AssessmentFormSection({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: '100%',
        maxWidth: sizes.contentMaxWidth,
        alignSelf: 'center',
        paddingHorizontal: sizes.screenGutter,
        paddingTop: spacing[8],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[2],
          marginBottom: spacing[3],
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.monoBold,
            fontSize: 10,
            letterSpacing: 2,
            color: theme.colors.primaryEmphasis,
          }}
        >
          {String(index).padStart(2, '0')}
        </Text>
        <Slash>{title}</Slash>
      </View>
      {children}
    </View>
  );
}

function FormDivider() {
  const { theme } = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: spacing[4] }} />;
}

function AssessmentSaveFooter({
  onPress,
  saving,
  canSave,
  shake,
  shakeX,
  accessibilityLabel,
  savingLabel,
  actionLabel,
  validationLabel,
}: {
  onPress: () => void;
  saving: boolean;
  canSave: boolean;
  shake: boolean;
  shakeX: Animated.Value;
  accessibilityLabel: string;
  savingLabel: string;
  actionLabel: string;
  validationLabel: string;
}) {
  const { theme } = useTheme();
  return (
    <SafeAreaView
      edges={['bottom']}
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        backgroundColor: theme.colors.background,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      }}
    >
      <Animated.View
        style={{
          width: '100%',
          maxWidth: sizes.contentMaxWidth - sizes.screenGutter * 2,
          alignSelf: 'center',
          transform: [{ translateX: shakeX }],
        }}
      >
        <Pressable
          onPress={onPress}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: saving }}
          style={{ opacity: saving ? 0.75 : canSave ? 1 : 0.68 }}
        >
          <LinearGradient
            colors={theme.gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              height: 54,
              borderRadius: radii.lg,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              shadowColor: theme.colors.primary,
              shadowOpacity: canSave ? 0.3 : 0,
              shadowRadius: canSave ? 18 : 0,
              shadowOffset: { width: 0, height: 6 },
              elevation: canSave ? 6 : 0,
            }}
          >
            {saving ? (
              <>
                <Spinner />
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 17,
                    letterSpacing: 1.5,
                    color: theme.colors.primaryForeground,
                    textTransform: 'uppercase',
                  }}
                >
                  {savingLabel}
                </Text>
              </>
            ) : (
              <>
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 17,
                    letterSpacing: 1.5,
                    color: theme.colors.primaryForeground,
                    textTransform: 'uppercase',
                  }}
                >
                  {actionLabel}
                </Text>
                <Icon name="arrow-right" size={18} color={theme.colors.primaryForeground} />
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
      <View
        style={{
          width: '100%',
          maxWidth: sizes.contentMaxWidth - sizes.screenGutter * 2,
          minHeight: 26,
          alignSelf: 'center',
          justifyContent: 'center',
        }}
      >
        {shake && !canSave && (
          <MonoLabel
            color={shake ? theme.colors.danger : theme.colors.textFaint}
            style={{ textAlign: 'center', marginTop: 8 }}
          >
            {validationLabel.toUpperCase()}
          </MonoLabel>
        )}
      </View>
    </SafeAreaView>
  );
}

function GuidedAssessmentModal({
  onBack,
  onSave,
  defaultWeight,
  defaultHeight,
  defaultSex,
  birthDate,
}: {
  onBack: () => void;
  onSave: (entry: GuidedAssessmentInput) => Promise<SaveOutcome>;
  defaultWeight: number | null;
  defaultHeight: number | null;
  defaultSex: Sex | null;
  /** When known, age is always derived from this — never asked manually (objective 6). */
  birthDate: Date | null;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  const [weight, setWeight] = useState(
    defaultWeight != null
      ? formatWeightInputFromKg(defaultWeight, resolvedUnits)
      : '',
  );
  const sex = defaultSex;
  const measuredAtFields = useMeasuredAtFields();
  const [protocolId, setProtocolId] = useState<SkinfoldProtocolId>('jp7');
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [folds, setFolds] = useState<Partial<Record<SiteKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [shake, setShake] = useState(false);
  const toast = useToast();
  const { canPerform } = usePremiumCapabilities();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Age at the SELECTED measuredAt (not "today"), computed fresh whenever
  // the date changes — this is what makes retroactive guided assessments
  // correct without ever asking the user to do the math themselves. Guarded
  // with isValidAge so a corrupted/future birthDate can never show a
  // negative or nonsensical age — it just becomes "unknown" (—), same as
  // the missing-birthDate case, instead of confusing the user.
  const rawAutoAge = birthDate && measuredAtFields.date ? computeAge(birthDate, measuredAtFields.date) : null;
  const autoAge = rawAutoAge != null && isValidAge(rawAutoAge) ? rawAutoAge : null;
  const a = autoAge ?? NaN;

  const proto = protocolById(protocolId);
  const sites = sex ? proto.sitesFor(sex) : [];
  const displayedWeight = parseDecimalInput(weight);
  const weightKg = weightToKg(displayedWeight, resolvedUnits);
  const heightCm = defaultHeight ?? NaN;
  const bmi = computeBmi(weightKg, heightCm);
  const band =
    bmi != null ? BMI_BANDS.find((b) => bmi < b.max) ?? BMI_BANDS[BMI_BANDS.length - 1] : null;
  const bmiPct = bmi != null ? Math.max(3, Math.min(100, ((bmi - 14) / (38 - 14)) * 100)) : 0;

  const filledSites = sites.filter((s) => folds[s] && parseFloat(folds[s] || '0') > 0).length;

  const numericFolds: Partial<Record<SiteKey, number>> = useMemo(() => {
    const out: Partial<Record<SiteKey, number>> = {};
    sites.forEach((s) => {
      const v = parseFloat(folds[s] || '');
      if (v > 0) out[s] = v;
    });
    return out;
  }, [folds, sites]);

  const bodyFat =
    sex != null ? computeGuidedBodyFat(protocolId, numericFolds, sites, a, sex) : null;
  const leanMass = computeLeanMass(weightKg, bodyFat);
  const fatMass = computeFatMass(weightKg, bodyFat);

  const canSave =
    weightKg > 0 && heightCm > 0 && a > 0 && sex != null && bodyFat != null && measuredAtFields.isValid;

  const shakeX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shake) return;
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setShake(false));
  }, [shake, shakeX]);

  const setFold = (k: SiteKey, v: string) => setFolds((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (saving) return; // guards against double-tap firing two writes
    // FASE 3 (docs/13_assinaturas_e_billing.md): CREATE_ASSESSMENT is a
    // Premium capability — this is the actual write boundary (not just the
    // "Adicionar avaliação" entry point that opens this modal), so it's
    // where the check has to live. Silent no-op on purpose: the definitive
    // Premium UX (message, upsell) belongs to a later phase; this phase only
    // has to stop the mutation from happening for a Free user.
    if (!canPerform('CREATE_ASSESSMENT')) return;
    if (!canSave || bodyFat == null || sex == null || !measuredAtFields.date) {
      setShake(true);
      return;
    }
    setSaving(true);
    try {
      const { refreshFailed } = await onSave({
        measuredAt: measuredAtFields.date,
        weight: weightKg,
        height: heightCm,
        bodyFat,
        protocol: protocolId,
        sex,
        age: a,
        folds: numericFolds,
      });
      // The write already succeeded either way — only the confirmation
      // message changes, never a failure state, so the user never doubts
      // whether it's safe to leave without retrying.
      toast.show(
        refreshFailed
          ? {
              tone: 'warning',
              title: t('success.guidedRefreshTitle'),
              subtitle: t('success.refreshMessage'),
            }
          : {
              tone: 'success',
              title: t('success.guidedTitle'),
              subtitle: t('success.historyMessage'),
            },
      );
      // Saved — leave the form behind (unmounting clears it) and return to
      // Avaliação Física; the brief delay lets the toast above be seen first.
      closeTimer.current = setTimeout(() => onBack(), 1100);
    } catch (err) {
      logError('assessment:save-guided', err);
      setShake(true);
      toast.show({
        tone: 'error',
        title: t('errors.saveFailedTitle'),
        subtitle: classifyAssessmentError(err) === 'unexpected'
          ? t('errors.saveFailedMessage')
          : t(`errors.save.${classifyAssessmentError(err)}`),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <ModalHeader onBack={onBack} title={t('guided.title').toUpperCase()} />
          <AssessmentFormIntro
            icon="ruler"
            title={t('actions.guided.title')}
            description={t('actions.guided.description')}
          />

          {/* INFORMAÇÕES BÁSICAS */}
          <AssessmentFormSection index={1} title={t('guided.basicInfoSection').toUpperCase()}>
            <Card style={{ padding: spacing[4] }}>
              <NativeDatePickerField
                label={t('fields.measurementDate.label').toUpperCase()}
                value={measuredAtFields.date ?? new Date()}
                onChange={measuredAtFields.setDate}
                maximumDate={new Date()}
                error={shake && !measuredAtFields.isValid}
              />
              <FormDivider />
              <MeasureField
                label={t('fields.weight.label').toUpperCase()}
                unit={massUnit}
                placeholder={t('form.numericPlaceholder')}
                value={weight}
                onChange={(value) => setWeight(normalizeDecimalInput(value, 2))}
                error={shake && !(displayedWeight > 0)}
                shakeX={shakeX}
              />
            </Card>
          </AssessmentFormSection>

          {/* DOBRAS CUTÂNEAS */}
          <AssessmentFormSection index={2} title={t('sections.skinfolds').toUpperCase()}>
            <Card style={{ padding: spacing[4], overflow: 'visible' }}>
            <View style={{ position: 'relative', zIndex: 5 }}>
              <Pressable
                onPress={() => setProtocolOpen((o) => !o)}
                accessibilityRole="button"
                accessibilityLabel={t('accessibility.selectProtocol')}
                accessibilityState={{ expanded: protocolOpen }}
                style={{
                  paddingVertical: 16,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: theme.colors.surfaceSelected,
                  borderWidth: 1,
                  borderColor: theme.colors.primaryBorderMuted,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      backgroundColor: theme.colors.primarySurfaceStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="target" size={18} color={theme.colors.primaryEmphasis} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MonoLabel style={{ marginBottom: 4 }}>
                      {t('guided.protocolLabel').toUpperCase()}
                    </MonoLabel>
                    <Text style={{ fontSize: 15, fontFamily: theme.fonts.uiBold, color: theme.colors.textPrimary }}>
                      {t(PROTOCOL_TRANSLATION_KEYS[proto.id])}
                    </Text>
                  </View>
                </View>
                <View style={{ transform: [{ rotate: protocolOpen ? '180deg' : '0deg' }] }}>
                  <Icon name="chevron-down" size={18} color={theme.colors.primaryEmphasis} stroke={2} />
                </View>
              </Pressable>

              {protocolOpen && (
                <View
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 6,
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: theme.colors.floatingSurface,
                    borderWidth: 1,
                    borderColor: theme.colors.primaryBorderMuted,
                    shadowColor: theme.colors.floatingShadow,
                    shadowOpacity: 0.5,
                    shadowRadius: 25,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 12,
                  }}
                >
                  {SKINFOLD_PROTOCOLS.map((p, i) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setProtocolId(p.id);
                        setProtocolOpen(false);
                        setFolds({});
                      }}
                      style={{
                        paddingVertical: 13,
                        paddingHorizontal: 16,
                        backgroundColor: protocolId === p.id
                          ? theme.colors.choiceSelectedBackground
                          : 'transparent',
                        borderTopWidth: i ? 1 : 0,
                        borderTopColor: theme.colors.sheetDivider,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text style={{ fontSize: 13.5, fontFamily: theme.fonts.uiSemi, color: theme.colors.textPrimary }}>
                        {t(PROTOCOL_TRANSLATION_KEYS[p.id])}
                      </Text>
                      {protocolId === p.id && <Icon name="check" size={14} color={theme.colors.primaryEmphasis} />}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {sex != null && (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 14,
                    marginBottom: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <SegBar value={filledSites / sites.length} segs={sites.length} />
                  </View>
                  <MonoLabel>
                    {filledSites}/{sites.length}
                  </MonoLabel>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    rowGap: spacing[3],
                  }}
                >
                  {sites.map((s) => (
                    <View key={s} style={{ width: '48%' }}>
                      <MeasureField
                        label={t(SITE_TRANSLATION_KEYS[s]).toUpperCase()}
                        unit={t('units.mm')}
                        placeholder={t('form.numericPlaceholder')}
                        small
                        value={folds[s] || ''}
                        onChange={(v) => setFold(s, v)}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}
            </Card>
          </AssessmentFormSection>

          <View
            style={{
              width: '100%',
              maxWidth: sizes.contentMaxWidth,
              alignSelf: 'center',
              paddingHorizontal: sizes.screenGutter,
              paddingTop: spacing[8],
            }}
          >
            <Card style={{ padding: spacing[4] }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <MonoLabel>{t('results.automaticBmi').toUpperCase()}</MonoLabel>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text
                    style={{
                      fontFamily: theme.fonts.display,
                      fontSize: 26,
                      color: '#fff',
                      transform: [{ skewX: '-8deg' }],
                    }}
                  >
                    {bmi != null ? bmi.toFixed(1) : '—'}
                  </Text>
                  {band && (
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: band.c,
                      }}
                    >
                      <Text
                        style={{ fontFamily: theme.fonts.monoBold, fontSize: 9, letterSpacing: 0.8, color: theme.colors.statusForeground }}
                      >
                        {t(`classifications.bmi.${band.classification}`).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View
                style={{
                  position: 'relative',
                  height: 8,
                  borderRadius: 6,
                  backgroundColor: 'rgba(255,255,255,0.07)',
                  overflow: 'visible',
                }}
              >
                <LinearGradient
                  colors={['#4da3ff', '#22c55e', '#f5a623', '#f0563f']}
                  locations={[0, 0.33, 0.66, 1]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 6,
                    opacity: 0.4,
                  }}
                />
                {bmi != null && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      left: `${bmiPct}%`,
                      width: 3,
                      height: 14,
                      backgroundColor: '#fff',
                      marginLeft: -1.5,
                      shadowColor: '#fff',
                      shadowOpacity: 0.8,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 4,
                    }}
                  />
                )}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginTop: 10,
                  paddingHorizontal: 2,
                }}
              >
                {['18.5', '25', '30'].map((t) => (
                  <MonoLabel key={t}>{t}</MonoLabel>
                ))}
              </View>
            </Card>
          </View>

          {/* RESULTADOS */}
          <AssessmentFormSection index={3} title={t('results.title').toUpperCase()}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <AssessmentMetricCard
                label={t('metrics.bodyFat').toUpperCase()}
                value={bodyFat != null ? bodyFat.toFixed(1).replace('.', ',') : '—'}
                unit={t('units.percent')}
                icon="flame"
                style={{ width: '48.5%' }}
              />
              <AssessmentMetricCard
                label={t('metrics.leanMass').toUpperCase()}
                value={
                  leanMass != null
                    ? formatWeightFromKg(leanMass, resolvedUnits).replace('.', ',')
                    : '—'
                }
                unit={massUnit}
                icon="dumbbell"
                style={{ width: '48.5%' }}
              />
              <AssessmentMetricCard
                label={t('metrics.fatMass').toUpperCase()}
                value={
                  fatMass != null
                    ? formatWeightFromKg(fatMass, resolvedUnits).replace('.', ',')
                    : '—'
                }
                unit={massUnit}
                icon="target"
                style={{ width: '48.5%' }}
              />
              <AssessmentMetricCard
                label={t('metrics.bmi').toUpperCase()}
                value={bmi != null ? bmi.toFixed(1) : '—'}
                unit=""
                icon="chart"
                style={{ width: '48.5%' }}
              />
            </View>
          </AssessmentFormSection>

        </ScrollView>

        <AssessmentSaveFooter
          onPress={handleSave}
          saving={saving}
          canSave={canSave}
          shake={shake}
          shakeX={shakeX}
          accessibilityLabel={t('accessibility.saveGuided')}
          savingLabel={t('guided.saving')}
          actionLabel={t('actions.saveGuided')}
          validationLabel={t(
            sex == null || birthDate == null || !(heightCm > 0)
              ? 'validation.profileRequired'
              : 'validation.guidedRequired',
          )}
        />

        {toast.content && (
          <Toast opacity={toast.opacity} y={toast.y} tone={toast.content.tone} title={toast.content.title} subtitle={toast.content.subtitle} />
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

function ImportAssessmentModal({
  onBack,
  onSave,
  defaultWeight,
  defaultHeight,
}: {
  onBack: () => void;
  onSave: (entry: ImportedAssessmentInput) => Promise<SaveOutcome>;
  defaultWeight: number | null;
  defaultHeight: number | null;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  const [weight, setWeight] = useState(
    defaultWeight != null
      ? formatWeightInputFromKg(defaultWeight, resolvedUnits)
      : '',
  );
  const measuredAtFields = useMeasuredAtFields();
  const [bodyFat, setBodyFat] = useState('');
  const [bodyWater, setBodyWater] = useState('');
  const [basalMetabolism, setBasalMetabolism] = useState('');
  const [visceralFat, setVisceralFat] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [shake, setShake] = useState(false);
  const toast = useToast();
  const { canPerform } = usePremiumCapabilities();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const displayedWeight = parseDecimalInput(weight);
  const weightKg = weightToKg(displayedWeight, resolvedUnits);
  const heightCm = defaultHeight ?? NaN;
  const canSave = weightKg > 0 && heightCm > 0 && measuredAtFields.isValid;

  const shakeX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shake) return;
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setShake(false));
  }, [shake, shakeX]);

  function parsePositive(v: string) {
    const n = parseFloat(v);
    return n > 0 ? n : undefined;
  }

  const handleSave = async () => {
    if (saving) return; // guards against double-tap firing two writes
    // FASE 3: same CREATE_ASSESSMENT boundary as the guided flow above —
    // imported and guided assessments are two entry points into the same
    // capability, both gated at their actual write call.
    if (!canPerform('CREATE_ASSESSMENT')) return;
    if (!canSave || !measuredAtFields.date) {
      setShake(true);
      return;
    }
    setSaving(true);
    try {
      const { refreshFailed } = await onSave({
        measuredAt: measuredAtFields.date,
        weight: weightKg,
        height: heightCm,
        bodyFat: parsePositive(bodyFat) ?? null,
        bodyWater: parsePositive(bodyWater),
        basalMetabolism: parsePositive(basalMetabolism),
        visceralFat: parsePositive(visceralFat),
        notes: notes.trim() || undefined,
      });
      toast.show(
        refreshFailed
          ? {
              tone: 'warning',
              title: t('success.importedRefreshTitle'),
              subtitle: t('success.refreshMessage'),
            }
          : {
              tone: 'success',
              title: t('success.importedTitle'),
              subtitle: t('success.historyMessage'),
            },
      );
      // Saved — leave the form behind (unmounting clears it) and return to
      // Avaliação Física; the brief delay lets the toast above be seen first.
      closeTimer.current = setTimeout(() => onBack(), 1100);
    } catch (err) {
      logError('assessment:save-imported', err);
      setShake(true);
      toast.show({
        tone: 'error',
        title: t('errors.saveFailedTitle'),
        subtitle: classifyAssessmentError(err) === 'unexpected'
          ? t('errors.saveFailedMessage')
          : t(`errors.save.${classifyAssessmentError(err)}`),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <ModalHeader onBack={onBack} title={t('import.title').toUpperCase()} />
          <AssessmentFormIntro
            icon="download"
            title={t('actions.import.title')}
            description={t('import.description')}
          />

          <AssessmentFormSection index={1} title={t('import.basicInfoSection').toUpperCase()}>
            <Card style={{ padding: spacing[4] }}>
              <NativeDatePickerField
                label={t('fields.measurementDate.label').toUpperCase()}
                value={measuredAtFields.date ?? new Date()}
                onChange={measuredAtFields.setDate}
                maximumDate={new Date()}
                error={shake && !measuredAtFields.isValid}
              />
              <FormDivider />
              <MeasureField
                label={t('fields.weight.label').toUpperCase()}
                unit={massUnit}
                placeholder={t('form.numericPlaceholder')}
                value={weight}
                onChange={(value) => setWeight(normalizeDecimalInput(value, 2))}
                error={shake && !(displayedWeight > 0)}
                shakeX={shakeX}
              />
            </Card>
          </AssessmentFormSection>

          <AssessmentFormSection index={2} title={t('import.resultsSection').toUpperCase()}>
            <Card style={{ padding: spacing[4] }}>
              <View style={{ flexDirection: 'row', gap: spacing[3] }}>
                <MeasureField label={t('fields.bodyFat.label').toUpperCase()} unit={t('units.percent')} placeholder={t('form.numericPlaceholder')} value={bodyFat} onChange={setBodyFat} />
                <MeasureField label={t('fields.bodyWater.label').toUpperCase()} unit={t('units.percent')} placeholder={t('form.numericPlaceholder')} value={bodyWater} onChange={setBodyWater} />
              </View>
              <FormDivider />
              <View style={{ flexDirection: 'row', gap: spacing[3] }}>
                <MeasureField
                  label={t('fields.basalMetabolism.label').toUpperCase()}
                  unit={t('units.kcal')}
                  placeholder={t('form.numericPlaceholder')}
                  value={basalMetabolism}
                  onChange={setBasalMetabolism}
                />
                <MeasureField label={t('fields.visceralFat.label').toUpperCase()} unit="" placeholder={t('form.numericPlaceholder')} value={visceralFat} onChange={setVisceralFat} />
              </View>
              <FormDivider />
              <MonoLabel color={theme.colors.textFaint} style={{ marginBottom: spacing[2] }}>
                {t('fields.notes.label').toUpperCase()}
              </MonoLabel>
              <View
                style={{
                  minHeight: 52,
                  paddingHorizontal: spacing[4],
                  borderRadius: radii.lg,
                  backgroundColor: theme.colors.inputBackgroundSubtle,
                  borderWidth: 1,
                  borderColor: theme.colors.inputBorderSubtle,
                  justifyContent: 'center',
                }}
              >
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={t('fields.notes.placeholder')}
                  accessibilityLabel={t('fields.notes.label')}
                  placeholderTextColor={theme.colors.textFaint}
                  selectionColor={theme.colors.primaryEmphasis}
                  style={{ color: theme.colors.inputText, fontFamily: theme.fonts.uiMed, fontSize: 14, padding: 0 }}
                />
              </View>
            </Card>
          </AssessmentFormSection>

        </ScrollView>

        <AssessmentSaveFooter
          onPress={handleSave}
          saving={saving}
          canSave={canSave}
          shake={shake}
          shakeX={shakeX}
          accessibilityLabel={t('accessibility.saveImported')}
          savingLabel={t('import.saving')}
          actionLabel={t('actions.registerImported')}
          validationLabel={t(
            heightCm > 0 ? 'validation.importRequired' : 'validation.heightRequired',
          )}
        />

        {toast.content && (
          <Toast opacity={toast.opacity} y={toast.y} tone={toast.content.tone} title={toast.content.title} subtitle={toast.content.subtitle} />
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

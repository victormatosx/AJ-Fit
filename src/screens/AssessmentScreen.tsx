import { useEffect, useMemo, useRef, useState } from 'react';
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
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';
import { useAssessments, type SaveOutcome } from '../hooks/useAssessments';
import type { GuidedAssessmentInput, ImportedAssessmentInput } from '../services/assessments';
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

  const [showGuided, setShowGuided] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
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
    source: a.source,
    protocolLabel:
      a.source === 'guided'
        ? t(`assessment:${PROTOCOL_TRANSLATION_KEYS[a.protocol]}`)
        : undefined,
  }));
  const visibleHistoryRows = showFullHistory ? historyRows : historyRows.slice(0, 3);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingBottom: 8,
            paddingTop: 12,
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
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color="rgba(255,255,255,0.8)" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>{t('header.title').toUpperCase()}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {error ? (
          <View style={{ paddingHorizontal: 22, paddingTop: 40, alignItems: 'center' }}>
            <Icon name="alert-triangle" size={26} color="#f0563f" />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff', marginTop: 10 }}>
              {t('errors.loadFailedTitle')}
            </Text>
            <Text
              style={{
                fontFamily: fonts.ui,
                fontSize: 12.5,
                color: colors.mute,
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
                backgroundColor: 'rgba(11,112,249,0.16)',
                borderWidth: 1,
                borderColor: 'rgba(11,112,249,0.4)',
              }}
            >
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accentHi }}>
                {t('errors.retry').toUpperCase()}
              </Text>
            </Pressable>
          </View>
        ) : loading && !hasAssessments ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accentHi} />
            <Text style={{ marginTop: 10, fontFamily: fonts.ui, color: colors.mute }}>
              {t('assessment:loading.title')}
            </Text>
          </View>
        ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* RESUMO */}
          <View style={{ paddingHorizontal: 22, paddingTop: 10 }}>
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

          {/* EVOLUÇÃO */}
          <AssessmentSection title={t('assessment:sections.evolution').toUpperCase()}>
            <AssessmentEvolutionCard
              hasPrevious={!!evolutionSincePrevious}
              weightPoints={weightPoints}
              bodyFatPoints={bodyFatPoints}
              weightDelta={evolutionSincePrevious?.weightDelta ?? 0}
              bodyFatDelta={evolutionSincePrevious?.bodyFatDelta ?? null}
              leanMassDelta={evolutionSincePrevious?.leanMassDelta ?? null}
              onViewHistory={() => setShowFullHistory(true)}
            />
          </AssessmentSection>

          {/* ADICIONAR AVALIAÇÃO */}
          <AssessmentSection
            title={t('assessment:sections.add').toUpperCase()}
            style={{ paddingTop: 22 }}
          >
            <AssessmentActionCard
              onGuided={() => setShowGuided(true)}
              onImport={() => setShowImport(true)}
            />
          </AssessmentSection>

          {/* HISTÓRICO */}
          <AssessmentSection
            title={t('assessment:sections.history').toUpperCase()}
            right={<MonoLabel>{t('assessment:history.records', { count: assessments.length }).toUpperCase()}</MonoLabel>}
          >
            {assessments.length === 0 ? (
              <Card style={{ padding: 32, alignItems: 'center' }}>
                <Icon name="chart" size={26} color="rgba(255,255,255,0.25)" />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff', marginTop: 10 }}>
                  {t('history.empty.title')}
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.ui,
                    fontSize: 12.5,
                    color: colors.mute,
                    marginTop: 4,
                    textAlign: 'center',
                  }}
                >
                  {t('history.empty.message')}
                </Text>
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
                    onPress={() => setShowFullHistory((v) => !v)}
                    style={{ alignItems: 'center', paddingVertical: 10 }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.mono,
                        fontSize: 11,
                        letterSpacing: 1,
                        color: colors.accentHi,
                      }}
                    >
                      {(showFullHistory
                        ? t('history.toggle.showLess')
                        : t('history.toggle.showAll')
                      ).toUpperCase()}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </AssessmentSection>
        </ScrollView>
        )}
      </SafeAreaView>

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
      <MonoLabel color={error ? '#f0563f' : colors.faint} style={{ marginBottom: 6 }}>
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
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderWidth: 1,
          borderColor: error ? '#f0563f' : 'rgba(255,255,255,0.09)',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          accessibilityLabel={label}
          placeholderTextColor={colors.faint}
          keyboardType="decimal-pad"
          style={{
            flex: 1,
            minWidth: 0,
            color: '#fff',
            fontFamily: fonts.display,
            fontSize: small ? 18 : 22,
            padding: 0,
          }}
        />
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.faint }}>{unit}</Text>
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
        borderColor: 'rgba(255,255,255,0.35)',
        borderTopColor: '#fff',
        transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}
    />
  );
}

/** success = write + refresh both OK · warning = write OK but the screen didn't refresh · error = the write itself failed. */
type ToastTone = 'success' | 'warning' | 'error';

const TOAST_TONE_STYLE: Record<ToastTone, { accent: string; icon: 'check' | 'alert-triangle' }> = {
  success: { accent: '#22c55e', icon: 'check' },
  warning: { accent: '#f5a623', icon: 'alert-triangle' },
  error: { accent: '#f0563f', icon: 'alert-triangle' },
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
  const { accent, icon } = TOAST_TONE_STYLE[tone];
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
        backgroundColor: 'rgba(8,10,30,0.94)',
        borderWidth: 1,
        borderColor: `${accent}66`,
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
        <Icon name={icon} size={16} color="#020010" stroke={2.6} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: fonts.uiBold, color: '#fff' }}>{title}</Text>
        <Text style={{ fontSize: 11.5, color: colors.mute, marginTop: 2, fontFamily: fonts.ui }}>
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
  const { t } = useTranslation('common');
  return (
    <View
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        paddingBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
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
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.09)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="arrow-left" size={17} color="rgba(255,255,255,0.8)" />
      </Pressable>
      <Slash>{title}</Slash>
    </View>
  );
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
  return (
    <SafeAreaView
      edges={['bottom']}
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        backgroundColor: colors.bg,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
        <Pressable
          onPress={onPress}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: saving }}
          style={{ opacity: saving ? 0.75 : 1 }}
        >
          <LinearGradient
            colors={['#1f82ff', colors.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              height: 58,
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              borderBottomLeftRadius: 12,
              borderBottomRightRadius: 0,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              shadowColor: colors.accent,
              shadowOpacity: 0.45,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
          >
            {saving ? (
              <>
                <Spinner />
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 17,
                    letterSpacing: 1.5,
                    color: '#fff',
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
                    fontFamily: fonts.display,
                    fontSize: 17,
                    letterSpacing: 1.5,
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}
                >
                  {actionLabel}
                </Text>
                <Icon name="arrow-right" size={18} color="#fff" />
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
      <View style={{ minHeight: 26, justifyContent: 'center' }}>
        {!canSave && (
          <MonoLabel
            color={shake ? colors.danger : colors.faint}
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
  const displayedWeight = parseFloat(weight);
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
        subtitle: t('errors.saveFailedMessage'),
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

          {/* INFORMAÇÕES BÁSICAS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
            <Slash style={{ marginBottom: 12 }}>{t('guided.basicInfoSection').toUpperCase()}</Slash>

            <View style={{ marginBottom: 16 }}>
              <NativeDatePickerField
                label={t('fields.measurementDate.label').toUpperCase()}
                value={measuredAtFields.date ?? new Date()}
                onChange={measuredAtFields.setDate}
                maximumDate={new Date()}
                error={shake && !measuredAtFields.isValid}
              />
            </View>

            <View style={{ marginBottom: 10 }}>
              <MeasureField
                label={t('fields.weight.label').toUpperCase()}
                unit={massUnit}
                placeholder={t('form.numericPlaceholder')}
                value={weight}
                onChange={setWeight}
                error={shake && !(displayedWeight > 0)}
                shakeX={shakeX}
              />
            </View>
            <Card style={{ padding: 16, marginTop: 12 }}>
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
                      fontFamily: fonts.display,
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
                        style={{ fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.8, color: '#020010' }}
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

          {/* DOBRAS CUTÂNEAS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Slash style={{ marginBottom: 12 }}>{t('sections.skinfolds').toUpperCase()}</Slash>

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
                  backgroundColor: colors.surfaceSelected,
                  borderWidth: 1,
                  borderColor: 'rgba(11,112,249,0.40)',
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
                      backgroundColor: 'rgba(11,112,249,0.22)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="target" size={18} color={colors.accentHi} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MonoLabel style={{ marginBottom: 4 }}>
                      {t('guided.protocolLabel').toUpperCase()}
                    </MonoLabel>
                    <Text style={{ fontSize: 15, fontFamily: fonts.uiBold, color: '#fff' }}>
                      {t(PROTOCOL_TRANSLATION_KEYS[proto.id])}
                    </Text>
                  </View>
                </View>
                <View style={{ transform: [{ rotate: protocolOpen ? '180deg' : '0deg' }] }}>
                  <Icon name="chevron-down" size={18} color={colors.accentHi} stroke={2} />
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
                    backgroundColor: '#080323',
                    borderWidth: 1,
                    borderColor: 'rgba(11,112,249,0.4)',
                    shadowColor: '#000',
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
                        backgroundColor: protocolId === p.id ? 'rgba(11,112,249,0.16)' : 'transparent',
                        borderTopWidth: i ? 1 : 0,
                        borderTopColor: 'rgba(255,255,255,0.06)',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.uiSemi, color: '#fff' }}>
                        {t(PROTOCOL_TRANSLATION_KEYS[p.id])}
                      </Text>
                      {protocolId === p.id && <Icon name="check" size={14} color={colors.accentHi} />}
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

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {sites.map((s) => (
                    <View key={s} style={{ width: '48.5%' }}>
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
          </View>

          {/* RESULTADOS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Slash style={{ marginBottom: 12 }}>{t('results.title').toUpperCase()}</Slash>
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
          </View>

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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const displayedWeight = parseFloat(weight);
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
        subtitle: t('errors.saveFailedMessage'),
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

          <View style={{ paddingHorizontal: 22, paddingTop: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 21, color: colors.mute }}>
              {t('import.description')}
            </Text>
          </View>

          <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
            <Slash style={{ marginBottom: 12 }}>{t('import.basicInfoSection').toUpperCase()}</Slash>

            <View style={{ marginBottom: 16 }}>
              <NativeDatePickerField
                label={t('fields.measurementDate.label').toUpperCase()}
                value={measuredAtFields.date ?? new Date()}
                onChange={measuredAtFields.setDate}
                maximumDate={new Date()}
                error={shake && !measuredAtFields.isValid}
              />
            </View>

            <View style={{ marginBottom: 10 }}>
              <MeasureField
                label={t('fields.weight.label').toUpperCase()}
                unit={massUnit}
                placeholder={t('form.numericPlaceholder')}
                value={weight}
                onChange={setWeight}
                error={shake && !(displayedWeight > 0)}
                shakeX={shakeX}
              />
            </View>
          </View>

          <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
            <Slash style={{ marginBottom: 12 }}>{t('import.resultsSection').toUpperCase()}</Slash>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <MeasureField label={t('fields.bodyFat.label').toUpperCase()} unit={t('units.percent')} placeholder={t('form.numericPlaceholder')} value={bodyFat} onChange={setBodyFat} />
              <MeasureField label={t('fields.bodyWater.label').toUpperCase()} unit={t('units.percent')} placeholder={t('form.numericPlaceholder')} value={bodyWater} onChange={setBodyWater} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <MeasureField
                label={t('fields.basalMetabolism.label').toUpperCase()}
                unit={t('units.kcal')}
                placeholder={t('form.numericPlaceholder')}
                value={basalMetabolism}
                onChange={setBasalMetabolism}
              />
              <MeasureField label={t('fields.visceralFat.label').toUpperCase()} unit="" placeholder={t('form.numericPlaceholder')} value={visceralFat} onChange={setVisceralFat} />
            </View>

            <MonoLabel color={colors.faint} style={{ marginBottom: 6 }}>
              {t('fields.notes.label').toUpperCase()}
            </MonoLabel>
            <View
              style={{
                paddingVertical: 13,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.09)',
              }}
            >
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={t('fields.notes.placeholder')}
                accessibilityLabel={t('fields.notes.label')}
                placeholderTextColor={colors.faint}
                style={{ color: '#fff', fontFamily: fonts.ui, fontSize: 13.5, padding: 0 }}
              />
            </View>
          </View>

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

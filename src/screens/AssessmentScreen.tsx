import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Animated, Easing, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { Timestamp } from 'firebase/firestore';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { FoldableSection } from '../components/ui/FoldableSection';
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
  SITE_LABELS,
  SKINFOLD_PROTOCOLS,
  computeBmi,
  computeFatMass,
  computeGuidedBodyFat,
  computeLeanMass,
  isValidAge,
  protocolById,
  protocolLabel as resolveProtocolLabel,
  type Sex,
  type SiteKey,
  type SkinfoldProtocolId,
} from '../lib/skinfoldCalculator';
import { formatDatePt, formatShortDatePt, isFutureDate, isSameCalendarDay } from '../lib/dateUtils';
import { computeAge } from '../lib/ageCalculator';
import { logError } from '../lib/logError';
import { useDateParts } from '../hooks/useDateParts';
import { DateFieldsInput } from '../components/ui/DateFieldsInput';

const BMI_BANDS = [
  { max: 18.5, l: 'ABAIXO DO PESO', c: '#4da3ff' },
  { max: 25, l: 'PESO NORMAL', c: '#22c55e' },
  { max: 30, l: 'SOBREPESO', c: '#f5a623' },
  { max: Infinity, l: 'OBESIDADE', c: '#f0563f' },
];

function formatAssessmentDate(ts: Timestamp | null | undefined): string {
  if (!ts) return 'HOJE';
  return formatDatePt(ts.toDate());
}

export function AssessmentScreen({ onBack }: { onBack: () => void }) {
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
  const hasOnboardingData = !!onboardingAnswers;

  const displayWeight = hasAssessments ? latest!.weight : onboardingAnswers?.weight ?? null;
  const displayHeight = hasAssessments ? latest!.height : onboardingAnswers?.height ?? null;
  // Sex is looked up from the most recent GUIDED assessment (imported ones
  // never carry it), falling back to the questionnaire — never invented.
  const lastGuidedSex = assessments.find((a) => a.source === 'guided')?.sex ?? null;
  const defaultSex: Sex | null = lastGuidedSex ?? onboardingAnswers?.sex ?? null;
  // Birth date is the only source of truth for age — resolved once in
  // userProfile.ts (with legacy-`age` compat baked in there), so by the time
  // it reaches this screen it's always a real Date or genuinely unknown. A
  // past assessment's own `age` field is intentionally NOT reused as a
  // fallback here: it was the user's age at that specific measuredAt, not a
  // birth date, and can't be projected forward.
  const birthDate =
    profile?.profile.birthDate?.toDate() ?? onboardingAnswers?.birthDate ?? null;

  const latestWithFolds =
    assessments.find(
      (a): a is Extract<typeof assessments[number], { source: 'guided' }> =>
        a.source === 'guided' && Object.keys(a.folds).length > 0,
    ) ?? null;

  // Charts read chronologically (oldest → newest); `assessments` is sorted
  // measuredAt desc for the history list, so reverse just for this. Body fat
  // only includes entries where it's actually known — an imported entry
  // without it is a gap, never plotted as 0.
  const chronological = [...assessments].reverse();
  const weightPoints: EvolutionPoint[] = chronological.map((a) => ({
    dateLabel: formatShortDatePt(a.measuredAt.toDate()),
    value: a.weight,
  }));
  const bodyFatPoints: EvolutionPoint[] = chronological
    .filter((a) => a.bodyFat != null)
    .map((a) => ({ dateLabel: formatShortDatePt(a.measuredAt.toDate()), value: a.bodyFat as number }));

  const historyRows: AssessmentHistoryRow[] = assessments.map((a) => ({
    id: a.id,
    date: formatAssessmentDate(a.measuredAt),
    weight: a.weight,
    bodyFat: a.bodyFat,
    bmi: a.bmi,
    leanMass: a.leanMass,
    fatMass: a.fatMass,
    source: a.source,
    protocolLabel: a.source === 'guided' ? resolveProtocolLabel(a.protocol) : undefined,
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
            <MonoLabel>AVALIAÇÃO FÍSICA</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {error ? (
          <View style={{ paddingHorizontal: 22, paddingTop: 40, alignItems: 'center' }}>
            <Icon name="alert-triangle" size={26} color="#f0563f" />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff', marginTop: 10 }}>
              Não foi possível carregar suas avaliações
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
              Verifique sua conexão e tente novamente.
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
                TENTAR NOVAMENTE
              </Text>
            </Pressable>
          </View>
        ) : loading && !hasAssessments ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accentHi} />
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
              lastDateLabel={hasAssessments ? formatAssessmentDate(latest!.measuredAt) : 'SEM REGISTROS'}
            />
            {!hasAssessments && (
              <Pressable onPress={() => setShowGuided(true)} style={{ marginTop: 10 }}>
                <Text
                  style={{
                    fontFamily: fonts.ui,
                    fontSize: 12.5,
                    color: colors.accentHi,
                    textAlign: 'center',
                  }}
                >
                  Você ainda não tem nenhuma avaliação registrada · toque para registrar a primeira
                </Text>
              </Pressable>
            )}
          </View>

          {/* EVOLUÇÃO */}
          <AssessmentSection title="EVOLUÇÃO">
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

          {/* INFORMAÇÕES BÁSICAS */}
          <AssessmentSection title="INFORMAÇÕES BÁSICAS">
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <AssessmentMetricCard
                label="PESO"
                value={displayWeight != null ? displayWeight.toFixed(1) : '—'}
                unit="kg"
                style={{ flex: 1 }}
              />
              <AssessmentMetricCard
                label="ALTURA"
                value={displayHeight != null ? String(displayHeight) : '—'}
                unit="cm"
                style={{ flex: 1 }}
              />
            </View>
            {!hasAssessments && (
              <MonoLabel color={colors.faint} style={{ marginTop: 8 }}>
                {hasOnboardingData
                  ? 'DADOS DO CADASTRO INICIAL · AINDA NÃO É UMA AVALIAÇÃO'
                  : 'SEM DADOS DE CADASTRO · REGISTRE SUA PRIMEIRA AVALIAÇÃO'}
              </MonoLabel>
            )}
          </AssessmentSection>

          {/* DOBRAS CUTÂNEAS */}
          <AssessmentSection title="DOBRAS CUTÂNEAS">
            <FoldableSection
              icon="list"
              title={
                latestWithFolds
                  ? resolveProtocolLabel(latestWithFolds.protocol)
                  : 'Nenhuma dobra registrada'
              }
              summary={
                latestWithFolds
                  ? `${Object.keys(latestWithFolds.folds).length} MEDIDAS · ${formatAssessmentDate(latestWithFolds.measuredAt)}`
                  : 'REGISTRE UMA AVALIAÇÃO GUIADA'
              }
            >
              {latestWithFolds ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {Object.entries(latestWithFolds.folds).map(([k, v]) => (
                    <View key={k} style={{ width: '48%' }}>
                      <MonoLabel style={{ marginBottom: 4 }}>{SITE_LABELS[k as SiteKey].toUpperCase()}</MonoLabel>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>{v} mm</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.mute }}>
                  As dobras cutâneas são preenchidas durante a Avaliação Guiada e usadas para
                  estimar seu percentual de gordura.
                </Text>
              )}
            </FoldableSection>
          </AssessmentSection>

          {/* ADICIONAR AVALIAÇÃO */}
          <AssessmentSection title="ADICIONAR AVALIAÇÃO">
            <AssessmentActionCard
              onGuided={() => setShowGuided(true)}
              onImport={() => setShowImport(true)}
            />
          </AssessmentSection>

          {/* HISTÓRICO */}
          <AssessmentSection title="HISTÓRICO" right={<MonoLabel>{assessments.length} REGISTROS</MonoLabel>}>
            {assessments.length === 0 ? (
              <Card style={{ padding: 32, alignItems: 'center' }}>
                <Icon name="chart" size={26} color="rgba(255,255,255,0.25)" />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff', marginTop: 10 }}>
                  Nenhuma avaliação registrada
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
                  Salve sua primeira avaliação para começar a linha do tempo.
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
                      {showFullHistory ? 'VER MENOS' : 'VER HISTÓRICO COMPLETO'}
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
            defaultHeight={displayHeight}
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
            defaultHeight={displayHeight}
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
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  small?: boolean;
  shakeX?: Animated.Value;
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
          placeholder="0"
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

function SexToggle({ value, onChange }: { value: Sex | null; onChange: (s: Sex) => void }) {
  return (
    <View>
      <MonoLabel color={colors.faint} style={{ marginBottom: 6 }}>
        SEXO
      </MonoLabel>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['m', 'f'] as Sex[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: value === s ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.04)',
              borderWidth: 1,
              borderColor: value === s ? 'rgba(11,112,249,0.4)' : 'rgba(255,255,255,0.09)',
            }}
          >
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: '#fff' }}>
              {s === 'm' ? 'MASCULINO' : 'FEMININO'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
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
  const [weight, setWeight] = useState(defaultWeight ? String(defaultWeight) : '');
  const [height, setHeight] = useState(defaultHeight ? String(defaultHeight) : '');
  const [sex, setSex] = useState<Sex | null>(defaultSex);
  const measuredAtFields = useMeasuredAtFields();
  // Manual fallback — only reachable when there is truly no birth date on
  // file (e.g. a social login that skipped onboarding). Once every account
  // has a birthDate this branch becomes dead code (see migration notes).
  const [manualAge, setManualAge] = useState('');
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
  const a = birthDate != null ? autoAge ?? NaN : parseFloat(manualAge);

  const proto = protocolById(protocolId);
  const sites = sex ? proto.sitesFor(sex) : [];
  const w = parseFloat(weight);
  const heightCm = parseFloat(height);
  const bmi = computeBmi(w, heightCm);
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
  const leanMass = computeLeanMass(w, bodyFat);
  const fatMass = computeFatMass(w, bodyFat);

  const canSave =
    w > 0 && heightCm > 0 && a > 0 && sex != null && bodyFat != null && measuredAtFields.isValid;

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
        weight: w,
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
              title: 'Avaliação salva',
              subtitle: 'Não foi possível atualizar a tela agora. Abra a Avaliação Física novamente para vê-la no histórico.',
            }
          : {
              tone: 'success',
              title: 'Avaliação salva com sucesso',
              subtitle: 'Adicionada ao seu histórico de evolução.',
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
        title: 'Falha ao salvar',
        subtitle: 'Verifique sua conexão e tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <ModalHeader onBack={onBack} title="NOVO REGISTRO" />

          {/* INFORMAÇÕES BÁSICAS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
            <Slash style={{ marginBottom: 12 }}>INFORMAÇÕES BÁSICAS</Slash>

            <View style={{ marginBottom: 14 }}>
              <DateFieldsInput
                label="DATA DA AVALIAÇÃO"
                day={measuredAtFields.day}
                month={measuredAtFields.month}
                year={measuredAtFields.year}
                onDay={measuredAtFields.setDay}
                onMonth={measuredAtFields.setMonth}
                onYear={measuredAtFields.setYear}
                error={shake && !measuredAtFields.isValid}
                shakeX={shakeX}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <MeasureField
                label="PESO"
                unit="kg"
                value={weight}
                onChange={setWeight}
                error={shake && w <= 0}
                shakeX={shakeX}
              />
              <MeasureField
                label="ALTURA"
                unit="cm"
                value={height}
                onChange={setHeight}
                error={shake && heightCm <= 0}
                shakeX={shakeX}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {birthDate != null ? (
                <View style={{ flex: 1 }}>
                  <MonoLabel color={colors.faint} style={{ marginBottom: 6 }}>
                    IDADE NA DATA DA AVALIAÇÃO
                  </MonoLabel>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 13,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.09)',
                    }}
                  >
                    <Text style={{ flex: 1, color: '#fff', fontFamily: fonts.display, fontSize: 22 }}>
                      {autoAge != null ? autoAge : '—'}
                    </Text>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.faint }}>anos</Text>
                  </View>
                </View>
              ) : (
                <MeasureField
                  label="IDADE NA DATA DA AVALIAÇÃO"
                  unit="anos"
                  value={manualAge}
                  onChange={setManualAge}
                  error={shake && !(a > 0)}
                  shakeX={shakeX}
                />
              )}
              <View style={{ flex: 1 }}>
                <SexToggle value={sex} onChange={setSex} />
              </View>
            </View>
            {birthDate == null && (
              <MonoLabel color={colors.faint} style={{ marginTop: 8 }}>
                SEM DATA DE NASCIMENTO CADASTRADA · INFORME A IDADE QUE VOCÊ TINHA NESTA DATA
              </MonoLabel>
            )}

            <Card style={{ padding: 16, marginTop: 12 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <MonoLabel>IMC AUTOMÁTICO</MonoLabel>
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
                        {band.l}
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
            <Slash style={{ marginBottom: 12 }}>DOBRAS CUTÂNEAS</Slash>

            <View style={{ position: 'relative', zIndex: 5 }}>
              <Pressable
                onPress={() => setProtocolOpen((o) => !o)}
                style={{
                  paddingVertical: 15,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.09)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1 }}>
                  <MonoLabel style={{ marginBottom: 4 }}>PROTOCOLO</MonoLabel>
                  <Text style={{ fontSize: 15, fontFamily: fonts.uiBold, color: '#fff' }}>{proto.label}</Text>
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
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.uiSemi, color: '#fff' }}>{p.label}</Text>
                      {protocolId === p.id && <Icon name="check" size={14} color={colors.accentHi} />}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {sex == null ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.mute, marginTop: 14 }}>
                Selecione o sexo acima para ver as dobras exigidas por este protocolo.
              </Text>
            ) : (
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
                        label={SITE_LABELS[s].toUpperCase()}
                        unit="mm"
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
            <Slash style={{ marginBottom: 12 }}>RESULTADOS</Slash>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <AssessmentMetricCard
                label="% GORDURA"
                value={bodyFat != null ? bodyFat.toFixed(1).replace('.', ',') : '—'}
                unit="%"
                icon="flame"
                style={{ width: '48.5%' }}
              />
              <AssessmentMetricCard
                label="MASSA MAGRA"
                value={leanMass != null ? leanMass.toFixed(1).replace('.', ',') : '—'}
                unit="kg"
                icon="dumbbell"
                style={{ width: '48.5%' }}
              />
              <AssessmentMetricCard
                label="MASSA GORDA"
                value={fatMass != null ? fatMass.toFixed(1).replace('.', ',') : '—'}
                unit="kg"
                icon="target"
                style={{ width: '48.5%' }}
              />
              <AssessmentMetricCard
                label="IMC"
                value={bmi != null ? bmi.toFixed(1) : '—'}
                unit=""
                icon="chart"
                style={{ width: '48.5%' }}
              />
            </View>
          </View>

          {/* SAVE CTA */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
              <Pressable onPress={handleSave} disabled={saving} style={{ opacity: saving ? 0.75 : 1 }}>
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
                        Salvando…
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
                        Salvar Avaliação
                      </Text>
                      <Icon name="arrow-right" size={18} color="#fff" />
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </Animated.View>
            {!canSave && (
              <MonoLabel color={shake ? '#f0563f' : colors.faint} style={{ textAlign: 'center', marginTop: 10 }}>
                PREENCHA DATA, PESO, ALTURA, SEXO, IDADE E TODAS AS DOBRAS PARA SALVAR
              </MonoLabel>
            )}
          </View>
        </ScrollView>

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
  const [weight, setWeight] = useState(defaultWeight ? String(defaultWeight) : '');
  const [height, setHeight] = useState(defaultHeight ? String(defaultHeight) : '');
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

  const w = parseFloat(weight);
  const h = parseFloat(height);
  const canSave = w > 0 && h > 0 && measuredAtFields.isValid;

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
        weight: w,
        height: h,
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
              title: 'Avaliação importada',
              subtitle: 'Não foi possível atualizar a tela agora. Abra a Avaliação Física novamente para vê-la no histórico.',
            }
          : {
              tone: 'success',
              title: 'Avaliação importada com sucesso',
              subtitle: 'Adicionada ao seu histórico de evolução.',
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
        title: 'Falha ao salvar',
        subtitle: 'Verifique sua conexão e tente novamente.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <ModalHeader onBack={onBack} title="AVALIAÇÃO IMPORTADA" />

          <View style={{ paddingHorizontal: 22, paddingTop: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 21, color: colors.mute }}>
              Fez uma avaliação com nutricionista, médico, clínica, bioimpedância ou DEXA?
              Registre os resultados já calculados abaixo — o app apenas guarda essas
              informações, sem refazer nenhum cálculo.
            </Text>
          </View>

          <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
            <Slash style={{ marginBottom: 12 }}>RESULTADOS DA AVALIAÇÃO</Slash>

            <View style={{ marginBottom: 14 }}>
              <DateFieldsInput
                label="DATA DA AVALIAÇÃO"
                day={measuredAtFields.day}
                month={measuredAtFields.month}
                year={measuredAtFields.year}
                onDay={measuredAtFields.setDay}
                onMonth={measuredAtFields.setMonth}
                onYear={measuredAtFields.setYear}
                error={shake && !measuredAtFields.isValid}
                shakeX={shakeX}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <MeasureField
                label="PESO"
                unit="kg"
                value={weight}
                onChange={setWeight}
                error={shake && w <= 0}
                shakeX={shakeX}
              />
              <MeasureField
                label="ALTURA"
                unit="cm"
                value={height}
                onChange={setHeight}
                error={shake && h <= 0}
                shakeX={shakeX}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <MeasureField label="BF" unit="%" value={bodyFat} onChange={setBodyFat} />
              <MeasureField label="ÁGUA CORPORAL" unit="%" value={bodyWater} onChange={setBodyWater} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <MeasureField
                label="METABOLISMO BASAL"
                unit="kcal"
                value={basalMetabolism}
                onChange={setBasalMetabolism}
              />
              <MeasureField label="GORDURA VISCERAL" unit="" value={visceralFat} onChange={setVisceralFat} />
            </View>

            <MonoLabel color={colors.faint} style={{ marginBottom: 6 }}>
              OBSERVAÇÕES (OPCIONAL)
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
                placeholder="Ex.: bioimpedância na Clínica X"
                placeholderTextColor={colors.faint}
                style={{ color: '#fff', fontFamily: fonts.ui, fontSize: 13.5, padding: 0 }}
              />
            </View>
          </View>

          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
              <Pressable onPress={handleSave} disabled={saving} style={{ opacity: saving ? 0.75 : 1 }}>
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
                        Salvando…
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
                        Registrar Avaliação
                      </Text>
                      <Icon name="arrow-right" size={18} color="#fff" />
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </Animated.View>
            {!canSave && (
              <MonoLabel color={shake ? '#f0563f' : colors.faint} style={{ textAlign: 'center', marginTop: 10 }}>
                PREENCHA DATA, PESO E ALTURA PARA REGISTRAR
              </MonoLabel>
            )}
          </View>
        </ScrollView>

        {toast.content && (
          <Toast opacity={toast.opacity} y={toast.y} tone={toast.content.tone} title={toast.content.title} subtitle={toast.content.subtitle} />
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  PanResponder,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display } from '../components/ui/Display';
import { SegBar } from '../components/ui/SegBar';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon, IconName } from '../components/ui/Icon';
import { HudCorners } from '../components/ui/Card';
import { DateWheelPicker } from '../components/ui/DateWheelPicker';
import { ImperialHeightInput } from '../components/ui/ImperialHeightInput';
import { EquipmentPicker } from '../components/fitness/EquipmentPicker';
import { colors, fonts } from '../theme/tokens';
import { useAppState, Quiz } from '../state/AppState';
import { computeAge } from '../lib/ageCalculator';
import { isFutureDate } from '../lib/dateUtils';
import { useUnits } from '../state/UnitsContext';
import { kgToLb, lbToKg, weightUnit } from '../units/weightConversions';

/**
 * QUESTIONS holds ONLY structure and stable IDs — every user-visible string
 * lives under `quiz:<questionId>.*` in the i18n resources. The `v` field of
 * each option is the persisted identifier and MUST NOT be renamed without
 * an authorized migration (see Phase 5 spec §4). Icons stay here because
 * they're an asset reference, not text.
 */
type OptionDef = { v: string; icon?: IconName };
type Question =
  | { id: keyof Quiz; kind: 'choice'; options: OptionDef[] }
  | { id: keyof Quiz; kind: 'choice-large'; options: OptionDef[] }
  | { id: keyof Quiz; kind: 'multi'; options: OptionDef[] }
  | { id: keyof Quiz; kind: 'date'; minAge: number; maxAge: number }
  | {
      id: keyof Quiz;
      kind: 'wheel';
      min: number;
      max: number;
      default: number;
      // Allowed digit count when typing a value directly (minDigits === maxDigits means an exact length is required).
      digits: { min: number; max: number };
    };

const QUESTIONS: Question[] = [
  { id: 'sex', kind: 'choice', options: [{ v: 'm' }, { v: 'f' }] },
  { id: 'birthDate', kind: 'date', minAge: 16, maxAge: 75 },
  {
    id: 'height',
    kind: 'wheel',
    min: 140,
    max: 220,
    default: 178,
    digits: { min: 3, max: 3 },
  },
  {
    id: 'weight',
    kind: 'wheel',
    min: 40,
    max: 180,
    default: 78,
    digits: { min: 2, max: 3 },
  },
  {
    id: 'goal',
    kind: 'choice-large',
    options: [
      { v: 'hyper', icon: 'dumbbell' },
      { v: 'cut', icon: 'flame' },
      { v: 'perf', icon: 'bolt' },
      { v: 'def', icon: 'target' },
      { v: 'recon', icon: 'heart' },
    ],
  },
  {
    id: 'level',
    kind: 'choice-large',
    options: [{ v: 'beg' }, { v: 'int' }, { v: 'adv' }, { v: 'elite' }],
  },
  { id: 'days', kind: 'wheel', min: 2, max: 7, default: 4, digits: { min: 1, max: 1 } },
  {
    id: 'duration',
    kind: 'choice',
    options: [{ v: '30' }, { v: '45' }, { v: '60' }, { v: '90' }],
  },
  {
    id: 'place',
    kind: 'choice',
    options: [{ v: 'gym' }, { v: 'home' }, { v: 'both' }],
  },
  {
    // Options here are dead code — `q.id === 'equipment'` short-circuits to
    // EquipmentPicker below, which has its own catalog. Kept only because
    // the Question type requires `options` on `kind: 'multi'`. Not rendered
    // and not translated (they'd never be shown).
    id: 'equipment',
    kind: 'multi',
    options: [],
  },
  {
    id: 'limits',
    kind: 'multi',
    options: [
      { v: 'none' },
      { v: 'knee' },
      { v: 'back' },
      { v: 'shoulder' },
      { v: 'wrist' },
      { v: 'hip' },
    ],
  },
];

/** Loose t signature for dynamic key lookups (path is composed from IDs).
 *  Narrower than `any` — bounded by string in/out — preserves the strict
 *  augmented `t` everywhere the path is a literal. */
type LooseT = (key: string, options?: Record<string, unknown>) => string;

export function QuizScreen({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation(['quiz', 'common']);
  const tLoose = t as unknown as LooseT;
  const { quiz, setQuiz } = useAppState();
  const { resolvedUnits } = useUnits();
  const [idx, setIdx] = useState(0);
  const q = QUESTIONS[idx];
  const total = QUESTIONS.length;

  const back = () => idx > 0 && setIdx(idx - 1);
  const advance = () => (idx < total - 1 ? setIdx(idx + 1) : onDone());
  const value = quiz[q.id];
  const setVal = (v: unknown) => setQuiz({ ...quiz, [q.id]: v } as Quiz);

  const canContinue =
    q.kind === 'multi'
      ? Array.isArray(value) && value.length > 0
      : q.kind === 'wheel'
        ? true
        : q.kind === 'date'
          ? value instanceof Date && !isFutureDate(value) && (() => {
              const age = computeAge(value);
              return age >= q.minAge && age <= q.maxAge;
            })()
          : value != null;

  const outlineFontSize = 240;
  const outlineSvgW = 280;
  const outlineSvgH = 220;
  const outlineN = String(idx + 1).padStart(2, '0');

  const questionTitle = tLoose(`quiz:${q.id}.title`).toUpperCase();
  const questionSubKey = `quiz:${q.id}.sub`;
  const questionSub = i18n.exists(questionSubKey) ? tLoose(questionSubKey) : null;

  const devNav = <DevQuizNav questions={QUESTIONS} idx={idx} onJump={(i) => setIdx(i)} />;

  if (q.id === 'equipment') {
    const stepLabel = tLoose('quiz:equipment.stepLabel', {
      current: String(idx + 1).padStart(2, '0'),
      total: String(total).padStart(2, '0'),
    }).toUpperCase();
    return (
      <View style={{ flex: 1 }}>
        <EquipmentPicker
          value={(value as string[]) || []}
          onChange={(v) => setVal(v)}
          onDone={advance}
          onBack={back}
          stepLabel={stepLabel}
        />
        {devNav}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: 'hidden' }}>
      {/* Outlined "01" tucked into the top-right corner — both digits fully
          on-screen at roughly half the previous size */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: -28, right: 10 }}
      >
        <Svg width={outlineSvgW} height={outlineSvgH}>
          <SvgText
            x={outlineSvgW}
            y={outlineSvgH * 0.85}
            fontFamily={fonts.display}
            fontSize={outlineFontSize}
            textAnchor="end"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1.5}
            fill="none"
          >
            {outlineN}
          </SvgText>
        </Svg>
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <Pressable
            onPress={back}
            disabled={idx === 0}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: idx === 0 ? 0.3 : 1,
            }}
          >
            <Icon name="arrow-left" size={17} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SegBar value={(idx + 1) / total} segs={total} />
          </View>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 2,
              color: colors.faint,
            }}
          >
            {String(idx + 1).padStart(2, '0')}
            <Text style={{ opacity: 0.4 }}>/{total}</Text>
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 24,
          }}
        >
          <View style={{ marginBottom: 24 }}>
            <Display size={32}>{questionTitle}</Display>
            {questionSub && (
              <Text style={{ marginTop: 10, color: colors.mute, fontSize: 14, fontFamily: fonts.ui }}>
                {questionSub}
              </Text>
            )}
          </View>

          {/* The `date` kind hosts a vertical FlatList (DateWheelPicker), which
              React Native won't let us nest inside a same-orientation ScrollView.
              Every other kind is short-list content that benefits from scroll. */}
          {q.kind === 'date' ? (
            <View style={{ flex: 1, marginTop: 16 }}>
              <BirthDateWheel
                q={q}
                value={value as Date | null}
                onChange={setVal}
              />
            </View>
          ) : (
            <ScrollView style={{ flex: 1, marginTop: 16 }} showsVerticalScrollIndicator={false}>
              {q.kind === 'choice' && (
                <ChoiceGrid
                  questionId={q.id}
                  options={q.options}
                  value={value as string}
                  onChange={setVal}
                />
              )}
              {q.kind === 'choice-large' && (
                <ChoiceList
                  questionId={q.id}
                  options={q.options}
                  value={value as string}
                  onChange={setVal}
                />
              )}
              {q.kind === 'wheel' && q.id === 'height' && resolvedUnits === 'imperial' && (
                <ImperialHeightInput
                  valueCm={(value as number) ?? q.default}
                  minCm={q.min}
                  maxCm={q.max}
                  onChangeCm={setVal}
                  feetLabel={t('quiz:height.feet')}
                  inchesLabel={t('quiz:height.inches')}
                />
              )}
              {q.kind === 'wheel' && !(q.id === 'height' && resolvedUnits === 'imperial') && (
                <NumberWheel q={q} value={(value as number) ?? q.default} onChange={setVal} />
              )}
              {q.kind === 'multi' && (
                <MultiList
                  questionId={q.id}
                  options={q.options}
                  value={(value as string[]) || []}
                  onChange={setVal}
                />
              )}
            </ScrollView>
          )}

          <CtaButton onPress={advance} disabled={!canContinue} style={{ marginTop: 14 }}>
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {idx < total - 1
                ? t('common:actions.continue')
                : t('quiz:actions.generatePlan')}
            </Text>
            <Icon name="arrow-right" size={18} color="#fff" />
          </CtaButton>
        </View>
      </SafeAreaView>
      {devNav}
    </View>
  );
}

// ─── Dev-only quiz navigator ─────────────────────────────
// Small floating pill in the top-right that expands into a list of every
// question. Lets you jump straight to whichever step you're working on
// instead of re-answering the whole quiz. Remove when the app ships.
function DevQuizNav({
  questions,
  idx,
  onJump,
}: {
  questions: Question[];
  idx: number;
  onJump: (i: number) => void;
}) {
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const [open, setOpen] = useState(false);
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 54, right: 12, zIndex: 999 }}
    >
      {!open && (
        <Pressable
          onPress={() => setOpen(true)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            backgroundColor: 'rgba(255,168,64,0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255,168,64,0.55)',
          }}
        >
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 9,
              letterSpacing: 1.5,
              color: '#ffa840',
            }}
          >
            DEV · {String(idx + 1).padStart(2, '0')}
          </Text>
        </Pressable>
      )}
      {open && (
        <View
          style={{
            width: 240,
            padding: 8,
            borderRadius: 12,
            backgroundColor: 'rgba(6,2,32,0.96)',
            borderWidth: 1,
            borderColor: 'rgba(255,168,64,0.4)',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 6,
              paddingVertical: 4,
              marginBottom: 4,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 9,
                letterSpacing: 1.5,
                color: '#ffa840',
              }}
            >
              DEV · JUMP TO
            </Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <Icon name="x" size={14} color="rgba(255,255,255,0.5)" />
            </Pressable>
          </View>
          {questions.map((qq, i) => {
            const current = i === idx;
            return (
              <Pressable
                key={String(qq.id)}
                onPress={() => {
                  onJump(i);
                  setOpen(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 7,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  backgroundColor: current ? 'rgba(11,112,249,0.18)' : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: current ? colors.accentHi : 'rgba(255,255,255,0.35)',
                    minWidth: 20,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.ui,
                    fontSize: 11.5,
                    color: current ? '#fff' : 'rgba(255,255,255,0.75)',
                  }}
                  numberOfLines={1}
                >
                  {tLoose(`${String(qq.id)}.title`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const selBg = (sel: boolean) =>
  sel ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.035)';
const selBorder = (sel: boolean) =>
  sel ? '#0b70f9' : 'rgba(255,255,255,0.07)';

function ChoiceGrid({
  questionId,
  options,
  value,
  onChange,
}: {
  questionId: keyof Quiz;
  options: OptionDef[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  return (
    <View style={{ flexDirection: 'column', gap: 10 }}>
      {options.map((o) => {
        const sel = value === o.v;
        const label = tLoose(`${String(questionId)}.options.${o.v}.label`);
        const short = tLoose(`${String(questionId)}.options.${o.v}.short`);
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              width: '100%',
              padding: 20,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: selBg(sel),
              borderWidth: 1,
              borderColor: selBorder(sel),
              shadowColor: sel ? colors.accent : 'transparent',
              shadowOpacity: sel ? 0.45 : 0,
              shadowRadius: sel ? 18 : 0,
              shadowOffset: { width: 0, height: 0 },
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {sel && <HudCorners />}
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 20,
                color: sel ? colors.accentHi : 'rgba(255,255,255,0.35)',
                minWidth: 44,
                textTransform: 'uppercase',
              }}
            >
              {short}
            </Text>
            <Text
              style={{
                fontFamily: fonts.uiSemi,
                fontSize: 16,
                color: '#fff',
                flex: 1,
              }}
            >
              {label}
            </Text>
            {sel && <Icon name="check" size={18} color={colors.accentHi} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function ChoiceList({
  questionId,
  options,
  value,
  onChange,
}: {
  questionId: keyof Quiz;
  options: OptionDef[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  return (
    <View style={{ gap: 10 }}>
      {options.map((o) => {
        const sel = value === o.v;
        const label = tLoose(`${String(questionId)}.options.${o.v}.label`);
        const description = tLoose(`${String(questionId)}.options.${o.v}.description`);
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              padding: 16,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: selBg(sel),
              borderWidth: 1,
              borderColor: selBorder(sel),
              shadowColor: sel ? colors.accent : 'transparent',
              shadowOpacity: sel ? 0.4 : 0,
              shadowRadius: sel ? 16 : 0,
              shadowOffset: { width: 0, height: 0 },
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {sel && <HudCorners />}
            {o.icon && (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: sel ? colors.accent : 'rgba(255,255,255,0.05)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={o.icon} size={20} color="#fff" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: '#fff' }}>{label}</Text>
              <Text
                style={{
                  fontFamily: fonts.ui,
                  fontSize: 13,
                  color: colors.mute,
                  marginTop: 2,
                }}
              >
                {description}
              </Text>
            </View>
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                transform: [{ rotate: '45deg' }],
                borderWidth: sel ? 0 : 1.5,
                borderColor: 'rgba(255,255,255,0.22)',
                backgroundColor: sel ? colors.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {sel && (
                <View style={{ transform: [{ rotate: '-45deg' }] }}>
                  <Icon name="check" size={12} color="#fff" />
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MultiList({
  questionId,
  options,
  value,
  onChange,
}: {
  questionId: keyof Quiz;
  options: OptionDef[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const toggle = (v: string) =>
    value.includes(v) ? onChange(value.filter((x) => x !== v)) : onChange([...value, v]);
  const GAP = 10;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {options.map((o) => {
        const sel = value.includes(o.v);
        const label = tLoose(`${String(questionId)}.options.${o.v}`);
        return (
          <Pressable
            key={o.v}
            onPress={() => toggle(o.v)}
            style={{
              // Two columns with a 10px gap: 48% width leaves ~4% of row
              // width for the gap, which is comfortable across screen sizes.
              flexBasis: '48%',
              flexGrow: 1,
              paddingVertical: 16,
              paddingHorizontal: 14,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: selBg(sel),
              borderWidth: 1,
              borderColor: selBorder(sel),
              shadowColor: sel ? colors.accent : 'transparent',
              shadowOpacity: sel ? 0.45 : 0,
              shadowRadius: sel ? 22 : 0,
              shadowOffset: { width: 0, height: 0 },
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: sel ? colors.accent : 'transparent',
                borderWidth: sel ? 0 : 1.5,
                borderColor: 'rgba(255,255,255,0.22)',
              }}
            >
              {sel && <Icon name="check" size={11} color="#fff" stroke={2.6} />}
            </View>
            <Text
              style={{
                fontFamily: fonts.uiSemi,
                fontSize: 14.5,
                color: '#fff',
                flexShrink: 1,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NumberWheel({
  q,
  value,
  onChange,
}: {
  q: Extract<Question, { kind: 'wheel' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation('quiz');
  const { resolvedUnits } = useUnits();
  const tLoose = t as unknown as LooseT;
  const isBodyWeight = q.id === 'weight';
  const unit = isBodyWeight
    ? weightUnit(resolvedUnits)
    : tLoose(`${String(q.id)}.unit`);
  const displayMin = isBodyWeight && resolvedUnits === 'imperial'
    ? Math.round(kgToLb(q.min))
    : q.min;
  const displayMax = isBodyWeight && resolvedUnits === 'imperial'
    ? Math.round(kgToLb(q.max))
    : q.max;
  const displayValue = isBodyWeight && resolvedUnits === 'imperial'
    ? Math.round(kgToLb(value))
    : Math.round(value);
  const range = displayMax - displayMin;
  // Width of the editable number box. Seeded from a digit-count estimate,
  // then replaced with the exact pixel width measured off the static
  // <Text> (which sizes to its content) so the digits land in the same
  // spot in both modes and the unit label ("kg", "cm"...) doesn't shift.
  const [numWidth, setNumWidth] = useState(q.digits.max * 64);
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const trackRef = useRef<View>(null);
  const pct = ((displayValue - displayMin) / range) * 100;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<TextInput>(null);

  // The PanResponder below is created once (via useRef) and reused across
  // every question, since switching questions re-renders this same
  // component instance rather than remounting it. Reading `q`/`onChange`
  // directly in its captured callbacks would freeze them to whichever
  // question first created the responder. Routing through refs keeps the
  // callbacks reading the current question/value on every touch event.
  const displayRangeRef = useRef({ min: displayMin, max: displayMax });
  displayRangeRef.current = { min: displayMin, max: displayMax };
  const onDisplayChangeRef = useRef<(next: number) => void>(() => {});
  onDisplayChangeRef.current = (next) => {
    onChange(
      isBodyWeight && resolvedUnits === 'imperial' ? lbToKg(next) : next,
    );
  };

  const updateFromPageX = (pageX: number) => {
    if (!trackWidth.current) return;
    const currentRange = displayRangeRef.current;
    const p = Math.max(0, Math.min(1, (pageX - trackPageX.current) / trackWidth.current));
    onDisplayChangeRef.current(
      Math.round(currentRange.min + p * (currentRange.max - currentRange.min)),
    );
  };

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackPageX.current = x;
      trackWidth.current = width;
    });
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        measureTrack();
        updateFromPageX(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => updateFromPageX(e.nativeEvent.pageX),
    })
  ).current;

  const openEditor = () => {
    setDraft(String(displayValue));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitEditor = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && draft.length >= q.digits.min) {
      onDisplayChangeRef.current(
        Math.max(displayMin, Math.min(displayMax, n)),
      );
    }
    // Invalid or short input (e.g. height requires exactly 3 digits) is
    // discarded — the previous value is kept instead of half-typed input.
    setEditing(false);
  };

  return (
    <View style={{ alignItems: 'center', gap: 30, paddingTop: 14 }}>
      <Pressable
        onPress={openEditor}
        style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}
      >
        {editing ? (
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(txt) => setDraft(txt.replace(/[^0-9]/g, '').slice(0, q.digits.max))}
            onBlur={commitEditor}
            onSubmitEditing={commitEditor}
            keyboardType="number-pad"
            maxLength={q.digits.max}
            returnKeyType="done"
            autoFocus
            selectTextOnFocus
            style={{
              fontFamily: fonts.display,
              fontSize: 120,
              color: '#fff',
              textAlign: 'right',
              transform: [{ skewX: '-8deg' }],
              width: numWidth,
              padding: 0,
            }}
          />
        ) : (
          <Text
            onLayout={(e) => setNumWidth(e.nativeEvent.layout.width)}
            style={{
              fontFamily: fonts.display,
              fontSize: 120,
              color: '#fff',
              transform: [{ skewX: '-8deg' }],
              textShadowColor: 'rgba(11,112,249,0.55)',
              textShadowRadius: 30,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            {displayValue}
          </Text>
        )}
        <Text style={{ fontFamily: fonts.mono, fontSize: 13, letterSpacing: 2, color: colors.faint }}>
          {unit}
        </Text>
      </Pressable>

      <View
        ref={trackRef}
        {...responder.panHandlers}
        onLayout={measureTrack}
        style={{ width: '100%', height: 72, justifyContent: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 30 }}>
          {Array.from({ length: 36 }).map((_, i) => {
            const filled = (i / 36) * 100 <= pct;
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: i % 5 === 0 ? 30 : 14,
                  borderLeftWidth: 2,
                  borderLeftColor: filled ? 'rgba(11,112,249,0.85)' : 'rgba(255,255,255,0.14)',
                  transform: [{ skewX: '-16deg' }],
                }}
              />
            );
          })}
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 8,
            bottom: 8,
            left: `${pct}%`,
            width: 3,
            backgroundColor: '#fff',
            shadowColor: colors.accent,
            shadowOpacity: 0.9,
            shadowRadius: 8,
            transform: [{ skewX: '-16deg' }],
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
          {displayMin}
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
          {t('progress.wheelHint').toUpperCase()}
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
          {displayMax}
        </Text>
      </View>
    </View>
  );
}

function BirthDateWheel({
  q,
  value,
  onChange,
}: {
  q: Extract<Question, { kind: 'date' }>;
  value: Date | null;
  onChange: (d: Date) => void;
}) {
  const { t, i18n } = useTranslation('quiz');
  // Seed the spinner with a date that lands inside the accepted [minAge, maxAge]
  // window so first paint doesn't look like an error state. We DON'T commit
  // this seed to parent state — parent value stays null until the user
  // actually interacts with the wheel (any scroll fires DateWheelPicker's
  // onChange with the current snapped date).
  const seed = useRef<Date>(
    value ??
      (() => {
        const now = new Date();
        return new Date(now.getFullYear() - q.minAge, now.getMonth(), now.getDate());
      })(),
  ).current;

  const displayed = value ?? seed;
  const age = computeAge(displayed);
  // Pluralization via i18next: the `count` option triggers `_one` vs
  // `_other` lookup and interpolates the number into `{{count}}`.
  const ageLabel = t('birthDate.age', { count: age });

  return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 100,
            color: '#fff',
            transform: [{ skewX: '-8deg' }],
            textShadowColor: 'rgba(11,112,249,0.55)',
            textShadowRadius: 30,
            textShadowOffset: { width: 0, height: 0 },
          }}
        >
          {age}
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 13, letterSpacing: 2, color: colors.faint }}>
          {/* `ageLabel` already includes the number; slice it off so the mono
              label reads e.g. "ANOS" / "YEARS" / "AÑOS" next to the big skewed
              number that renders separately above. Guarantees the count and
              the noun always agree in plural form. */}
          {ageLabel.replace(/^\s*\d+\s*/, '').toUpperCase()}
        </Text>
      </View>

      <View style={{ width: '100%' }}>
        {/* Locale drives Intl.DateTimeFormat inside DateWheelPicker — month
            names must render in the active language. */}
        <DateWheelPicker value={displayed} locale={i18n.language} onChange={onChange} />
      </View>
    </View>
  );
}

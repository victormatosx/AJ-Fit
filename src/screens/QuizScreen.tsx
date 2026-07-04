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
import { Display } from '../components/ui/Display';
import { SegBar } from '../components/ui/SegBar';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon, IconName } from '../components/ui/Icon';
import { HudCorners } from '../components/ui/Card';
import { EquipmentPicker } from '../components/fitness/EquipmentPicker';
import { colors, fonts } from '../theme/tokens';
import { useAppState, Quiz } from '../state/AppState';

type Option = { v: string; l: string; i?: string; d?: string; icon?: IconName };
type Question =
  | { id: keyof Quiz; kind: 'choice'; title: string; sub?: string; options: Option[] }
  | { id: keyof Quiz; kind: 'choice-large'; title: string; sub?: string; options: Option[] }
  | { id: keyof Quiz; kind: 'multi'; title: string; sub?: string; options: Option[] }
  | {
      id: keyof Quiz;
      kind: 'wheel';
      title: string;
      sub?: string;
      unit: string;
      min: number;
      max: number;
      default: number;
      // Allowed digit count when typing a value directly (minDigits === maxDigits means an exact length is required).
      digits: { min: number; max: number };
    };

const QUESTIONS: Question[] = [
  {
    id: 'sex',
    kind: 'choice',
    title: 'QUAL SEU SEXO?',
    sub: 'Calibra volume e recuperação.',
    options: [
      { v: 'm', l: 'Masculino', i: 'M' },
      { v: 'f', l: 'Feminino', i: 'F' },
    ],
  },
  {
    id: 'age',
    kind: 'wheel',
    title: 'SUA IDADE?',
    sub: 'Afeta intensidade e descanso.',
    unit: 'anos',
    min: 16,
    max: 75,
    default: 28,
    digits: { min: 2, max: 3 },
  },
  {
    id: 'height',
    kind: 'wheel',
    title: 'SUA ALTURA?',
    unit: 'cm',
    min: 140,
    max: 220,
    default: 178,
    digits: { min: 3, max: 3 },
  },
  {
    id: 'weight',
    kind: 'wheel',
    title: 'SEU PESO ATUAL?',
    sub: 'Base do cálculo de carga inicial.',
    unit: 'kg',
    min: 40,
    max: 180,
    default: 78,
    digits: { min: 2, max: 3 },
  },
  {
    id: 'goal',
    kind: 'choice-large',
    title: 'OBJETIVO PRINCIPAL?',
    sub: 'Define o foco do programa.',
    options: [
      { v: 'hyper', l: 'Hipertrofia', d: 'Ganhar massa muscular', icon: 'dumbbell' },
      { v: 'cut', l: 'Emagrecimento', d: 'Queimar gordura', icon: 'flame' },
      { v: 'perf', l: 'Performance', d: 'Força e potência', icon: 'bolt' },
      { v: 'def', l: 'Definição', d: 'Cortar e secar', icon: 'target' },
      { v: 'recon', l: 'Recondicionamento', d: 'Voltar à forma', icon: 'heart' },
    ],
  },
  {
    id: 'level',
    kind: 'choice-large',
    title: 'SEU NÍVEL?',
    sub: 'O programa começa exatamente do seu ponto.',
    options: [
      { v: 'beg', l: 'Iniciante', d: 'Menos de 6 meses' },
      { v: 'int', l: 'Intermediário', d: '6 meses a 2 anos' },
      { v: 'adv', l: 'Avançado', d: 'Mais de 2 anos' },
      { v: 'elite', l: 'Elite', d: 'Atleta / 5+ anos' },
    ],
  },
  {
    id: 'days',
    kind: 'wheel',
    title: 'DIAS POR SEMANA?',
    sub: 'Vamos cobrar exatamente esse compromisso.',
    unit: 'dias/sem',
    min: 2,
    max: 7,
    default: 4,
    digits: { min: 1, max: 1 },
  },
  {
    id: 'duration',
    kind: 'choice',
    title: 'TEMPO POR TREINO?',
    options: [
      { v: '30', l: '30 min', i: '30' },
      { v: '45', l: '45 min', i: '45' },
      { v: '60', l: '60 min', i: '60' },
      { v: '90', l: '90+ min', i: '90' },
    ],
  },
  {
    id: 'place',
    kind: 'choice',
    title: 'ONDE VOCÊ TREINA?',
    sub: 'O treino usa só o que você tem.',
    options: [
      { v: 'gym', l: 'Academia', i: 'GYM' },
      { v: 'home', l: 'Casa', i: 'CASA' },
      { v: 'both', l: 'Os dois', i: '2X' },
    ],
  },
  {
    id: 'equipment',
    kind: 'multi',
    title: 'EQUIPAMENTOS?',
    sub: 'Selecione todos disponíveis.',
    options: [
      { v: 'dumbbell', l: 'Halteres' },
      { v: 'barbell', l: 'Barra' },
      { v: 'rack', l: 'Rack' },
      { v: 'bench', l: 'Banco' },
      { v: 'cable', l: 'Polia' },
      { v: 'machines', l: 'Máquinas' },
      { v: 'kettle', l: 'Kettlebell' },
      { v: 'band', l: 'Elásticos' },
      { v: 'bw', l: 'Só peso corporal' },
    ],
  },
  {
    id: 'limits',
    kind: 'multi',
    title: 'ALGUMA LIMITAÇÃO?',
    sub: 'Vamos proteger o que precisa de cuidado.',
    options: [
      { v: 'none', l: 'Nenhuma' },
      { v: 'knee', l: 'Joelho' },
      { v: 'back', l: 'Coluna' },
      { v: 'shoulder', l: 'Ombro' },
      { v: 'wrist', l: 'Punho' },
      { v: 'hip', l: 'Quadril' },
    ],
  },
];

export function QuizScreen({ onDone }: { onDone: () => void }) {
  const { quiz, setQuiz } = useAppState();
  const [idx, setIdx] = useState(0);
  const q = QUESTIONS[idx];
  const total = QUESTIONS.length;

  const back = () => idx > 0 && setIdx(idx - 1);
  const advance = () => (idx < total - 1 ? setIdx(idx + 1) : onDone());
  const value = quiz[q.id];
  const setVal = (v: any) => setQuiz({ ...quiz, [q.id]: v });

  const canContinue =
    q.kind === 'multi'
      ? Array.isArray(value) && value.length > 0
      : q.kind === 'wheel'
        ? true
        : value != null;

  const outlineFontSize = 240;
  const outlineSvgW = 280;
  const outlineSvgH = 220;
  const outlineN = String(idx + 1).padStart(2, '0');

  const devNav = (
    <DevQuizNav
      questions={QUESTIONS}
      idx={idx}
      onJump={(i) => setIdx(i)}
    />
  );

  if (q.id === 'equipment') {
    const stepLabel = `EQUIPAMENTO · ${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
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
            <Display size={32}>{q.title}</Display>
            {q.sub && (
              <Text style={{ marginTop: 10, color: colors.mute, fontSize: 14, fontFamily: fonts.ui }}>
                {q.sub}
              </Text>
            )}
          </View>

          <ScrollView style={{ flex: 1, marginTop: 16 }} showsVerticalScrollIndicator={false}>
            {q.kind === 'choice' && (
              <ChoiceGrid options={q.options} value={value as string} onChange={setVal} />
            )}
            {q.kind === 'choice-large' && (
              <ChoiceList options={q.options} value={value as string} onChange={setVal} />
            )}
            {q.kind === 'wheel' && (
              <NumberWheel q={q} value={(value as number) ?? q.default} onChange={setVal} />
            )}
            {q.kind === 'multi' && (
              <MultiList
                options={q.options}
                value={(value as string[]) || []}
                onChange={setVal}
              />
            )}
          </ScrollView>

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
              {idx < total - 1 ? 'Continuar' : 'Gerar meu plano'}
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
                  {qq.title}
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
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'column', gap: 10 }}>
      {options.map((o) => {
        const sel = value === o.v;
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
              {o.i}
            </Text>
            <Text
              style={{
                fontFamily: fonts.uiSemi,
                fontSize: 16,
                color: '#fff',
                flex: 1,
              }}
            >
              {o.l}
            </Text>
            {sel && <Icon name="check" size={18} color={colors.accentHi} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function ChoiceList({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      {options.map((o) => {
        const sel = value === o.v;
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
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: '#fff' }}>{o.l}</Text>
              {o.d && (
                <Text
                  style={{
                    fontFamily: fonts.ui,
                    fontSize: 13,
                    color: colors.mute,
                    marginTop: 2,
                  }}
                >
                  {o.d}
                </Text>
              )}
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
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) =>
    value.includes(v) ? onChange(value.filter((x) => x !== v)) : onChange([...value, v]);
  const GAP = 10;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {options.map((o) => {
        const sel = value.includes(o.v);
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
              {o.l}
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
  const range = q.max - q.min;
  // Width of the editable number box. Seeded from a digit-count estimate,
  // then replaced with the exact pixel width measured off the static
  // <Text> (which sizes to its content) so the digits land in the same
  // spot in both modes and the unit label ("kg", "cm"...) doesn't shift.
  const [numWidth, setNumWidth] = useState(q.digits.max * 64);
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const trackRef = useRef<View>(null);
  const pct = ((value - q.min) / range) * 100;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<TextInput>(null);

  // The PanResponder below is created once (via useRef) and reused across
  // every question, since switching questions re-renders this same
  // component instance rather than remounting it. Reading `q`/`onChange`
  // directly in its captured callbacks would freeze them to whichever
  // question first created the responder. Routing through refs keeps the
  // callbacks reading the current question/value on every touch event.
  const qRef = useRef(q);
  qRef.current = q;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const updateFromPageX = (pageX: number) => {
    if (!trackWidth.current) return;
    const cq = qRef.current;
    const p = Math.max(0, Math.min(1, (pageX - trackPageX.current) / trackWidth.current));
    onChangeRef.current(Math.round(cq.min + p * (cq.max - cq.min)));
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
    setDraft(String(value));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitEditor = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && draft.length >= q.digits.min) {
      onChange(Math.max(q.min, Math.min(q.max, n)));
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
            onChangeText={(t) => setDraft(t.replace(/[^0-9]/g, '').slice(0, q.digits.max))}
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
              outlineStyle: 'none',
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
            {value}
          </Text>
        )}
        <Text style={{ fontFamily: fonts.mono, fontSize: 13, letterSpacing: 2, color: colors.faint }}>
          {q.unit}
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
          {q.min}
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
          ARRASTE OU TOQUE NO NÚMERO
        </Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, color: colors.faint }}>
          {q.max}
        </Text>
      </View>
    </View>
  );
}

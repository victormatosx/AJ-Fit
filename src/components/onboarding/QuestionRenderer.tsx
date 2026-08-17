import React, { useRef, useState } from 'react';
import { View, Text, Pressable, PanResponder, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HudCorners } from '../ui/Card';
import { Icon, type IconName } from '../ui/Icon';
import { DateWheelPicker } from '../ui/DateWheelPicker';
import { colors, fonts } from '../../theme/tokens';
import type { Quiz } from '../../state/AppState';
import { computeAge } from '../../lib/ageCalculator';
import { useUnits } from '../../state/UnitsContext';
import { kgToLb, lbToKg, weightUnit } from '../../units/weightConversions';

/**
 * Extracted from the legacy monolithic QuizScreen so the same renderers can
 * be driven by the funnel's step machine (which needs to interleave
 * interstitials between individual questions) instead of a single
 * self-contained 11-question sequence. Structure/behavior unchanged —
 * this is a lift, not a rewrite.
 */
export type OptionDef = { v: string; icon?: IconName };
export type Question =
  | { id: keyof Quiz; kind: 'choice'; options: OptionDef[] }
  | { id: keyof Quiz; kind: 'choice-large'; options: OptionDef[] }
  | { id: keyof Quiz; kind: 'multi'; options: OptionDef[]; maxSelections?: number }
  | { id: keyof Quiz; kind: 'date'; minAge: number; maxAge: number }
  | {
      id: keyof Quiz;
      kind: 'wheel';
      min: number;
      max: number;
      default: number;
      digits: { min: number; max: number };
    };

/** Loose t signature for dynamic key lookups (path is composed from ids). */
export type LooseT = (key: string, options?: Record<string, unknown>) => string;

export function canContinueQuestion(q: Question, value: unknown): boolean {
  if (q.kind === 'multi') return Array.isArray(value) && value.length > 0;
  if (q.kind === 'wheel') return true;
  if (q.kind === 'date') {
    if (!(value instanceof Date)) return false;
    if (value.getTime() > Date.now()) return false;
    const age = computeAge(value);
    return age >= q.minAge && age <= q.maxAge;
  }
  return value != null;
}

const selBg = (sel: boolean) => (sel ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.035)');
const selBorder = (sel: boolean) => (sel ? '#0b70f9' : 'rgba(255,255,255,0.07)');

export function ChoiceGrid({
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
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 16, color: '#fff', flex: 1 }}>
              {label}
            </Text>
            {sel && <Icon name="check" size={18} color={colors.accentHi} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChoiceList({
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
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: '#fff' }}>{label}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.mute, marginTop: 2 }}>
                {description}
              </Text>
            </View>
            {sel && <Icon name="check" size={20} color={colors.accentHi} stroke={2.8} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export function MultiList({
  questionId,
  options,
  value,
  onChange,
  maxSelections,
}: {
  questionId: keyof Quiz;
  options: OptionDef[];
  value: string[];
  onChange: (v: string[]) => void;
  /** When set, selecting beyond this count is a no-op instead of growing the array. */
  maxSelections?: number;
}) {
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const toggle = (v: string) => {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
      return;
    }
    if (maxSelections != null && value.length >= maxSelections) return;
    onChange([...value, v]);
  };
  const GAP = 10;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {options.map((o) => {
        const sel = value.includes(o.v);
        const atLimit = maxSelections != null && value.length >= maxSelections && !sel;
        const label = tLoose(`${String(questionId)}.options.${o.v}`);
        return (
          <Pressable
            key={o.v}
            onPress={() => toggle(o.v)}
            disabled={atLimit}
            style={{
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
              opacity: atLimit ? 0.4 : 1,
              shadowColor: sel ? colors.accent : 'transparent',
              shadowOpacity: sel ? 0.45 : 0,
              shadowRadius: sel ? 22 : 0,
              shadowOffset: { width: 0, height: 0 },
            }}
          >
            <Text
              style={{
                fontFamily: fonts.uiSemi,
                fontSize: 14.5,
                color: '#fff',
                flexShrink: 1,
                flex: 1,
              }}
            >
              {label}
            </Text>
            {sel && <Icon name="check" size={18} color={colors.accentHi} stroke={2.8} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export function NumberWheel({
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
  const unit = isBodyWeight ? weightUnit(resolvedUnits) : tLoose(`${String(q.id)}.unit`);
  const displayMin = isBodyWeight && resolvedUnits === 'imperial' ? Math.round(kgToLb(q.min)) : q.min;
  const displayMax = isBodyWeight && resolvedUnits === 'imperial' ? Math.round(kgToLb(q.max)) : q.max;
  const displayValue =
    isBodyWeight && resolvedUnits === 'imperial' ? Math.round(kgToLb(value)) : Math.round(value);
  const range = displayMax - displayMin;
  const [numWidth, setNumWidth] = useState(q.digits.max * 64);
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const trackRef = useRef<View>(null);
  const pct = ((displayValue - displayMin) / range) * 100;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<TextInput>(null);

  const displayRangeRef = useRef({ min: displayMin, max: displayMax });
  displayRangeRef.current = { min: displayMin, max: displayMax };
  const onDisplayChangeRef = useRef<(next: number) => void>(() => {});
  onDisplayChangeRef.current = (next) => {
    onChange(isBodyWeight && resolvedUnits === 'imperial' ? lbToKg(next) : next);
  };

  const updateFromPageX = (pageX: number) => {
    if (!trackWidth.current) return;
    const currentRange = displayRangeRef.current;
    const p = Math.max(0, Math.min(1, (pageX - trackPageX.current) / trackWidth.current));
    onDisplayChangeRef.current(Math.round(currentRange.min + p * (currentRange.max - currentRange.min)));
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
    }),
  ).current;

  const openEditor = () => {
    setDraft(String(displayValue));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitEditor = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && draft.length >= q.digits.min) {
      onDisplayChangeRef.current(Math.max(displayMin, Math.min(displayMax, n)));
    }
    setEditing(false);
  };

  return (
    <View style={{ alignItems: 'center', gap: 30, paddingTop: 14 }}>
      <Pressable onPress={openEditor} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
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

export function BirthDateWheel({
  q,
  value,
  onChange,
}: {
  q: Extract<Question, { kind: 'date' }>;
  value: Date | null;
  onChange: (d: Date) => void;
}) {
  const { t, i18n } = useTranslation('quiz');
  const seed = useRef<Date>(
    value ??
      (() => {
        const now = new Date();
        return new Date(now.getFullYear() - q.minAge, now.getMonth(), now.getDate());
      })(),
  ).current;

  const displayed = value ?? seed;
  const age = computeAge(displayed);
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
          {ageLabel.replace(/^\s*\d+\s*/, '').toUpperCase()}
        </Text>
      </View>

      <View style={{ width: '100%' }}>
        <DateWheelPicker value={displayed} locale={i18n.language} onChange={onChange} />
      </View>
    </View>
  );
}

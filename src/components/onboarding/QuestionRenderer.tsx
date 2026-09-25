import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { HudCorners } from '../ui/Card';
import { Icon, type IconName } from '../ui/Icon';
import { DateWheelPicker } from '../ui/DateWheelPicker';
import { useTheme } from '../../theme';
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
export type CompoundChoiceField = { id: string; options: OptionDef[] };
export type Question =
  | { id: string; kind: 'choice'; options: OptionDef[] }
  | { id: string; kind: 'choice-large'; options: OptionDef[] }
  | { id: string; kind: 'multi'; options: OptionDef[]; maxSelections?: number; exclusiveOption?: string }
  /** Like 'multi', but must select exactly `count` options to continue (e.g. trainingDays == days). */
  | { id: string; kind: 'multi-exact'; options: OptionDef[]; count: number }
  | { id: string; kind: 'date'; minAge: number; maxAge: number }
  | { id: string; kind: 'compound-choice'; fields: CompoundChoiceField[] }
  | {
      id: string;
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
  if (q.kind === 'multi-exact') return Array.isArray(value) && value.length === q.count;
  if (q.kind === 'compound-choice') {
    if (!value || typeof value !== 'object') return false;
    const answers = value as Record<string, unknown>;
    return q.fields.every((field) => answers[field.id] != null);
  }
  if (q.kind === 'wheel') return true;
  if (q.kind === 'date') {
    if (!(value instanceof Date)) return false;
    if (value.getTime() > Date.now()) return false;
    const age = computeAge(value);
    return age >= q.minAge && age <= q.maxAge;
  }
  return value != null;
}

export function ChoiceGrid({
  questionId,
  translationKey,
  options,
  value,
  onChange,
}: {
  questionId: string;
  translationKey?: string;
  options: OptionDef[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  return (
    <View style={{ flexDirection: 'column', gap: 10 }}>
      {options.map((o) => {
        const sel = value === o.v;
        const key = translationKey ?? String(questionId);
        const label = tLoose(`${key}.options.${o.v}.label`);
        const short = tLoose(`${key}.options.${o.v}.short`);
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: sel }}
            accessibilityLabel={label}
            style={{
              width: '100%',
              padding: 20,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: sel
                ? theme.colors.choiceSelectedBackground
                : theme.colors.choiceBackground,
              borderWidth: 1,
              borderColor: sel
                ? theme.colors.choiceSelectedBorder
                : theme.colors.choiceBorder,
              shadowColor: sel ? theme.colors.primary : 'transparent',
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
                fontFamily: theme.fonts.display,
                fontSize: 20,
                color: sel ? theme.colors.primaryEmphasis : theme.colors.choiceIndex,
                minWidth: 44,
                textTransform: 'uppercase',
              }}
            >
              {short}
            </Text>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 16, color: theme.colors.choiceText, flex: 1 }}>
              {label}
            </Text>
            {sel && <Icon name="check" size={18} color={theme.colors.primaryEmphasis} />}
          </Pressable>
        );
      })}
    </View>
  );
}

export function CompoundChoiceList({
  question,
  value,
  onChange,
}: {
  question: Extract<Question, { kind: 'compound-choice' }>;
  value: Record<string, string | null>;
  onChange: (value: Record<string, string | null>) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  return (
    <View style={{ gap: 24 }}>
      {question.fields.map((field) => {
        const translationKey = `${question.id}.fields.${field.id}`;
        return (
          <View key={field.id} style={{ gap: 10 }}>
            <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, lineHeight: 22, color: theme.colors.textPrimary }}>
              {tLoose(`${translationKey}.title`)}
            </Text>
            <ChoiceGrid
              questionId={question.id}
              translationKey={translationKey}
              options={field.options}
              value={value[field.id] ?? null}
              onChange={(next) => onChange({ ...value, [field.id]: next })}
            />
          </View>
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
  questionId: string;
  options: OptionDef[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  return (
    <View style={{ gap: 10 }}>
      {options.map((o) => {
        const sel = value === o.v;
        const label = tLoose(`${String(questionId)}.options.${o.v}.label`);
        const descriptionKey = `quiz:${String(questionId)}.options.${o.v}.description`;
        const description = i18n.exists(descriptionKey) ? tLoose(descriptionKey) : null;
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: sel }}
            accessibilityLabel={label}
            style={{
              padding: 16,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: sel
                ? theme.colors.choiceSelectedBackground
                : theme.colors.choiceBackground,
              borderWidth: 1,
              borderColor: sel
                ? theme.colors.choiceSelectedBorder
                : theme.colors.choiceBorder,
              shadowColor: sel ? theme.colors.primary : 'transparent',
              shadowOpacity: sel ? 0.4 : 0,
              shadowRadius: sel ? 16 : 0,
              shadowOffset: { width: 0, height: 0 },
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {sel && <HudCorners />}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.choiceText }}>{label}</Text>
              {description ? (
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted, marginTop: 2 }}>
                  {description}
                </Text>
              ) : null}
            </View>
            {sel && <Icon name="check" size={20} color={theme.colors.primaryEmphasis} stroke={2.8} />}
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
  exclusiveOption,
}: {
  questionId: string;
  options: OptionDef[];
  value: string[];
  onChange: (v: string[]) => void;
  /** When set, selecting beyond this count is a no-op instead of growing the array. */
  maxSelections?: number;
  exclusiveOption?: string;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const toggle = (v: string) => {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
      return;
    }
    if (v === exclusiveOption) {
      onChange([v]);
      return;
    }
    const withoutExclusive = exclusiveOption ? value.filter((item) => item !== exclusiveOption) : value;
    if (maxSelections != null && withoutExclusive.length >= maxSelections) return;
    onChange([...withoutExclusive, v]);
  };
  const GAP = 10;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {options.map((o) => {
        const sel = value.includes(o.v);
        const atLimit =
          maxSelections != null &&
          value.filter((item) => item !== exclusiveOption).length >= maxSelections &&
          !sel &&
          o.v !== exclusiveOption;
        const label = tLoose(`${String(questionId)}.options.${o.v}`);
        return (
          <Pressable
            key={o.v}
            onPress={() => toggle(o.v)}
            disabled={atLimit}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sel, disabled: atLimit }}
            accessibilityLabel={label}
            style={{
              flexBasis: '48%',
              flexGrow: 1,
              paddingVertical: 16,
              paddingHorizontal: 14,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: sel
                ? theme.colors.choiceSelectedBackground
                : theme.colors.choiceBackground,
              borderWidth: 1,
              borderColor: sel
                ? theme.colors.choiceSelectedBorder
                : theme.colors.choiceBorder,
              opacity: atLimit ? 0.4 : 1,
              shadowColor: sel ? theme.colors.primary : 'transparent',
              shadowOpacity: sel ? 0.45 : 0,
              shadowRadius: sel ? 22 : 0,
              shadowOffset: { width: 0, height: 0 },
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiSemi,
                fontSize: 14.5,
                color: theme.colors.choiceText,
                flexShrink: 1,
                flex: 1,
              }}
            >
              {label}
            </Text>
            {sel && <Icon name="check" size={18} color={theme.colors.primaryEmphasis} stroke={2.8} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontal spacing between adjacent ruler ticks, in px. Single source of
 * truth for every index<->offset conversion in the ruler picker below. */
const TICK_SPACING = 22;
const RULER_HEIGHT = 72;

export function NumberWheel({
  q,
  value,
  onChange,
}: {
  q: Extract<Question, { kind: 'wheel' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const { resolvedUnits } = useUnits();
  const tLoose = t as unknown as LooseT;
  const isBodyWeight = q.id === 'weight';
  const unit = isBodyWeight ? weightUnit(resolvedUnits) : tLoose(`${String(q.id)}.unit`);
  const displayMin = isBodyWeight && resolvedUnits === 'imperial' ? Math.round(kgToLb(q.min)) : q.min;
  const displayMax = isBodyWeight && resolvedUnits === 'imperial' ? Math.round(kgToLb(q.max)) : q.max;
  const displayValue =
    isBodyWeight && resolvedUnits === 'imperial' ? Math.round(kgToLb(value)) : Math.round(value);
  const tickCount = displayMax - displayMin + 1;
  const [numWidth, setNumWidth] = useState(q.digits.max * 64);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<TextInput>(null);

  // Root cause of the correction loop (see commit message / investigation
  // notes): `onChange` used to fire unconditionally on every scroll frame
  // and every settle, even when the resolved raw value was identical to
  // what was last emitted. Once the loop below started re-entering `settle`
  // with the same index over and over, that meant thousands of *upstream*
  // `setQuiz({...quiz})` calls (new object identity every time) cascading
  // into full re-renders of `QuestionStepScreen`/`NumberWheel` — the loop
  // fired the state update, and the state update amplified the loop's cost.
  // Deduping at this single choke point (every emission path funnels
  // through here) fixes that independently of the geometry fix below.
  const lastEmittedRef = useRef(value);
  // Keep the dedupe baseline aligned with the prop whenever it changes for
  // any reason (including our own onChange flowing back down) — otherwise a
  // stale baseline could wrongly suppress a legitimate future emission.
  useEffect(() => {
    lastEmittedRef.current = value;
  }, [value]);
  const onDisplayChangeRef = useRef<(next: number) => void>(() => {});
  onDisplayChangeRef.current = (next) => {
    const raw = isBodyWeight && resolvedUnits === 'imperial' ? lbToKg(next) : next;
    if (raw === lastEmittedRef.current) return;
    lastEmittedRef.current = raw;
    onChange(raw);
  };

  // Ruler viewport/scroll plumbing. The selection indicator is a fixed,
  // absolutely-positioned element outside the scroll content — it never
  // moves. Instead the tick strip scrolls underneath it; `index * TICK_SPACING`
  // is the single formula used for the initial position, live drag, and
  // programmatic snap-back, so there is one source of truth for the
  // index<->offset relationship (see AGENTS-provided ruler picker spec).
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const isDragging = useRef(false);
  const currentOffsetRef = useRef((displayValue - displayMin) * TICK_SPACING);
  const domainRef = useRef({ min: displayMin, max: displayMax });
  // Set whenever we programmatically animate the ruler to a known-correct
  // index (commitEditor, unit toggle, mount correction). An *animated*
  // scrollTo still fires a real native `onMomentumScrollEnd` on completion,
  // and native landing can be a few px off the JS-computed target — enough
  // to round to the neighboring tick. Without this, `settle()` would
  // re-derive the index from that imprecise landing offset and silently
  // overwrite the value we already know is correct (e.g. what the user just
  // typed) with value±1. Only real user drags/flings (no pending index)
  // should have their resting tick decided by landing offset.
  const pendingProgrammaticIndexRef = useRef<number | null>(null);

  const setDragging = (next: boolean, source: string) => {
    if (isDragging.current === next) return;
    isDragging.current = next;
  };

  const indexToDisplayValue = (index: number) =>
    Math.max(displayMin, Math.min(displayMax, displayMin + index));

  const commitOffset = (offsetX: number) => {
    const index = Math.round(offsetX / TICK_SPACING);
    const clampedIndex = Math.max(0, Math.min(tickCount - 1, index));
    onDisplayChangeRef.current(indexToDisplayValue(clampedIndex));
  };

  // `animated` is only ever true here for externally-driven repositioning
  // (unit toggle, text edit, initial-mount correction) — NEVER for the
  // scroll-end correction in `settle` below. That distinction is the fix
  // for the correction loop: see the comment there.
  const snapTo = (index: number, animated: boolean, source: string) => {
    const offset = index * TICK_SPACING;
    currentOffsetRef.current = offset;
    pendingProgrammaticIndexRef.current = animated ? index : null;
    scrollRef.current?.scrollTo({ x: offset, animated });
  };

  // Keep the ruler in sync when the value changes for a reason other than
  // the user's own drag (unit toggle switching kg<->lb, direct text entry,
  // or the initial mount) — never fight an in-progress gesture.
  useEffect(() => {
    const domainChanged = domainRef.current.min !== displayMin || domainRef.current.max !== displayMax;
    domainRef.current = { min: displayMin, max: displayMax };
    if (isDragging.current) return;
    const expectedIndex = displayValue - displayMin;
    const actualIndex = currentOffsetRef.current / TICK_SPACING;
    if (domainChanged || Math.abs(actualIndex - expectedIndex) > 0.5) {
      snapTo(expectedIndex, !domainChanged, 'sync-effect');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, displayMin, displayMax]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    currentOffsetRef.current = offsetX;
    commitOffset(offsetX);
  };

  // ROOT CAUSE FIX — this used to call `scrollTo({ animated: true })` to
  // correct a misaligned landing offset. An *animated* scrollTo runs its
  // own native deceleration animation, and finishing that animation fires
  // `onMomentumScrollEnd` again (same as a user-driven fling) — which
  // re-entered this exact function. Device logs showed the native scroll
  // view consistently landing ~5.7px short of the JS-computed target
  // (`index * TICK_SPACING`, assuming an idealized real-number geometry)
  // instead of `snapToInterval`'s own native-rounded snap grid, and neither
  // side had any tolerance for the other — so it corrected forever, calling
  // `onChange` (and cascading a full re-render) on every iteration.
  //
  // Fix has two parts:
  //  1. `snapToInterval` (a *second*, independently-computed native snap
  //     system) is removed below — there is now exactly one system decid-
  //     ing the final resting tick: this JS code, using the same
  //     `index * TICK_SPACING` formula as the rest of the component.
  //  2. The corrective snap here always uses `animated: false`. It is
  //     therefore instantaneous and does not start a new deceleration
  //     animation, so it cannot itself trigger another
  //     `onMomentumScrollEnd` — the recursion is impossible by
  //     construction, not merely guarded against.
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>, source: string) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    setDragging(false, `settle:${source}`);
    // If this momentum-end followed our own animated snapTo, trust the
    // index we already know is correct rather than re-deriving it from the
    // (possibly imprecise) native landing offset — see the ref comment.
    const pendingIndex = pendingProgrammaticIndexRef.current;
    pendingProgrammaticIndexRef.current = null;
    const index =
      pendingIndex ?? Math.max(0, Math.min(tickCount - 1, Math.round(offsetX / TICK_SPACING)));
    if (Math.abs(offsetX - index * TICK_SPACING) > 0.5) {
      snapTo(index, false, `settle:${source}:correction`);
    } else {
      currentOffsetRef.current = offsetX;
    }
    onDisplayChangeRef.current(indexToDisplayValue(index));
  };

  const openEditor = () => {
    setDraft(String(displayValue));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitEditor = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && draft.length >= q.digits.min) {
      const clamped = Math.max(displayMin, Math.min(displayMax, n));
      onDisplayChangeRef.current(clamped);
      snapTo(clamped - displayMin, true, 'commitEditor');
    }
    setEditing(false);
  };

  const sidePadding = viewportWidth > 0 ? viewportWidth / 2 - TICK_SPACING / 2 : 0;
  const ticks = Array.from({ length: tickCount }, (_, i) => displayMin + i);
  const initialOffset = Math.max(0, Math.min(tickCount - 1, displayValue - displayMin)) * TICK_SPACING;

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
              fontFamily: theme.fonts.display,
              fontSize: 120,
              color: theme.colors.textPrimary,
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
              fontFamily: theme.fonts.display,
              fontSize: 120,
              color: theme.colors.textPrimary,
              transform: [{ skewX: '-8deg' }],
            }}
          >
            {displayValue}
          </Text>
        )}
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, letterSpacing: 2, color: theme.colors.textFaint }}>
          {unit}
        </Text>
      </Pressable>

      <View
        onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
        style={{ width: '100%', height: RULER_HEIGHT, justifyContent: 'center' }}
      >
        {viewportWidth > 0 && (
          <ScrollView
            ref={scrollRef}
            // Explicit height so the ScrollView's own hit-testable native frame
            // fills the whole touch target (previously it shrank to the ~30px
            // tick row, since a horizontal ScrollView with no style.height sizes
            // its main axis to content — leaving a dead zone above/below inside
            // this wrapper that never reached the ScrollView at all).
            style={{ height: RULER_HEIGHT, width: '100%' }}
            horizontal
            showsHorizontalScrollIndicator={false}
            // No `snapToInterval` here on purpose — see the comment on
            // `settle` above. It used to run as a second, independent snap
            // system alongside our own JS correction; the two disagreed by
            // a few px (native's own pixel-grid-rounded snap vs. our
            // idealized `index * TICK_SPACING`), which combined with an
            // *animated* correction caused an infinite `onMomentumScrollEnd`
            // loop. `decelerationRate` alone still gives the natural fling
            // feel; the exact resting tick is decided once, in JS, in
            // `settle`.
            decelerationRate="fast"
            contentOffset={{ x: initialOffset, y: 0 }}
            contentContainerStyle={{
              paddingHorizontal: sidePadding,
              flexDirection: 'row',
              alignItems: 'center',
              height: RULER_HEIGHT,
            }}
            onScrollBeginDrag={() => setDragging(true, 'onScrollBeginDrag')}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onScrollEndDrag={(e) => settle(e, 'onScrollEndDrag')}
            onMomentumScrollEnd={(e) => settle(e, 'onMomentumScrollEnd')}
            // Defense in depth: guarantee `isDragging` can never stay stuck true.
            // It only gates the resync effect (never blocks native scrolling
            // itself), but a gesture that ends without a matching scroll-end
            // callback — e.g. terminated by an ancestor responder — must still
            // release it.
            onTouchEnd={() => setDragging(false, 'onTouchEnd')}
            onTouchCancel={() => setDragging(false, 'onTouchCancel')}
          >
            {ticks.map((tickValue) => (
              <View
                key={tickValue}
                style={{ width: TICK_SPACING, alignItems: 'center', justifyContent: 'center', height: 30 }}
              >
                <View
                  style={{
                    width: 2,
                    height: tickValue % 5 === 0 ? 30 : 14,
                    backgroundColor: theme.colors.choiceTick,
                    transform: [{ skewX: '-16deg' }],
                  }}
                />
              </View>
            ))}
          </ScrollView>
        )}
        {/* The tick under the fixed indicator is always the selected value by
            construction (see the sync effect + settle above), so "already
            passed" vs "upcoming" is always exactly the left/right half of
            this viewport — a static dim overlay is enough, no per-frame
            recoloring of the (up to ~300) tick views. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 8,
            bottom: 8,
            left: '50%',
            right: 0,
            backgroundColor: theme.colors.background,
            opacity: 0.6,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 8,
            bottom: 8,
            left: '50%',
            marginLeft: -1.5,
            width: 3,
            backgroundColor: theme.colors.choiceIndicator,
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.9,
            shadowRadius: 8,
            transform: [{ skewX: '-16deg' }],
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, color: theme.colors.textFaint }}>
          {displayMin}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, color: theme.colors.textFaint }}>
          {t('progress.wheelHint').toUpperCase()}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, color: theme.colors.textFaint }}>
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
  const { theme } = useTheme();
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
            fontFamily: theme.fonts.display,
            fontSize: 100,
            color: theme.colors.textPrimary,
            transform: [{ skewX: '-8deg' }],
            textShadowColor: theme.colors.primaryGlow,
            textShadowRadius: 30,
            textShadowOffset: { width: 0, height: 0 },
          }}
        >
          {age}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, letterSpacing: 2, color: theme.colors.textFaint }}>
          {ageLabel.replace(/^\s*\d+\s*/, '').toUpperCase()}
        </Text>
      </View>

      <View style={{ width: '100%' }}>
        <DateWheelPicker value={displayed} locale={i18n.language} onChange={onChange} />
      </View>
    </View>
  );
}

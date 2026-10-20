import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui/Icon';
import { DateWheelPicker } from '../ui/DateWheelPicker';
import { AJ_PERCH_RADIO } from '../aj/ajMomentTiming';
import { useTheme } from '../../theme';
import { computeAge } from '../../lib/ageCalculator';
import { useUnits } from '../../state/UnitsContext';
import { INCHES_PER_FOOT } from '../../units/heightConversions';
import { toggleMultiSelection } from '../../onboarding/multiSelection';
import {
  formatDisplayValue,
  majorTickEvery,
  supportsKeyboardEntry,
  toCanonicalValue,
  toDisplayRange,
  toDisplayValue,
  unitForPreference,
  unitLabelKey,
  type DisplayUnit,
  type MeasurementKind,
} from './unitDisplay';

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
  | { id: string; kind: 'choice'; options: OptionDef[]; showOptionShort?: boolean }
  | { id: string; kind: 'choice-large'; options: OptionDef[] }
  | {
      id: string;
      kind: 'multi';
      options: OptionDef[];
      maxSelections?: number;
      exclusiveOption?: string;
      layout?: 'grid' | 'list';
    }
  /** Like 'multi', but must select exactly `count` options to continue (e.g. trainingDays == days). */
  | { id: string; kind: 'multi-exact'; options: OptionDef[]; count: number }
  | { id: string; kind: 'date'; minAge: number; maxAge: number }
  | { id: string; kind: 'compound-choice'; fields: CompoundChoiceField[]; showOptionShort?: boolean }
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

/**
 * A single answer row in the approved design: no card, no border box — just a
 * label, an optional description and a radio, separated from its neighbours by
 * a hairline. The list draws the top hairline; each row draws its own bottom
 * one, so a run of rows reads as one ruled block.
 *
 * `density` is a function of how many options the question has (and of the
 * screen's height — see `QuestionStepScreen`): single choice is never allowed
 * to scroll, because the selection animation lifts the chosen row to the
 * centre of the screen and a row that scrolled out of view has nowhere to lift
 * from. Tightening the rows is how a ten-option question fits instead.
 */
export interface ChoiceRowLift {
  /** How far the row travels to reach the vertical centre of the screen. */
  dy: number;
  /** How much it grows on the way — see `liftScale` in `ajFunnelChoreography`. */
  scale: number;
}

function ChoiceRow({
  label,
  description,
  selected,
  dense,
  /** True while AJ is perched on this row's radio — the radio shrinks out from under him. */
  occupied,
  lift,
  sinking,
  reduceMotion,
  onPress,
  onLayout,
  disabled,
}: {
  label: string;
  description?: string | null;
  selected: boolean;
  dense?: boolean;
  occupied?: boolean;
  lift?: ChoiceRowLift | null;
  sinking?: boolean;
  reduceMotion?: boolean;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const verticalPadding = dense ? 12 : description ? 14 : 18;

  // One shared value per role, driven natively. `rise` runs the chosen row's
  // journey to the centre; `dismiss` fades the rows that were not chosen.
  const rise = useSharedValue(0);
  const dismiss = useSharedValue(0);
  const liftDy = lift?.dy ?? 0;
  const liftScale = lift?.scale ?? 1;
  const lifting = lift != null;

  useEffect(() => {
    if (!lifting) {
      cancelAnimation(rise);
      rise.value = 0;
      return () => cancelAnimation(rise);
    }
    if (reduceMotion) {
      // Reduce Motion removes the journey entirely rather than shortening it:
      // the point of the move was to be watched.
      rise.value = 0;
      return () => cancelAnimation(rise);
    }
    const [b1, b2, b3, b4] = AJ_PERCH_RADIO.liftBezier;
    const easing = Easing.bezier(b1, b2, b3, b4);
    const mid = AJ_PERCH_RADIO.liftMidProgress;
    rise.value = 0;
    // Two legs rather than one: the design's keyframe at 28% is a real stop
    // (the row dips into a smaller, dimmer state before committing upward),
    // and a single eased timing across the whole distance would smooth it away.
    rise.value = withSequence(
      withTiming(mid, { duration: AJ_PERCH_RADIO.liftMs * mid, easing }),
      withTiming(1, { duration: AJ_PERCH_RADIO.liftMs * (1 - mid), easing }),
    );
    return () => cancelAnimation(rise);
  }, [lifting, reduceMotion, rise]);

  useEffect(() => {
    cancelAnimation(dismiss);
    dismiss.value = sinking
      ? withTiming(1, { duration: reduceMotion ? 0 : AJ_PERCH_RADIO.sinkMs })
      : 0;
    return () => cancelAnimation(dismiss);
  }, [sinking, reduceMotion, dismiss]);

  const motionStyle = useAnimatedStyle(() => {
    const p = rise.value;
    const stops = [0, AJ_PERCH_RADIO.liftMidProgress, 1];
    const translateY = interpolate(
      p,
      stops,
      [0, liftDy * AJ_PERCH_RADIO.liftMidTranslateFraction, liftDy],
    );
    const scale = interpolate(p, stops, [1, AJ_PERCH_RADIO.liftMidScale, liftScale]);
    const riseOpacity = interpolate(p, stops, [1, AJ_PERCH_RADIO.liftMidOpacity, 1]);
    return {
      opacity: riseOpacity * (1 - dismiss.value),
      transform: [
        { translateY: translateY + dismiss.value * AJ_PERCH_RADIO.sinkTranslateY },
        { scale },
      ],
    };
  });

  return (
    <Animated.View
      // The travelling row has to pass over its neighbours, not under them.
      style={[lifting ? { zIndex: 4 } : null, motionStyle]}
      pointerEvents={lifting || sinking ? 'none' : 'auto'}
      // Measured HERE, not on the `Pressable` inside. `onLayout` reports a
      // box relative to the direct parent, and the Pressable's parent is this
      // wrapper — so measuring it would report y = 0 for every row, and the
      // lift would compute the same travel for all of them (correct only for
      // the first one, which really is at y = 0). This view is the list's own
      // child, so its y is the row's real offset within the list.
      //
      // Transforms do not affect it: React Native lays out first and
      // transforms after, so this stays the row's resting position even
      // mid-animation.
      onLayout={onLayout}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, disabled }}
        accessibilityLabel={label}
        accessibilityHint={description ?? undefined}
        style={{
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: verticalPadding,
          paddingHorizontal: 2,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.divider,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontFamily: theme.fonts.uiMed,
              fontSize: dense ? 16 : 17,
              lineHeight: dense ? 21 : 22,
              letterSpacing: -0.2,
              color: selected ? theme.colors.primaryEmphasis : theme.colors.choiceText,
            }}
          >
            {label}
          </Text>
          {description ? (
            <Text
              style={{
                fontFamily: theme.fonts.ui,
                fontSize: 13,
                lineHeight: 18,
                color: theme.colors.textOptionDescription,
                marginTop: 3,
              }}
            >
              {description}
            </Text>
          ) : null}
        </View>
        <ChoiceRadio selected={selected} occupied={occupied} />
      </Pressable>
    </Animated.View>
  );
}

/** The 22pt radio at the end of a choice row. Empty ring, or filled accent with a check. */
function ChoiceRadio({ selected, occupied }: { selected: boolean; occupied?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        // AJ lands exactly here, so the radio gets out of the way rather than
        // being covered up.
        opacity: occupied ? 0 : 1,
        transform: occupied ? [{ scale: AJ_PERCH_RADIO.radioExitScale }] : undefined,
        borderWidth: selected ? 0 : 1.5,
        borderColor: theme.colors.radioRing,
        backgroundColor: selected ? theme.colors.primary : 'transparent',
        shadowColor: selected ? theme.colors.primaryGlowBright : 'transparent',
        shadowOpacity: selected ? 1 : 0,
        shadowRadius: selected ? 12 : 0,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      {selected && !occupied ? (
        <Icon name="check" size={12} color={theme.colors.primaryForeground} stroke={2.6} />
      ) : null}
    </View>
  );
}

export function ChoiceGrid({
  questionId,
  translationKey,
  options,
  value,
  onChange,
  /**
   * Kept for contract stability — every caller still passes
   * `question.showOptionShort`. The approved design has no slot for the short
   * code this used to render as a display-font badge: `choice` and
   * `choice-large` are the same ruled row there, distinguished only by whether
   * the option carries a description. Recorded as a difference from the
   * previous visual, not from the design.
   */
  showOptionShort: _showOptionShort,
  dense,
  occupiedValue,
  onRowLayout,
  liftValue,
  lift,
  reduceMotion,
  labelFor,
  descriptionFor,
}: {
  questionId: string;
  translationKey?: string;
  options: OptionDef[];
  value: string | null;
  onChange: (v: string) => void;
  showOptionShort?: boolean;
  dense?: boolean;
  /** The value AJ is currently perched on, if any. */
  occupiedValue?: string | null;
  onRowLayout?: (value: string, event: LayoutChangeEvent) => void;
  /** The value whose row is travelling to the centre; the rest sink. */
  liftValue?: string | null;
  lift?: ChoiceRowLift | null;
  reduceMotion?: boolean;
  /** See `ChoiceList`'s `labelFor` — same reason, same contract. */
  labelFor?: (value: string) => string;
  descriptionFor?: (value: string) => string | null;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const key = translationKey ?? String(questionId);
  return (
    <View
      style={{
        borderTopWidth: 1,
        // The hairline above the first row belongs to the list, not to any
        // row, so it has to go when the list breaks apart.
        borderTopColor: liftValue ? 'transparent' : theme.colors.divider,
      }}
    >
      {options.map((o) => {
        const sel = value === o.v;
        const label = labelFor ? labelFor(o.v) : tLoose(`${key}.options.${o.v}.label`);
        const descriptionKey = `quiz:${key}.options.${o.v}.description`;
        const description = descriptionFor
          ? descriptionFor(o.v)
          : i18n.exists(descriptionKey) ? tLoose(descriptionKey) : null;
        return (
          <ChoiceRow
            key={o.v}
            label={label}
            description={description}
            selected={sel}
            dense={dense}
            occupied={occupiedValue === o.v}
            lift={liftValue === o.v ? lift ?? null : null}
            sinking={liftValue != null && liftValue !== o.v}
            reduceMotion={reduceMotion}
            onPress={() => onChange(o.v)}
            onLayout={onRowLayout ? (event) => onRowLayout(o.v, event) : undefined}
          />
        );
      })}
    </View>
  );
}

/**
 * A compound field's answer: a pill that fills with accent when chosen. The
 * one control in the questionnaire that is still a filled box rather than a
 * ruled row — a compound step asks several short questions at once, and a
 * ruled list per field would read as four unrelated questionnaires stacked.
 */
function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        paddingVertical: 11,
        paddingHorizontal: 15,
        borderRadius: theme.radii.pill,
        backgroundColor: selected
          ? theme.colors.choiceSelectedBackground
          : theme.colors.choiceBackground,
        borderWidth: 1,
        borderColor: selected
          ? theme.colors.choiceSelectedBorder
          : theme.colors.choiceBorder,
        shadowColor: selected ? theme.colors.primaryGlowBright : 'transparent',
        shadowOpacity: selected ? 1 : 0,
        shadowRadius: selected ? 16 : 0,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.uiMed,
          fontSize: 14.5,
          color: selected ? theme.colors.primaryForeground : theme.colors.choiceText,
        }}
      >
        {label}
      </Text>
    </Pressable>
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
    <View style={{ gap: 26 }}>
      {question.fields.map((field) => {
        const translationKey = `${question.id}.fields.${field.id}`;
        return (
          <View key={field.id}>
            <Text
              style={{
                fontFamily: theme.fonts.uiSemi,
                fontSize: 15.5,
                lineHeight: 21,
                color: theme.colors.textPrimary,
                marginBottom: 12,
              }}
            >
              {tLoose(`${translationKey}.title`)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {field.options.map((option) => (
                <ChoiceChip
                  key={option.v}
                  label={tLoose(`${translationKey}.options.${option.v}.label`)}
                  selected={(value[field.id] ?? null) === option.v}
                  onPress={() => onChange({ ...value, [field.id]: option.v })}
                />
              ))}
            </View>
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
  dense,
  occupiedValue,
  onRowLayout,
  liftValue,
  lift,
  reduceMotion,
  labelFor,
  descriptionFor,
}: {
  questionId: string;
  options: OptionDef[];
  value: string | null;
  onChange: (v: string) => void;
  dense?: boolean;
  /** The value AJ is currently perched on, if any. */
  occupiedValue?: string | null;
  onRowLayout?: (value: string, event: LayoutChangeEvent) => void;
  /** The value whose row is travelling to the centre; the rest sink. */
  liftValue?: string | null;
  lift?: ChoiceRowLift | null;
  reduceMotion?: boolean;
  /**
   * Resolves an option's copy, for callers whose strings do not live under
   * `quiz:<questionId>.options.*` — the nutrition steps keep their own
   * namespace and key shape. Omit for every Quiz-keyed question.
   */
  labelFor?: (value: string) => string;
  descriptionFor?: (value: string) => string | null;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: liftValue ? 'transparent' : theme.colors.divider,
      }}
    >
      {options.map((o) => {
        const sel = value === o.v;
        const label = labelFor ? labelFor(o.v) : tLoose(`${String(questionId)}.options.${o.v}.label`);
        const descriptionKey = `quiz:${String(questionId)}.options.${o.v}.description`;
        const description = descriptionFor
          ? descriptionFor(o.v)
          : i18n.exists(descriptionKey) ? tLoose(descriptionKey) : null;
        return (
          <ChoiceRow
            key={o.v}
            label={label}
            description={description}
            selected={sel}
            dense={dense}
            occupied={occupiedValue === o.v}
            lift={liftValue === o.v ? lift ?? null : null}
            sinking={liftValue != null && liftValue !== o.v}
            reduceMotion={reduceMotion}
            onPress={() => onChange(o.v)}
            onLayout={onRowLayout ? (event) => onRowLayout(o.v, event) : undefined}
          />
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
  layout = 'grid',
  dense,
  /** Fired after the selection changes, so AJ can react to the gesture. */
  onToggled,
  labelFor,
}: {
  questionId: string;
  options: OptionDef[];
  value: string[];
  onChange: (v: string[]) => void;
  /** When set, selecting beyond this count is a no-op instead of growing the array. */
  maxSelections?: number;
  exclusiveOption?: string;
  layout?: 'grid' | 'list';
  dense?: boolean;
  onToggled?: (option: string, selected: boolean) => void;
  /** See `ChoiceList`'s `labelFor` — same reason, same contract. */
  labelFor?: (value: string) => string;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const toggle = (v: string) => {
    const next = toggleMultiSelection(value, v, { exclusiveOption, maxSelections });
    onChange(next);
    onToggled?.(v, next.includes(v));
  };
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
      {options.map((o) => {
        const sel = value.includes(o.v);
        const atLimit =
          maxSelections != null &&
          value.filter((item) => item !== exclusiveOption).length >= maxSelections &&
          !sel &&
          o.v !== exclusiveOption;
        const label = labelFor ? labelFor(o.v) : tLoose(`${String(questionId)}.options.${o.v}`);
        return (
          <Pressable
            key={o.v}
            onPress={() => toggle(o.v)}
            disabled={atLimit}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sel, disabled: atLimit }}
            accessibilityLabel={label}
            style={{
              width: '100%',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: dense ? 12 : 18,
              paddingHorizontal: 2,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.divider,
              // At the limit the unreachable options recede rather than
              // disappear: the user still needs to see what they traded away.
              opacity: atLimit ? 0.35 : 1,
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiMed,
                fontSize: dense ? 16 : 17,
                lineHeight: dense ? 21 : 22,
                letterSpacing: -0.2,
                color: sel ? theme.colors.primaryEmphasis : theme.colors.choiceText,
                flex: 1,
              }}
            >
              {label}
            </Text>
            <ChoiceRadio selected={sel} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontal spacing between adjacent ruler ticks, in px. Single source of
 * truth for every index<->offset conversion in the ruler picker below. */
const TICK_SPACING = 22;
const RULER_HEIGHT = 56;
/** Tick heights, major (every fifth) and minor. */
const TICK_MAJOR_HEIGHT = 29;
const TICK_MINOR_HEIGHT = 14;

export function NumberWheel({
  q,
  value,
  onChange,
  /**
   * Fired as the value moves, with its position in [0, 1] across the range and
   * whether it has hit an end. Drives AJ's lean over the ruler; purely
   * presentational, and never gates the value itself.
   */
  onLean,
  bodyWeight,
  measurement,
  displayUnit,
  compact = false,
}: {
  q: Extract<Question, { kind: 'wheel' }>;
  value: number;
  onChange: (v: number) => void;
  onLean?: (pct: number, atEdge: boolean) => void;
  /**
   * Whether this ruler measures a body weight, and therefore follows the
   * user's kg/lb preference. Defaults to the training questionnaire's own
   * `weight` step; the nutrition target-weight step opts in explicitly
   * rather than being matched by id from inside this module.
   */
  bodyWeight?: boolean;
  /**
   * Which unit pair this ruler offers, when it is a body measurement. The
   * step owns the selection (so the two weight steps can share one) and
   * passes the chosen unit down as `displayUnit`; this component only
   * renders in it.
   */
  measurement?: MeasurementKind;
  displayUnit?: DisplayUnit;
  /** Short viewports shrink the oversized number. */
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const { resolvedUnits } = useUnits();
  const tLoose = t as unknown as LooseT;
  const isBodyWeight = bodyWeight ?? q.id === 'weight';
  // A ruler is unit-switchable when the step says which measurement it is.
  // Everything else (pregnancy weeks, and any future plain count) keeps its
  // single i18n unit label and the old code path exactly.
  const kind: MeasurementKind | null = measurement ?? (isBodyWeight ? 'weight' : null);
  const unit: DisplayUnit | null = kind
    ? displayUnit ?? unitForPreference(kind, resolvedUnits)
    : null;
  const unitKey = unit ? unitLabelKey(unit) : null;
  const unitLabel = unit
    ? unitKey
      ? t(unitKey as never)
      : ''
    : tLoose(`${String(q.id)}.unit`);
  const bounds = { min: q.min, max: q.max };
  const range = unit ? toDisplayRange(q.min, q.max, unit) : bounds;
  const displayMin = range.min;
  const displayMax = range.max;
  const displayValue = unit ? toDisplayValue(value, unit) : Math.round(value);
  const toCanonical = (next: number) =>
    unit ? toCanonicalValue(next, unit, bounds) : Math.round(next);
  const formatDisplay = (next: number) =>
    unit ? formatDisplayValue(next, unit) : String(next);
  const keyboardEntry = unit ? supportsKeyboardEntry(unit) : true;
  const tickCount = displayMax - displayMin + 1;
  const [numWidth, setNumWidth] = useState(q.digits.max * 64);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<TextInput>(null);
  const numberFontSize = compact ? 84 : 100;

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
  /**
   * Set while the ruler is being repositioned by us rather than by a finger
   * — switching unit changes the whole domain, and the resulting
   * `scrollTo` makes the native view emit `onScroll` as it moves. Those
   * frames must not be mistaken for the user choosing a value: converting
   * the landing tick back would rewrite the stored answer (179 cm shows as
   * 5′10″, which converts back to 178 cm), which is exactly the drift a
   * unit switch is required not to cause.
   */
  const repositioningRef = useRef(false);

  const onDisplayChangeRef = useRef<(next: number) => void>(() => {});
  onDisplayChangeRef.current = (next) => {
    if (repositioningRef.current) return;
    // Always a whole cm / whole kg: the stored answer keeps the exact format
    // it had before this step offered any unit choice.
    const raw = toCanonical(next);
    if (raw === lastEmittedRef.current) return;
    lastEmittedRef.current = raw;
    // Lean is reported from the same dedupe choke point as the value itself,
    // so AJ tips once per tick crossed and never once per scroll frame.
    const span = displayMax - displayMin;
    if (span > 0) {
      onLeanRef.current?.(
        (next - displayMin) / span,
        next <= displayMin || next >= displayMax,
      );
    }
    onChange(raw);
  };
  const onLeanRef = useRef(onLean);
  onLeanRef.current = onLean;

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
      // A domain change is a unit switch. Hold emission closed across the
      // scroll it causes, then reopen once those frames have flushed — the
      // value is unchanged, only the ruler under it is new.
      if (domainChanged) {
        repositioningRef.current = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            repositioningRef.current = false;
          });
        });
      }
      snapTo(expectedIndex, !domainChanged, 'sync-effect');
    }
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
    // Feet-and-inches is a composed display, not something a numeric keypad
    // can produce — that mode is ruler-only, as in the design.
    if (!keyboardEntry) return;
    setDraft(String(displayValue));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Switching unit while the keypad is open discards the half-typed number:
  // it was entered in the unit that is no longer showing.
  useEffect(() => {
    setEditing(false);
  }, [unit]);

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
  // Design: a taller tick every fifth unit, except in feet where the natural
  // grouping is twelve (one per whole foot).
  const majorEvery = unit ? majorTickEvery(unit) : 5;
  const initialOffset = Math.max(0, Math.min(tickCount - 1, displayValue - displayMin)) * TICK_SPACING;
  // Screen readers get the unit spelled out, and feet broken into its two
  // parts, rather than the glyphs the sighted display uses.
  const spokenValue = unit
    ? unit === 'ft'
      ? t('units.spoken.ft', {
          feet: Math.floor(displayValue / INCHES_PER_FOOT),
          inches: displayValue % INCHES_PER_FOOT,
        })
      : t(`units.spoken.${unit}` as never, { value: displayValue })
    : `${displayValue} ${unitLabel}`;

  const adjustBy = (delta: number) => {
    const next = Math.max(displayMin, Math.min(displayMax, displayValue + delta));
    if (next === displayValue) return;
    onDisplayChangeRef.current(next);
    snapTo(next - displayMin, true, 'accessibilityAction');
  };

  return (
    <View style={{ alignItems: 'center', paddingTop: 14 }}>
      <Pressable
        onPress={openEditor}
        disabled={!keyboardEntry}
        accessibilityRole="adjustable"
        accessibilityLabel={spokenValue}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') adjustBy(1);
          if (event.nativeEvent.actionName === 'decrement') adjustBy(-1);
        }}
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
              fontFamily: theme.fonts.display,
              fontSize: numberFontSize,
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
              fontSize: numberFontSize,
              color: theme.colors.textPrimary,
              transform: [{ skewX: '-8deg' }],
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatDisplay(displayValue)}
          </Text>
        )}
        {/* Feet carries its units inside the number itself (5′10″), so it
            gets no label beside it — same as the design. */}
        {unitLabel ? (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 13,
              letterSpacing: 3,
              color: theme.colors.textSubtleStrong,
            }}
          >
            {unitLabel}
          </Text>
        ) : null}
      </Pressable>

      <View
        onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
        style={{ width: '100%', height: RULER_HEIGHT, justifyContent: 'center', marginTop: 34 }}
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
            onScrollBeginDrag={() => {
              // A finger on the ruler always wins over an in-flight
              // reposition, so a switch immediately followed by a drag is
              // never swallowed.
              repositioningRef.current = false;
              setDragging(true, 'onScrollBeginDrag');
            }}
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
                style={{
                  width: TICK_SPACING,
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: TICK_MAJOR_HEIGHT,
                }}
              >
                <View
                  style={{
                    width: 2.5,
                    height: tickValue % majorEvery === 0 ? TICK_MAJOR_HEIGHT : TICK_MINOR_HEIGHT,
                    backgroundColor: theme.colors.rulerTickPassed,
                    transform: [{ skewX: '-14deg' }],
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
            shadowColor: theme.colors.primaryEmphasis,
            shadowOpacity: 0.9,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          marginTop: 14,
        }}
      >
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, letterSpacing: 1.6, color: theme.colors.textLabelFaint }}>
          {formatDisplay(displayMin)}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, letterSpacing: 1.6, color: theme.colors.textLabelFaint }}>
          {t('progress.wheelHint').toUpperCase()}
        </Text>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, letterSpacing: 1.6, color: theme.colors.textLabelFaint }}>
          {formatDisplay(displayMax)}
        </Text>
      </View>
    </View>
  );
}

export function BirthDateWheel({
  q,
  value,
  onChange,
  /** Fired on every wheel change, so AJ can glance down and nod. */
  onPoke,
}: {
  q: Extract<Question, { kind: 'date' }>;
  value: Date | null;
  onChange: (d: Date) => void;
  onPoke?: () => void;
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

  const handleChange = (next: Date) => {
    onChange(next);
    onPoke?.();
  };

  return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Text
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 84,
            color: theme.colors.textPrimary,
            transform: [{ skewX: '-8deg' }],
            textShadowColor: theme.colors.primaryGlowStrong,
            textShadowRadius: 28,
            textShadowOffset: { width: -6, height: 6 },
          }}
        >
          {age}
        </Text>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 11.5,
            letterSpacing: 2,
            color: theme.colors.textSubtleStrong,
          }}
        >
          {ageLabel.replace(/^\s*\d+\s*/, '').toUpperCase()}
        </Text>
      </View>

      <View style={{ width: '100%' }}>
        <DateWheelPicker value={displayed} locale={i18n.language} onChange={handleChange} />
      </View>
    </View>
  );
}

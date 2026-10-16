import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { Icon, type IconName } from '../ui/Icon';

/**
 * Visual-only design system for the redesigned Nutrição tab (docs/Prompt
 * Claude Code - Tela Nutricao.md). Deliberately a fixed dark palette, not
 * `theme.colors.*` — same precedent as `EvoRing.tsx`/`HomeEvoTicker.tsx`
 * (a "poster" surface that doesn't follow the light/dark theme switch).
 * Nutrition-exclusive: never imported by Home, Treino or Evolução, and
 * never edits any shared component those screens use.
 */
export const NU = {
  bg: '#020010',
  panel: '#0b0922',
  blue: '#0b70f9',
  blueHi: '#4da3ff',
  blueGlow: 'rgba(11,112,249,0.45)',
  warn: '#ffb454',
  danger: '#ff8a80',
  white: '#ffffff',
  strong: 'rgba(255,255,255,0.88)',
  secondary: 'rgba(255,255,255,0.65)',
  faint: 'rgba(255,255,255,0.45)',
  legend: 'rgba(255,255,255,0.38)',
  faintest: 'rgba(255,255,255,0.3)',
  hairline: 'rgba(255,255,255,0.07)',
  surfaceSubtle: 'rgba(255,255,255,0.03)',
  surfaceSubtleStrong: 'rgba(255,255,255,0.06)',
  track: 'rgba(255,255,255,0.07)',
} as const;

export function nuMacroStatusColor(status: 'below' | 'near' | 'above'): string {
  return status === 'above' ? NU.warn : NU.secondary;
}

/** `aj2-label` — mono section legend, 10px/letter-spacing 1.6, uppercase. */
export function NuCap({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Text style={[{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: NU.legend, textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}

/** Hairline <View> rule, full width of its container. */
export function NuHairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: NU.hairline }, style]} />;
}

/**
 * `NuRing` — same no-internal-state draw math as `src/components/home/EvoRing.tsx`
 * (12 o'clock start via -90deg rotation, strokeDasharray/-offset trick), plus
 * the entrance animation and `dashed`/`faint` variants this design calls for.
 * Deliberately a separate component, never a change to `EvoRing.tsx` itself.
 */
export function NuRing({
  size,
  stroke,
  pct,
  color = NU.blueHi,
  dashed = false,
  faint = false,
  accessibilityLabel,
  children,
}: {
  size: number;
  stroke: number;
  /** 0-100+. Clamped to [0,100] for the drawn arc; values over 110 switch to the warn color. */
  pct: number;
  color?: string;
  dashed?: boolean;
  faint?: boolean;
  accessibilityLabel?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = useRef(new Animated.Value(0)).current;
  const [dashOffset, setDashOffset] = useState(circumference);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(100, pct));
    const id = shown.addListener(({ value }) => setDashOffset(circumference * (1 - value / 100)));
    Animated.timing(shown, {
      toValue: clamped,
      duration: 1300,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: false,
    }).start();
    return () => shown.removeListener(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, circumference]);

  const resolvedColor = pct > 110 ? NU.warn : color;

  return (
    <View
      style={{ width: size, height: size, opacity: faint ? 0.4 : 1 }}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.max(0, Math.min(100, pct))) }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={dashed ? 'rgba(255,255,255,0.22)' : NU.track}
          strokeWidth={dashed ? 1.2 : stroke}
          strokeDasharray={dashed ? '2 4' : undefined}
        />
        {pct > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={resolvedColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
          />
        ) : null}
      </Svg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

/** `.aj2-cta` — primary (gradient) and ghost button, Nutrição-only (does not touch the shared `CtaButton`). */
export function NuButton({
  children, onPress, ghost, disabled, icon, style, accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  ghost?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const a11y = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
    accessibilityState: { disabled: Boolean(disabled) },
  };
  if (ghost) {
    return (
      <Pressable
        {...a11y}
        onPress={onPress}
        disabled={disabled}
        style={[
          {
            minHeight: 50, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 14,
            backgroundColor: NU.surfaceSubtleStrong, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: disabled ? 0.4 : 1,
          },
          style,
        ]}
      >
        {icon ? <Icon name={icon} size={15} color="rgba(255,255,255,0.75)" /> : null}
        {typeof children === 'string' ? (
          <Text style={{ color: NU.white, fontFamily: 'Archivo_600SemiBold', fontSize: 14.5 }}>{children}</Text>
        ) : children}
      </Pressable>
    );
  }
  return (
    <Pressable {...a11y} onPress={onPress} disabled={disabled} style={[{ opacity: disabled ? 0.4 : 1 }, style]}>
      <LinearGradient
        colors={[NU.blueHi, NU.blue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          width: '100%', minHeight: 54, borderRadius: 12, paddingVertical: 15,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          shadowColor: NU.blue, shadowOffset: { width: 0, height: 10 }, shadowOpacity: disabled ? 0 : 0.45, shadowRadius: 20, elevation: disabled ? 0 : 8,
        }}
      >
        {icon ? <Icon name={icon} size={16} color="#fff" /> : null}
        {typeof children === 'string' ? (
          <Text style={{ color: '#fff', fontFamily: 'Archivo_600SemiBold', fontSize: 16 }}>{children}</Text>
        ) : children}
      </LinearGradient>
    </Pressable>
  );
}

/** `NcPill` — segmented-control style selectable pill (meal slots, filters). */
export function NuSelectPill({ on, children, onPress }: { on: boolean; children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={{
        flexShrink: 0, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999,
        backgroundColor: on ? '#fff' : 'transparent',
        borderWidth: 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.14)',
      }}
    >
      <Text numberOfLines={1} style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: on ? NU.bg : NU.secondary }}>
        {children}
      </Text>
    </Pressable>
  );
}

/** `NcPanel` — bottom sheet chrome ONLY (backdrop + sliding panel). Renders as a plain absolute-positioned `View`, never a second native `Modal` — the Nutrition screens already stack secondary sheets this way inside their one real `Modal` (see `NutritionShell.tsx`), and a real nested Modal reintroduces the native-modal-stacking bug those screens' own comments document. */
export function NuPanel({ visible, onClose, children, avoidKeyboard = false }: { visible: boolean; onClose: () => void; children: React.ReactNode; avoidKeyboard?: boolean }) {
  // Same slide-up entrance every other full-screen Nutrição flow gets from
  // its native `<Modal animationType="slide">` (CreateCustomFoodScreen,
  // CreateRecipeScreen, RegisterMealScreen itself) — `NuPanel` can't use
  // that same native Modal (see the stacked-Modal regression this file's
  // tests guard against), so it reproduces the motion by hand instead.
  const translateY = useRef(new Animated.Value(60)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    translateY.setValue(60);
    backdropOpacity.setValue(0);
    // Spring, not timing+easing — a fixed-duration ease-out still reads as
    // mechanical (hits 0 and stops dead). A low-damping spring keeps
    // decelerating smoothly into place, the same "fluid" sheet motion iOS's
    // own native sheets have, with `overshootClamping` so it settles without bounce.
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0, useNativeDriver: true, damping: 22, mass: 0.7, stiffness: 220, overshootClamping: true,
      }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, translateY, backdropOpacity]);
  if (!visible) return null;
  return (
    // Explicit zIndex/elevation, not just render order: Android resolves
    // sibling stacking by elevation first, so a sibling that happens to
    // carry its own elevation could otherwise paint on top of this panel
    // (the same class of bug `RegisterMealScreen`'s pre-redesign grams
    // overlay used to guard against with these exact values).
    <KeyboardAvoidingView enabled={avoidKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,0,16,0.65)', opacity: backdropOpacity }]}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} accessibilityLabel="Fechar" />
      </Animated.View>
      <Animated.View
        style={{
          ...(avoidKeyboard ? { marginTop: 'auto' as const } : { position: 'absolute' as const, left: 0, right: 0, bottom: 0 }),
          backgroundColor: NU.panel, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingHorizontal: 24, paddingBottom: 34,
          transform: [{ translateY }],
        }}
      >
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 20 }} />
        {children}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

/** `NcSheet` header — left-aligned title / close (×) button, same layout every "Criar Alimento"/"Criar Receita"/`RegisterMealScreen` header already uses, standardized here so every internal Nutrição screen matches instead of some using a centered-title back-chevron. Pairs with each screen's own existing `<Modal>` — it does not render a `Modal` itself. */
export function NuSheetHeader({ title, onBack }: { title: string; onBack: () => void }) {
  // Every caller already renders this inside a `<SafeAreaView edges={['top', ...]}>`
  // (RegisterMealScreen, FoodSearchScreen, NutritionDiaryScreen, etc.), which
  // already insets for the status bar/notch — a large fixed `paddingTop` on
  // top of that double-counts the inset and pushes the header too far down.
  // This only needs its own small breathing room below the safe area.
  return (
    <View style={{ paddingTop: 8, paddingHorizontal: 22, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ flex: 1, fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }} numberOfLines={1}>{title}</Text>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Fechar" style={{ padding: 6 }}>
        <Icon name="x" size={20} color={NU.faint} />
      </Pressable>
    </View>
  );
}

/** `NcNav` — prev/next day or week navigator with a centered label/sub. */
export function NuNav({
  label, sub, onPrev, onNext, prevDisabled, nextDisabled,
}: {
  label: string;
  sub?: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  const navBtn = (icon: IconName, onPress: () => void, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.2 : 1, borderWidth: 1, borderColor: NU.hairline }}
    >
      <Icon name={icon} size={17} color={NU.white} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
      {navBtn('arrow-left', onPrev, prevDisabled)}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 17, color: NU.white }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint, marginTop: 3 }}>{sub}</Text> : null}
      </View>
      {navBtn('arrow-right', onNext, nextDisabled)}
    </View>
  );
}

/** `NcThin` — thin progress bar with an optional vertical goal tick. */
export function NuThinBar({ value, max, color = NU.strong, tickPct, dashed }: { value: number; max: number; color?: string; tickPct?: number; dashed?: boolean }) {
  const over = max > 0 && value / max > 1.1;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ position: 'relative', height: 4, borderRadius: 2, backgroundColor: NU.track }}>
      {dashed ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 1.5, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)' }} />
      ) : (
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 2, backgroundColor: over ? NU.warn : color }} />
      )}
      {tickPct != null ? (
        <View style={{ position: 'absolute', left: `${tickPct}%`, top: -3, width: 1.5, height: 10, backgroundColor: 'rgba(255,255,255,0.5)' }} />
      ) : null}
    </View>
  );
}

/** `NcStepper` — circular minus/value/plus control. */
export function NuStepper({ value, sub, onMinus, onPlus, minusDisabled, plusDisabled }: {
  value: React.ReactNode;
  sub?: string | null;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  const btn = (icon: IconName, onPress: () => void, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}
    >
      <Icon name={icon} size={18} color={NU.white} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      {btn('minus', onMinus, minusDisabled)}
      <View style={{ flex: 1, alignItems: 'center' }}>
        {typeof value === 'string' ? <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 24, color: NU.white }}>{value}</Text> : value}
        {sub ? <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {btn('plus', onPlus, plusDisabled)}
    </View>
  );
}

/** `C2Row` — label(+sub) / value / chevron row, with a bottom hairline unless `last`. */
export function NuRow({
  label, sub, value, onPress, last, right, danger,
}: {
  label: string;
  sub?: string | null;
  value?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  const content = (
    <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: NU.hairline }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14.5, color: danger ? NU.danger : NU.white }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, marginTop: 3 }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {typeof value === 'string' ? (
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 14, color: NU.strong, flexShrink: 0 }}>{value}</Text>
      ) : value}
      {right}
      {onPress && !right ? <Icon name="chevron-right" size={15} color={NU.faintest} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {content}
    </Pressable>
  );
}

/** `C2IconBtn` — square icon-only button (54px), used for destructive/save-as-favorite trailing actions. */
export function NuIconButton({ icon, onPress, active, accessibilityLabel }: { icon: IconName; onPress: () => void; active?: boolean; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ width: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: NU.surfaceSubtleStrong, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <Icon name={icon} size={18} color={active ? NU.white : 'rgba(255,255,255,0.6)'} filled={active} />
    </Pressable>
  );
}

type NuToastState = { msg: string; key: number } | null;

/** Lightweight, Nutrição-local toast — no shared `Toast` component exists elsewhere in the app to reuse (confirmed before building this). Purely a visual confirmation layered on top of actions that already succeed today; it introduces no new state, data or rule. */
export function useNuToast() {
  const [toast, setToast] = useState<NuToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), 1900);
  };
  return { toast, show };
}

export function NuToast({ toast }: { toast: NuToastState }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!toast) return;
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(1550),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [toast, opacity]);
  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top: 58, left: 24, right: 24, opacity,
        alignItems: 'center',
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: NU.panel, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: NU.white }}>{toast.msg}</Text>
      </View>
    </Animated.View>
  );
}

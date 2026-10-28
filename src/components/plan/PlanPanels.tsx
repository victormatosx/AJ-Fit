import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text } from 'react-native';
import { useTheme } from '../../theme';
import { useIsScreenActive } from '../../state/ScreenActivity';

const RIBBON_LOOP_DURATION_MS = 18000;
const RIBBON_ITEM_GAP = 36;

/**
 * The two panels inside the Plan sheet, and the pieces they share.
 *
 * Everything here is display-only and takes already-resolved values. No
 * component computes a training split, a program length, a projection or a
 * calorie figure — the callers hand down what the prescription engine and the
 * nutrition engine actually produced, and anything they did not produce
 * simply is not passed and therefore is not drawn.
 */

/** The row of seven day markers across the top of the training panel. */
export function PlanWeekRow({
  columns,
}: {
  columns: {
    key: string;
    label: string;
    active: boolean;
    /**
     * The real session letter (`A`, `B`, …) this day resolves to — derived
     * from `FinalWorkoutPlan.weeklySchedule`'s own `sessionIndex`, never
     * invented. `null`/absent on an active day with no resolved plan (the
     * non-SUCCESS fallback) draws the same plain glowing dot the pill
     * always had; an inactive day always shows the dash, real schedule or not.
     */
    letter?: string | null;
  }[];
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {columns.map((column) => (
        <View key={column.key} style={{ flex: 1, alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: theme.fonts.uiSemi,
              fontSize: 11.5,
              lineHeight: 15,
              color: column.active ? theme.colors.primaryEmphasis : theme.colors.textMuted,
              marginBottom: 8,
            }}
          >
            {column.label}
          </Text>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: column.active
                ? theme.colors.primaryEmphasis
                : theme.colors.surfaceMuted,
              borderWidth: column.active ? 0 : 1,
              borderColor: theme.colors.borderStrong,
            }}
          >
            {column.letter ? (
              <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 12.5, color: theme.colors.primaryForeground }}>
                {column.letter}
              </Text>
            ) : !column.active ? (
              <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 12.5, color: theme.colors.textFaint }}>–</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The looping marquee under the header — goal, frequency and level, the
 * three real answers already summarized elsewhere on this screen, restated
 * as a scrolling strip. Visually identical to Home's `HomeEvoTicker` and
 * Treino's `EvolutionTicker` — same font, size, letter-spacing, gap, border
 * and loop timing — sourced through `theme.*` rather than `HomeEvoTicker`'s
 * hardcoded hex, since unlike Home this screen is theme-reactive; in dark
 * theme (`theme.colors.textFaint`/`primaryEmphasis`) the values resolve to
 * the exact same colors Home hardcodes.
 */
export function PlanTagRibbon({ items }: { items: { label: string; value: string }[] }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  // Mirrors HomeEvoTicker/EvolutionTicker's guard — harmless here since the
  // funnel has no PersistentScreen ancestor (`useIsScreenActive` then
  // defaults to true), but keeps this component correct if it's ever reused
  // somewhere that does keep screens alive while hidden.
  const isActive = useIsScreenActive();

  useEffect(() => {
    if (width === 0 || !isActive) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -width,
        duration: RIBBON_LOOP_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [width, x, isActive]);

  if (items.length === 0) return null;

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width) : undefined}
      style={{ flexDirection: 'row', gap: RIBBON_ITEM_GAP, paddingRight: RIBBON_ITEM_GAP }}
    >
      {items.map((item, index) => (
        <Text
          key={index}
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 10,
            letterSpacing: 2,
            color: theme.colors.textFaint,
          }}
        >
          {item.label ? `${item.label.toUpperCase()} ` : ''}
          <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.monoBold }}>
            {item.value.toUpperCase()}
          </Text>
        </Text>
      ))}
    </View>
  );

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.settingsGroupBorder,
        paddingVertical: 8,
        overflow: 'hidden',
      }}
    >
      <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: x }], paddingLeft: 22 }}>
        {row((w) => setWidth(w))}
        {row()}
      </Animated.View>
    </View>
  );
}

/** The centred stat line: muted copy with the real numbers picked out in white. */
export function PlanStatsLine({ parts }: { parts: { value: string; label: string }[] }) {
  const { theme } = useTheme();
  return (
    <Text
      style={{
        textAlign: 'center',
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.textMuted,
      }}
    >
      {parts.map((part, index) => (
        // The label is optional (and usually empty), so the key is the part's
        // own position: these parts are a fixed, ordered line, not a reorderable list.
        <Text key={`${index}-${part.value}`}>
          {index > 0 ? '   ·   ' : ''}
          <Text style={{ fontFamily: theme.fonts.uiSemi, color: theme.colors.textPrimary }}>
            {part.value}
          </Text>
          {part.label ? ` ${part.label}` : ''}
        </Text>
      ))}
    </Text>
  );
}

/**
 * The locked preview: numbered rows whose content is deliberately not shown.
 * The bars are blurred-looking placeholders, not redacted real data — the
 * exercises and quantities genuinely are not resolved at this point in the
 * funnel, and the padlock is the honest statement of that.
 *
 * `showPlaceholderBars` is false when every row title is already a real
 * answer (the diet panel's meals): there the names and calories are the data,
 * and drawing bars under them would imply hidden detail the row does not have.
 *
 * `locked` is false for the one case where the row's own name AND quantity
 * are both real — the previewed workout day's actual exercises, with their
 * actual sets/reps, straight from the prescription engine. No padlock on
 * data that already isn't hidden; `footer` is typically omitted there too.
 */
export function PlanLockedPreview({
  rows,
  footer,
  showPlaceholderBars = true,
  locked = true,
}: {
  rows: { key: string; title: string; trailing?: string | null }[];
  footer?: string | null;
  showPlaceholderBars?: boolean;
  locked?: boolean;
}) {
  const { theme } = useTheme();
  // The card's own growth is bounded by the single scroll boundary the
  // caller wraps the whole panel body in (`PlanPanel`, in
  // `PlanReadyScreen.tsx`) — this never scrolls on its own, so a panel never
  // ends up with two independent, nested scroll gestures competing.
  const rowsContent = (
    <>
      {rows.map((row, index) => (
        <View
          key={row.key}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 12,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.colors.divider,
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: theme.colors.lockedPreviewChip,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiBold,
                fontSize: 12.5,
                color: theme.colors.primaryEmphasis,
              }}
            >
              {index + 1}
            </Text>
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}
            >
              {row.title}
            </Text>
            {showPlaceholderBars ? (
              <View style={{ flexDirection: 'row', gap: 5, marginTop: 7 }}>
                {[0.42, 0.28, 0.16].map((widthFraction) => (
                  <View
                    key={widthFraction}
                    style={{
                      height: 6,
                      borderRadius: 3,
                      flexGrow: widthFraction,
                      flexBasis: 0,
                      backgroundColor: theme.colors.surfaceElevated,
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>

          {row.trailing ? (
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.textMuted }}>
              {row.trailing}
            </Text>
          ) : null}
          {locked ? <PlanLockIcon /> : null}
        </View>
      ))}
    </>
  );

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {rowsContent}

      {footer ? (
        <View
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: theme.colors.surfaceQuiet,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
          }}
        >
          <Text
            style={{
              fontFamily: theme.fonts.ui,
              fontSize: 12.5,
              lineHeight: 17,
              color: theme.colors.textMuted,
              textAlign: 'center',
            }}
          >
            {footer}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A 14pt padlock, drawn with plain views so it needs no icon asset. */
function PlanLockIcon() {
  const { theme } = useTheme();
  return (
    <View style={{ width: 14, alignItems: 'center' }}>
      <View
        style={{
          width: 8,
          height: 6,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          borderWidth: 1.4,
          borderBottomWidth: 0,
          borderColor: theme.colors.textFaint,
        }}
      />
      <View
        style={{
          width: 12,
          height: 8,
          borderRadius: 2,
          backgroundColor: theme.colors.textFaint,
        }}
      />
    </View>
  );
}

/** One of the three macro columns, with its proportional bar. */
export function PlanMacroColumn({
  value,
  label,
  share,
}: {
  value: string;
  label: string;
  /** Fraction of total calories, or null to omit the bar. */
  share: number | null;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text
        style={{
          fontFamily: theme.fonts.uiSemi,
          fontSize: 20,
          color: theme.colors.textPrimary,
        }}
      >
        {value}
      </Text>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
        {label}
      </Text>
      {share != null ? (
        <>
          <View
            style={{
              width: '72%',
              height: 4,
              borderRadius: 2,
              marginTop: 8,
              backgroundColor: theme.colors.surfaceElevated,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.round(share * 100)}%`,
                height: '100%',
                borderRadius: 2,
                backgroundColor: theme.colors.scheduleDayActive,
              }}
            />
          </View>
          {/* The bar is a real share of daily calories, not a decoration —
              naming the number is what makes that legible at a glance. */}
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 10,
              letterSpacing: 0.4,
              color: theme.colors.textFaint,
              marginTop: 5,
            }}
          >
            {Math.round(share * 100)}%
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** Panel heading: a title, an optional mono badge, and a subtitle. */
export function PlanPanelHeader({
  title,
  badge,
  subtitle,
}: {
  title: string;
  badge?: string | null;
  subtitle?: string | null;
}) {
  const { theme } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: theme.fonts.uiSemi,
            fontSize: 24,
            lineHeight: 30,
            letterSpacing: -0.5,
            color: theme.colors.textPrimary,
          }}
        >
          {title}
        </Text>
        {badge ? (
          <Text
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 10,
              letterSpacing: 1.2,
              color: theme.colors.primaryEmphasis,
            }}
          >
            {badge}
          </Text>
        ) : null}
      </View>
      {subtitle ? (
        <Text
          style={{
            marginTop: 4,
            fontFamily: theme.fonts.ui,
            fontSize: 13.5,
            lineHeight: 19,
            color: theme.colors.textMuted,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

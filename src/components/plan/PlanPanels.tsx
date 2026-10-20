import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme';

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
  columns: { key: string; label: string; active: boolean }[];
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
              backgroundColor: column.active
                ? theme.colors.scheduleDayActive
                : theme.colors.surfaceMuted,
              borderWidth: column.active ? 0 : 1,
              borderColor: theme.colors.borderStrong,
              shadowColor: column.active ? theme.colors.primaryGlowBright : 'transparent',
              shadowOpacity: column.active ? 1 : 0,
              shadowRadius: column.active ? 14 : 0,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        </View>
      ))}
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
 */
export function PlanLockedPreview({
  rows,
  footer,
  showPlaceholderBars = true,
}: {
  rows: { key: string; title: string; trailing?: string | null }[];
  footer: string;
  showPlaceholderBars?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
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
          <PlanLockIcon />
        </View>
      ))}

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

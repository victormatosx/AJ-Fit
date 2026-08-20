import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Display, MonoLabel } from '../ui/Display';
import { Icon, type IconName } from '../ui/Icon';
import { alpha, colors, radii, spacing, typography } from '../../theme/tokens';

/**
 * Purely presentational pieces for `DeleteAccountScreen`. No business logic,
 * no calls into `useAccountDeletionFlow` or the deletion services — every
 * prop here is data already resolved by the screen/hook.
 */

type HeroTone = 'accent' | 'warning' | 'danger';

const HERO_TONE_COLOR: Record<HeroTone, string> = {
  accent: colors.accentHi,
  warning: colors.warning,
  danger: colors.dangerText,
};

const HERO_TONE_BG: Record<HeroTone, string> = {
  accent: alpha.blue12,
  warning: 'rgba(255,168,64,0.12)',
  danger: 'rgba(240,86,63,0.12)',
};

const HERO_TONE_BORDER: Record<HeroTone, string> = {
  accent: alpha.blue30,
  warning: 'rgba(255,168,64,0.32)',
  danger: 'rgba(240,86,63,0.32)',
};

export function DeleteAccountHero({
  icon,
  tone = 'accent',
  title,
  subtitle,
  loading,
}: {
  icon: IconName;
  tone?: HeroTone;
  title: string;
  subtitle?: string;
  loading?: boolean;
}) {
  const toneColor = HERO_TONE_COLOR[tone];
  return (
    <View style={{ alignItems: 'center', gap: spacing[4], paddingTop: spacing[2] }}>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: HERO_TONE_BG[tone],
          borderWidth: 1,
          borderColor: HERO_TONE_BORDER[tone],
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: toneColor,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 24,
          elevation: 10,
        }}
      >
        {loading ? <ActivityIndicator color={toneColor} /> : <Icon name={icon} size={30} color={toneColor} />}
      </View>
      <View style={{ gap: spacing[2], alignItems: 'center' }}>
        <Display size={26} skew={false} style={{ textAlign: 'center' }}>
          {title}
        </Display>
        {subtitle ? (
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

const FLOW_STEPS = ['intro', 'reauth', 'confirm'] as const;

export function DeletionStepProgress({ step }: { step: (typeof FLOW_STEPS)[number] | 'submitting' }) {
  if (step === 'submitting') return null;
  const currentIndex = FLOW_STEPS.indexOf(step);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}
    >
      {FLOW_STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i <= currentIndex ? colors.accentHi : colors.border,
            }}
          />
          {i < FLOW_STEPS.length - 1 ? (
            <View
              style={{
                width: 18,
                height: 1,
                backgroundColor: i < currentIndex ? colors.accentHi : colors.border,
              }}
            />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

export function DeletionImpactList({ items }: { items: string[] }) {
  return (
    <View
      style={{
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      {items.map((text, i) => (
        <View key={i}>
          <View style={{ flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start', padding: spacing[4] }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: alpha.blue12,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 1,
              }}
            >
              <Icon name="check" size={12} color={colors.accentHi} />
            </View>
            <Text style={[typography.body, { color: colors.textSecondary, flex: 1 }]}>{text}</Text>
          </View>
          {i < items.length - 1 ? (
            <View style={{ height: 1, backgroundColor: colors.border, marginLeft: spacing[4] + 22 + spacing[3] }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function SubscriptionWarningCard({
  eyebrow,
  title,
  body,
  manageLabel,
  onManage,
  showManage,
}: {
  eyebrow: string;
  title: string;
  body: string;
  manageLabel: string;
  onManage: () => void;
  showManage: boolean;
}) {
  return (
    <View
      style={{
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: 'rgba(255,168,64,0.28)',
        backgroundColor: 'rgba(255,168,64,0.06)',
        padding: spacing[4],
        gap: spacing[2.5],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: 'rgba(255,168,64,0.14)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="alert-triangle" size={14} color={colors.warning} />
        </View>
        <MonoLabel color={colors.warning}>{eyebrow}</MonoLabel>
      </View>
      <Text style={[typography.subtitle, { color: colors.text }]}>{title}</Text>
      <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>{body}</Text>
      {showManage ? (
        <Pressable
          accessibilityRole="button"
          onPress={onManage}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], minHeight: 32 }}
        >
          <Text style={[typography.subtitle, { color: colors.accentHi }]}>{manageLabel}</Text>
          <Icon name="arrow-right" size={14} color={colors.accentHi} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function DeletionSubscriptionNotice({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing[2.5],
        alignItems: 'flex-start',
        padding: spacing[3.5],
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: 'rgba(255,168,64,0.25)',
        backgroundColor: 'rgba(255,168,64,0.05)',
      }}
    >
      <Icon name="alert-triangle" size={15} color={colors.warning} />
      <Text style={[typography.bodySmall, { color: colors.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

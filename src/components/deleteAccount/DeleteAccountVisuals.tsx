import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Display, MonoLabel } from '../ui/Display';
import { Icon, type IconName } from '../ui/Icon';
import { useTheme } from '../../theme';
import { radii, spacing, typography } from '../../theme/tokens';

/**
 * Purely presentational pieces for `DeleteAccountScreen`. No business logic,
 * no calls into `useAccountDeletionFlow` or the deletion services — every
 * prop here is data already resolved by the screen/hook.
 */

type HeroTone = 'accent' | 'warning' | 'danger';

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
  const { theme } = useTheme();
  const toneColor: Record<HeroTone, string> = {
    accent: theme.colors.accentHi,
    warning: theme.colors.warning,
    danger: theme.colors.dangerText,
  };
  const toneBackground: Record<HeroTone, string> = {
    accent: theme.colors.primarySoft,
    warning: theme.colors.statusCautionBackground,
    danger: theme.colors.feedbackCriticalBackgroundSoft,
  };
  const toneBorder: Record<HeroTone, string> = {
    accent: theme.colors.primaryBorderQuiet,
    warning: theme.colors.toastWarningBorder,
    danger: theme.colors.feedbackCriticalBorder,
  };
  return (
    <View style={{ alignItems: 'center', gap: spacing[4], paddingTop: spacing[2] }}>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: toneBackground[tone],
          borderWidth: 1,
          borderColor: toneBorder[tone],
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: toneColor[tone],
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 24,
          elevation: 10,
        }}
      >
        {loading ? <ActivityIndicator color={toneColor[tone]} /> : <Icon name={icon} size={30} color={toneColor[tone]} />}
      </View>
      <View style={{ gap: spacing[2], alignItems: 'center' }}>
        <Display size={26} skew={false} style={{ textAlign: 'center' }}>
          {title}
        </Display>
        {subtitle ? (
          <Text style={[typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

const FLOW_STEPS = ['intro', 'reauth', 'confirm'] as const;

export function DeletionStepProgress({ step }: { step: (typeof FLOW_STEPS)[number] | 'submitting' }) {
  const { theme } = useTheme();
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
              backgroundColor: i <= currentIndex ? theme.colors.accentHi : theme.colors.border,
            }}
          />
          {i < FLOW_STEPS.length - 1 ? (
            <View
              style={{
                width: 18,
                height: 1,
                backgroundColor: i < currentIndex ? theme.colors.accentHi : theme.colors.border,
              }}
            />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

export function DeletionImpactList({ items }: { items: string[] }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
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
                backgroundColor: theme.colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 1,
              }}
            >
              <Icon name="check" size={12} color={theme.colors.accentHi} />
            </View>
            <Text style={[typography.body, { color: theme.colors.textSecondary, flex: 1 }]}>{text}</Text>
          </View>
          {i < items.length - 1 ? (
            <View style={{ height: 1, backgroundColor: theme.colors.border, marginLeft: spacing[4] + 22 + spacing[3] }} />
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
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: theme.colors.toastWarningBorder,
        backgroundColor: theme.colors.statusCautionBackground,
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
            backgroundColor: theme.colors.statusCautionBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="alert-triangle" size={14} color={theme.colors.warning} />
        </View>
        <MonoLabel color={theme.colors.warning}>{eyebrow}</MonoLabel>
      </View>
      <Text style={[typography.subtitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[typography.bodySmall, { color: theme.colors.textSecondary }]}>{body}</Text>
      {showManage ? (
        <Pressable
          accessibilityRole="button"
          onPress={onManage}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], minHeight: 32 }}
        >
          <Text style={[typography.subtitle, { color: theme.colors.accentHi }]}>{manageLabel}</Text>
          <Icon name="arrow-right" size={14} color={theme.colors.accentHi} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function DeletionSubscriptionNotice({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: spacing[2.5],
        alignItems: 'flex-start',
        padding: spacing[3.5],
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: theme.colors.toastWarningBorder,
        backgroundColor: theme.colors.statusCautionBackground,
      }}
    >
      <Icon name="alert-triangle" size={15} color={theme.colors.warning} />
      <Text style={[typography.bodySmall, { color: theme.colors.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

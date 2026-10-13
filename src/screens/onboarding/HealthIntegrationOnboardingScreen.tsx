import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../../components/ui/Icon';
import { SegBar } from '../../components/ui/SegBar';
import { HealthProviderLogo } from '../../components/health/HealthProviderLogo';
import { HealthProviderActionButton } from '../../components/health/HealthProviderActionButton';
import { spacing, sizes } from '../../theme/tokens';
import { useTheme, type AppTheme } from '../../theme';
import { getHealthPlatform } from '../../services/healthIntegration';
import type { OnboardingHealthIntegrationChoice } from '../../onboarding/draftStorage';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const APPLE_MARK_BLACK = require('../../../assets/integrations/apple_health_1x1.png');

/**
 * Fase 5 — a native step of the initial questionnaire, not a Settings
 * screen. Always runs PRE-auth (never in `FORCED_QUESTIONNAIRE_STEP_IDS` —
 * see `onboarding/steps.ts`), so there is no uid yet and this component
 * never touches `useHealthIntegration`/native permissions at all — it only
 * records a choice. The real connection happens later, once a uid exists,
 * via the existing Fase 1 hook (see `App.tsx`'s post-signup consumption of
 * `healthIntegrationChoice` and the confirmation sheet in `AppShell.tsx`).
 */
export function HealthIntegrationOnboardingScreen({
  choice,
  onChoose,
  progress,
  onBack,
  onNext,
}: {
  choice: OnboardingHealthIntegrationChoice | null;
  onChoose: (choice: OnboardingHealthIntegrationChoice) => void;
  progress: OnboardingProgress;
  onBack: (() => void) | null;
  onNext: () => void;
}) {
  const { t } = useTranslation(['onboarding', 'common']);
  const { theme } = useTheme();
  const platform = getHealthPlatform();
  const provider = platform === 'android' ? 'Health Connect' : 'Apple Health';
  const isAndroid = platform === 'android';

  const choose = (next: OnboardingHealthIntegrationChoice) => {
    onChoose(next);
    onNext();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            paddingHorizontal: sizes.screenGutter,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <Pressable
            onPress={onBack ?? undefined}
            disabled={!onBack}
            accessibilityRole="button"
            accessibilityLabel={t('common:actions.back')}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: theme.colors.surfaceElevated,
              borderWidth: 1,
              borderColor: theme.colors.inputBorderSubtle,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: onBack ? 1 : 0.3,
            }}
          >
            <Icon name="arrow-left" size={17} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
          </View>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, letterSpacing: 1, color: theme.colors.textFaint }}>
            {progress.current} / {progress.total}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[8], paddingBottom: spacing[2] }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingRight: spacing[3] }}>
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 11,
                  letterSpacing: 2,
                  color: theme.colors.textFaint,
                  textTransform: 'uppercase',
                }}
              >
                {t('onboarding:healthIntegration.eyebrow')}
              </Text>
              <Text
                style={{
                  fontFamily: theme.fonts.uiBold,
                  fontSize: 29,
                  lineHeight: 35,
                  color: theme.colors.textPrimary,
                  marginTop: spacing[2],
                }}
              >
                {t('onboarding:healthIntegration.title')}
              </Text>
            </View>
            <ProviderBadgeStack theme={theme} isAndroid={isAndroid} />
          </View>

          <Text
            style={[
              theme.typography.body,
              { color: theme.colors.textSecondary, marginTop: spacing[3], lineHeight: 21 },
            ]}
          >
            {t('onboarding:healthIntegration.description')}
          </Text>

          <View style={{ gap: spacing[3], marginTop: spacing[6] }}>
            <BenefitCard
              theme={theme}
              icon="chart"
              title={t('onboarding:healthIntegration.benefits.weight.title')}
              description={t('onboarding:healthIntegration.benefits.weight.description')}
            />
            <BenefitCard
              theme={theme}
              icon="run"
              title={t('onboarding:healthIntegration.benefits.workouts.title')}
              description={t('onboarding:healthIntegration.benefits.workouts.description')}
            />
            <BenefitCard
              theme={theme}
              icon="lock"
              title={t('onboarding:healthIntegration.benefits.control.title')}
              description={t('onboarding:healthIntegration.benefits.control.description')}
            />
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[1], gap: spacing[2] }}>
          <HealthProviderActionButton
            platform={isAndroid ? 'android' : 'ios'}
            label={t('onboarding:healthIntegration.connectAction', { provider })}
            accessibilityLabel={t('onboarding:healthIntegration.connectAction', { provider })}
            onPress={() => choose('connect')}
          />

          <Pressable
            onPress={() => choose('skip')}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding:healthIntegration.skipAction')}
            style={({ pressed }) => ({ paddingVertical: spacing[3], alignItems: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 15, color: theme.colors.textSecondary }}>
              {t('onboarding:healthIntegration.skipAction')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Decorative stacked-card composition in the top-right corner, matching the
 * reference design. Both marks are always shown — this is purely visual
 * branding, not a functional affordance (the single platform-specific action
 * below is the only tappable connect control) — but whichever mark matches
 * the device's actual platform is drawn last (on top, in the prominent
 * front/top-right slot) so it reads as the primary one.
 */
function ProviderBadgeStack({ theme, isAndroid }: { theme: AppTheme; isAndroid: boolean }) {
  const appleCard = (position: 'front' | 'back') => (
    <View
      key="apple"
      style={{
        position: 'absolute',
        ...(position === 'front' ? { right: 0, top: 0 } : { left: 0, bottom: 0 }),
        width: position === 'front' ? 76 : 72,
        height: position === 'front' ? 76 : 72,
        borderRadius: position === 'front' ? 21 : 20,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate: position === 'front' ? '9deg' : '-10deg' }],
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: position === 'front' ? 8 : 6 },
        shadowOpacity: position === 'front' ? 0.4 : 0.35,
        shadowRadius: position === 'front' ? 12 : 10,
        elevation: position === 'front' ? 8 : 6,
      }}
    >
      <Image
        source={APPLE_MARK_BLACK}
        resizeMode="contain"
        style={{ width: position === 'front' ? 42 : 38, height: position === 'front' ? 42 : 38 }}
      />
    </View>
  );

  const healthConnectCard = (position: 'front' | 'back') => (
    <View
      key="healthConnect"
      style={{
        position: 'absolute',
        ...(position === 'front' ? { right: 0, top: 0 } : { left: 0, bottom: 0 }),
        width: position === 'front' ? 76 : 72,
        height: position === 'front' ? 76 : 72,
        borderRadius: position === 'front' ? 21 : 20,
        backgroundColor: '#17171d',
        borderWidth: 1,
        borderColor: theme.colors.cardBorder,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate: position === 'front' ? '9deg' : '-10deg' }],
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: position === 'front' ? 8 : 6 },
        shadowOpacity: position === 'front' ? 0.4 : 0.35,
        shadowRadius: position === 'front' ? 12 : 10,
        elevation: position === 'front' ? 8 : 6,
      }}
    >
      <HealthProviderLogo platform="android" size={position === 'front' ? 42 : 38} />
    </View>
  );

  return (
    <View style={{ width: 104, height: 126 }}>
      {isAndroid ? (
        <>
          {appleCard('back')}
          {healthConnectCard('front')}
        </>
      ) : (
        <>
          {healthConnectCard('back')}
          {appleCard('front')}
        </>
      )}
    </View>
  );
}

function BenefitCard({
  theme,
  icon,
  title,
  description,
}: {
  theme: AppTheme;
  icon: IconName;
  title: string;
  description: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3.5],
        padding: spacing[4],
        borderRadius: theme.radii.xxl,
        borderWidth: 1,
        borderColor: theme.colors.cardBorder,
        backgroundColor: theme.colors.surfaceElevated,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={19} color={theme.colors.textPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15.5, color: theme.colors.textPrimary }}>
          {title}
        </Text>
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 3, lineHeight: 18 }]}>
          {description}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
    </View>
  );
}

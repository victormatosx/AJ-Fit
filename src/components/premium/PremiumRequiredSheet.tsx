import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { Display, MonoLabel } from '../ui/Display';
import { CtaButton } from '../ui/CtaButton';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import { resolvePremiumActionCopy } from '../../lib/premiumCapabilityCopy';
import type { PremiumUpgradeIntent } from '../../lib/premiumUpgradeIntent';
import type { PremiumCapability } from '../../lib/premiumCapabilities';

const CTA_KEY: Record<PremiumUpgradeIntent, string> = {
  subscribe: 'premiumAction.cta.subscribe',
  renew: 'premiumAction.cta.renew',
  unlock: 'premiumAction.cta.unlock',
};

/**
 * Fase 4 (docs/13_assinaturas_e_billing.md): the one blocked-action sheet
 * every Premium capability shares — mounted once by `PremiumActionProvider`,
 * never per-screen. Deliberately a compact bottom sheet (same `Modal`
 * transparent+slide pattern as `AddPhotoSheet`), not a full-screen takeover:
 * the philosophy this fase set out to build is "the block appears only
 * where the Premium value begins", not a wall over the whole app.
 *
 * Never calls into RevenueCat/Purchases directly — the primary CTA only
 * calls `onRequestUpgrade`, which `PremiumActionProvider` wires to the
 * existing on-demand `PaywallScreen` mount in `AppShell`. Purchase, restore
 * and offer codes stay exactly where Fase 0 found them.
 */
export function PremiumRequiredSheet({
  visible,
  capability,
  intent,
  onDismiss,
  onRequestUpgrade,
}: {
  visible: boolean;
  /** `null` only while nothing is pending — `visible` is `false` then too. */
  capability: PremiumCapability | null;
  intent: PremiumUpgradeIntent;
  onDismiss: () => void;
  onRequestUpgrade: () => void;
}) {
  const { t } = useTranslation('common');
  // Keys are resolved dynamically per capability/intent (see
  // premiumCapabilityCopy.ts) — same escape hatch WorkoutScreen already uses
  // for its own dynamic i18n lookups (`LooseT`), since i18next's generated
  // types only accept literal key strings.
  const tLoose = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
  // FASE 6: copy now depends on both WHAT was attempted and the commercial
  // intent (never-subscribed vs. expired) — see premiumCapabilityCopy.ts.
  const { titleKey, descriptionKey } = resolvePremiumActionCopy({
    capability: capability ?? 'START_WORKOUT',
    intent,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('premiumAction.cta.dismiss')}
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.bg2,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: colors.borderStrong,
          }}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={{ padding: sizes.screenGutter, paddingTop: spacing[6] }}>
              <View style={{ alignItems: 'center' }}>
                <LinearGradient
                  colors={['rgba(11,112,249,0.3)', 'rgba(11,112,249,0.08)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(77,163,255,0.4)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="lock" size={22} color={colors.accentHi} />
                </LinearGradient>

                <MonoLabel color={colors.accentHi} style={{ marginTop: spacing[3] }}>
                  {t('premiumAction.eyebrow').toUpperCase()}
                </MonoLabel>
                <Display
                  size={22}
                  style={{ marginTop: spacing[1.5], textAlign: 'center' }}
                >
                  {tLoose(titleKey).toUpperCase()}
                </Display>
                <Text
                  style={{
                    marginTop: spacing[2.5],
                    fontFamily: fonts.ui,
                    fontSize: 14,
                    lineHeight: 20,
                    color: colors.mute,
                    textAlign: 'center',
                  }}
                >
                  {tLoose(descriptionKey)}
                </Text>
              </View>

              <View style={{ marginTop: spacing[6], gap: spacing[3] }}>
                <CtaButton
                  onPress={onRequestUpgrade}
                  accessibilityLabel={tLoose(CTA_KEY[intent])}
                  style={{ alignSelf: 'stretch' }}
                >
                  {tLoose(CTA_KEY[intent])}
                </CtaButton>
                <Pressable
                  onPress={onDismiss}
                  accessibilityRole="button"
                  accessibilityLabel={t('premiumAction.cta.dismiss')}
                  style={{ alignItems: 'center', paddingVertical: spacing[2] }}
                >
                  <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 13 }}>
                    {t('premiumAction.cta.dismiss')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

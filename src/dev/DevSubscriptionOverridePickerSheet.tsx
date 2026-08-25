import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon } from '../components/ui/Icon';
import {
  DEV_SUBSCRIPTION_OVERRIDE_STATES,
  type DevSubscriptionOverrideState,
} from './subscriptionOverride';

// Dev/QA only — labels for the Subscription Override picker. Intentionally
// not localized (internal developer tool, never shown outside a dev build).
export const DEV_OVERRIDE_LABELS: Record<DevSubscriptionOverrideState, string> = {
  REAL: 'Real (RevenueCat)',
  FREE: 'Free',
  PREMIUM_MONTHLY: 'Premium — Monthly',
  PREMIUM_ANNUAL: 'Premium — Annual',
  TRIAL: 'Trial (active)',
  CANCELED_ACTIVE: 'Canceled — still active',
  EXPIRED: 'Expired',
};

const DEV_OVERRIDE_DESCRIPTIONS: Record<DevSubscriptionOverrideState, string> = {
  REAL: 'No simulation — use whatever RevenueCat actually returns.',
  FREE: 'Simulates no active entitlement. Tests the paywall/free experience.',
  PREMIUM_MONTHLY: 'Simulates an active monthly Premium subscription, auto-renewing.',
  PREMIUM_ANNUAL: 'Simulates an active annual Premium subscription, auto-renewing.',
  TRIAL: 'Simulates an active free-trial period, ending in 3 days.',
  CANCELED_ACTIVE: 'Simulates a canceled subscription — Premium stays on for 10 more days.',
  EXPIRED: 'Simulates an expired subscription — no Premium access.',
};

/**
 * Dev/QA only. Shared between Settings > Developer and the Paywall's own
 * Developer entry point — both are just a UI surface over the exact same
 * `DevSubscriptionOverrideContext`/AsyncStorage key
 * (`ajfit-dev-subscription-override`); this component owns no state of its
 * own. Only ever mounted when the caller has already checked
 * `useDevSubscriptionOverrideContext().allowed` — a development build with
 * the opt-in flag set. Selecting an option calls the caller's `onSelect`,
 * which is expected to forward straight to `setOverride` — persists to
 * AsyncStorage and updates `SubscriptionContext` reactively, no
 * RevenueCat/Firestore/backend call.
 */
export function DevSubscriptionOverridePickerSheet({
  visible,
  current,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  current: DevSubscriptionOverrideState;
  onSelect: (next: DevSubscriptionOverrideState) => void;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: theme.colors.sheetBackdrop, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.sheetBackground,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: theme.colors.sheetBorder,
            paddingBottom: 24,
            maxHeight: '85%',
          }}
        >
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: theme.colors.sheetDivider,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 11,
                letterSpacing: 1.8,
                color: theme.colors.textFaint,
              }}
            >
              SUBSCRIPTION OVERRIDE
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onDismiss}
              hitSlop={10}
            >
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: theme.colors.textFaint,
                }}
              >
                CANCEL
              </Text>
            </Pressable>
          </View>

          <Text
            style={{
              fontFamily: theme.fonts.ui,
              fontSize: 12,
              lineHeight: 17,
              color: theme.colors.textFaint,
              paddingHorizontal: 22,
              paddingTop: 12,
            }}
          >
            Dev/QA only. Simulates the app&apos;s effective subscription state without a
            real purchase — never affects RevenueCat, Firestore, or billing.
          </Text>

          <ScrollView style={{ paddingHorizontal: 12, paddingTop: 10 }}>
            {DEV_SUBSCRIPTION_OVERRIDE_STATES.map((state) => {
              const active = state === current;
              return (
                <Pressable
                  key={state}
                  testID={`dev-subscription-override-option-${state}`}
                  onPress={() => onSelect(state)}
                  accessibilityRole="radio"
                  accessibilityLabel={DEV_OVERRIDE_LABELS[state]}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    marginVertical: 3,
                    borderRadius: 12,
                    backgroundColor: active
                      ? theme.colors.choiceSelectedBackground
                      : pressed
                        ? theme.colors.inputBackgroundSubtle
                        : 'transparent',
                    borderWidth: 1,
                    borderColor: active
                      ? theme.colors.choiceSelectedBorder
                      : theme.colors.sheetDivider,
                  })}
                >
                  <View style={{ width: 22, alignItems: 'center' }}>
                    {active ? (
                      <Icon name="check" size={16} color={theme.colors.primaryEmphasis} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: theme.fonts.uiSemi,
                        fontSize: 14,
                        color: active ? theme.colors.choiceText : theme.colors.choiceTextSecondary,
                      }}
                    >
                      {DEV_OVERRIDE_LABELS[state]}
                    </Text>
                    <Text
                      style={{
                        fontFamily: theme.fonts.ui,
                        fontSize: 11.5,
                        marginTop: 2,
                        color: theme.colors.textFaint,
                      }}
                    >
                      {DEV_OVERRIDE_DESCRIPTIONS[state]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { PremiumAction } from '../premium/PremiumAction';
import { useTheme } from '../../theme';
import { radii, sizes, spacing } from '../../theme/tokens';

function ActionOption({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  locked,
  last,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
  locked: boolean;
  last?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        minHeight: 76,
        paddingVertical: spacing[3.5],
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: radii.md,
          backgroundColor: theme.colors.accentSoft,
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={theme.colors.accentHi} />
        {locked ? (
          <View
            style={{
              position: 'absolute',
              right: -4,
              bottom: -4,
              width: 17,
              height: 17,
              borderRadius: radii.pill,
              backgroundColor: theme.colors.bg2,
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="lock" size={9} color={theme.colors.primaryEmphasis} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.text }}>
          {title}
        </Text>
        <Text
          style={{
            marginTop: spacing[1],
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            lineHeight: 18,
            color: theme.colors.mute,
          }}
        >
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={theme.colors.faint} />
    </Pressable>
  );
}

/** Compact creation selector. The original PremiumAction boundary is kept. */
export function AssessmentActionCard({
  visible,
  onClose,
  onGuided,
  onImport,
}: {
  visible: boolean;
  onClose: () => void;
  onGuided: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation('assessment');
  const { theme } = useTheme();

  // The selector and both possible destinations are native Modal-based
  // surfaces. Dismiss this modal in the same press that dispatches the
  // gated action so the form (allowed) or PremiumRequiredSheet (blocked)
  // never has to open on top of an already-visible native modal.
  const selectAction = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('accessibility.closeNewAssessment')}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlayStrong }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.colors.bg2,
            borderTopLeftRadius: radii.xxl,
            borderTopRightRadius: radii.xxl,
            borderTopWidth: 1,
            borderColor: theme.colors.borderStrong,
          }}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[2] }}>
              <View
                style={{
                  alignSelf: 'center',
                  width: 38,
                  height: 4,
                  borderRadius: radii.pill,
                  backgroundColor: theme.colors.borderStrong,
                  marginBottom: spacing[5],
                }}
              />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: spacing[2],
                }}
              >
                <MonoLabel color={theme.colors.accentHi}>{t('actions.sheetTitle').toUpperCase()}</MonoLabel>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={t('accessibility.closeNewAssessment')}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: radii.control,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
                  })}
                >
                  <Icon name="x" size={17} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              <View style={{ paddingBottom: spacing[3] }}>
                <PremiumAction capability="CREATE_ASSESSMENT" onAllowed={onGuided}>
                  {({ locked, onPress }) => (
                    <ActionOption
                      icon="ruler"
                      title={t('actions.guided.title')}
                      subtitle={t('actions.guided.description')}
                      onPress={() => selectAction(onPress)}
                      accessibilityLabel={
                        locked ? t('accessibility.openGuidedLocked') : t('accessibility.openGuided')
                      }
                      locked={locked}
                    />
                  )}
                </PremiumAction>
                <PremiumAction capability="CREATE_ASSESSMENT" onAllowed={onImport}>
                  {({ locked, onPress }) => (
                    <ActionOption
                      icon="download"
                      title={t('actions.import.title')}
                      subtitle={t('actions.import.description')}
                      onPress={() => selectAction(onPress)}
                      accessibilityLabel={
                        locked ? t('accessibility.openImportLocked') : t('accessibility.openImport')
                      }
                      locked={locked}
                      last
                    />
                  )}
                </PremiumAction>
              </View>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from '../ui/Icon';
import { PremiumAction } from '../premium/PremiumAction';
import { useTheme } from '../../theme';

function ActionOption({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  locked,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** FASE 4/5 (docs/13_assinaturas_e_billing.md): CREATE_ASSESSMENT is a
   *  Premium capability. Still tappable when locked — `onPress` (wired by
   *  the caller through `<PremiumAction>`) opens the shared blocked-action
   *  sheet instead of the form. Only a small corner badge changes; the
   *  option's own icon/title/subtitle stay as-is. */
  locked: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flex: 1,
        padding: 16,
        borderRadius: 14,
        backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        gap: 10,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={17} color={theme.colors.primaryEmphasis} />
        {locked && (
          <View
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: theme.colors.backgroundSecondary,
              borderWidth: 1,
              borderColor: theme.colors.divider,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="lock" size={9} color={theme.colors.primaryEmphasis} />
          </View>
        )}
      </View>
      <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 13.5, color: theme.colors.textPrimary }}>{title}</Text>
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11, lineHeight: 15, color: theme.colors.textMuted }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

/**
 * FASE 5: each option gates itself via `<PremiumAction>` — the caller
 * (`AssessmentScreen`) hands over plain, capability-unaware callbacks
 * (`onGuided`/`onImport`) exactly like it would for a free action. Both
 * options share the CREATE_ASSESSMENT capability but resolve `locked`
 * independently (same underlying `canPerform` read, so they can never
 * disagree).
 */
export function AssessmentActionCard({
  onGuided,
  onImport,
}: {
  onGuided: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation('assessment');
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <PremiumAction capability="CREATE_ASSESSMENT" onAllowed={onGuided}>
        {({ locked, onPress }) => (
          <ActionOption
            icon="dumbbell"
            title={t('actions.guided.title')}
            subtitle={t('actions.guided.description')}
            onPress={onPress}
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
            onPress={onPress}
            accessibilityLabel={
              locked ? t('accessibility.openImportLocked') : t('accessibility.openImport')
            }
            locked={locked}
          />
        )}
      </PremiumAction>
    </View>
  );
}

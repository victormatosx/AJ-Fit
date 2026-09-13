import { Modal, Pressable, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { HudCorners } from '../ui/Card';
import { Display, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { OutlineNumber } from '../ui/OutlineNumber';

export type OnboardingSafetyBlockStatus = 'REQUIRES_CLEARANCE' | 'BLOCKED';

export function ProfessionalClearanceModal({
  status,
  onDismiss,
}: {
  status: OnboardingSafetyBlockStatus | null;
  onDismiss: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const copyKey = status === 'BLOCKED' ? 'safety.blocked' : 'safety.clearanceRequired';

  return (
    <Modal
      visible={status !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('safety.dismissAccessibility')}
        onPress={onDismiss}
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlayStrong,
          justifyContent: 'center',
          paddingHorizontal: 34,
        }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 340,
            alignSelf: 'center',
            borderRadius: 16,
            borderBottomRightRadius: 0,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.primaryBorderQuiet,
            backgroundColor: theme.colors.background,
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={theme.gradients.poster}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 18 }}
          >
            <HudCorners color={theme.colors.hudCorner} />
            <OutlineNumber
              size={118}
              color={theme.colors.decorativeOutline}
              style={{ position: 'absolute', top: -28, right: -8, opacity: 0.28 }}
            >
              !
            </OutlineNumber>

            <Slash accentColor={theme.colors.warning} textColor={theme.colors.textFaint}>
              {t('safety.kicker').toUpperCase()}
            </Slash>
            <Display size={25} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
              {t(`${copyKey}.title`).toUpperCase()}
            </Display>
            <Text
              style={{
                color: theme.colors.textSecondaryStrong,
                fontFamily: theme.fonts.ui,
                fontSize: 14,
                lineHeight: 21,
                marginTop: 10,
              }}
            >
              {t(`${copyKey}.body`)}
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={onDismiss}
              style={{
                marginTop: 20,
                paddingVertical: 13,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderBottomRightRadius: 0,
                backgroundColor: theme.colors.inverseSurface,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <Text
                style={{
                  color: theme.colors.inverseForeground,
                  fontFamily: theme.fonts.display,
                  fontSize: 14,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                {t('safety.action')}
              </Text>
              <Icon name="check" size={13} color={theme.colors.inverseForeground} stroke={2.4} />
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

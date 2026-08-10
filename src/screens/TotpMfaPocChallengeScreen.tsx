import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { useTotpMfaPocSignIn } from '../hooks/useTotpMfaPocSignIn';
import type { TotpMfaPocIssue } from '../lib/totpMfaPoc';
import type { TotpSignInChallenge } from '../services/totpMfaPoc';
import { colors, fonts, radii, sizes, spacing, typography } from '../theme/tokens';

export function TotpMfaPocChallengeScreen({
  challenge,
  onCancel,
}: {
  challenge: TotpSignInChallenge;
  onCancel: () => void;
}) {
  const { t } = useTranslation('auth');
  const poc = useTotpMfaPocSignIn(challenge, onCancel);

  if (!__DEV__) return null;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Slash>{t('totpMfaPoc.challenge.kicker').toUpperCase()}</Slash>
          <Display size={38} style={{ marginTop: spacing[3] }}>
            {t('totpMfaPoc.challenge.title').toUpperCase()}
          </Display>
          <Text style={[typography.body, styles.secondaryText]}>
            {t('totpMfaPoc.challenge.description')}
          </Text>

          {challenge.hints.length > 1 && (
            <View style={{ marginTop: spacing[6], gap: spacing[2] }}>
              {challenge.hints.map((hint) => {
                const selected = hint.uid === poc.selectedHintUid;
                return (
                  <Pressable
                    key={hint.uid}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => poc.setSelectedHintUid(hint.uid)}
                    disabled={poc.resolving}
                    style={[styles.hint, selected && styles.hintSelected]}
                  >
                    <Icon name="key" size={18} color={colors.accentHi} />
                    <Text style={[typography.subtitle, { color: colors.text, flex: 1 }]}>
                      {hint.displayName ?? hint.factorId}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <TextInput
            accessibilityLabel={t('totpMfaPoc.codeLabel')}
            value={poc.code}
            onChangeText={(value) => poc.setCode(value.replace(/\s/g, ''))}
            editable={!poc.resolving}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            placeholder={t('totpMfaPoc.codePlaceholder')}
            placeholderTextColor={colors.faint}
            style={styles.codeInput}
          />

          {poc.issue && (
            <View accessibilityRole="alert" style={styles.feedback}>
              <Icon name="alert-triangle" size={17} color={colors.dangerText} />
              <Text style={[typography.bodySmall, { color: colors.dangerText, flex: 1 }]}>
                {issueText(poc.issue, t)}
              </Text>
            </View>
          )}

          <View style={{ flex: 1, minHeight: spacing[10] }} />
          <CtaButton onPress={() => void poc.resolve()} disabled={poc.resolving}>
            {poc.resolving && <ActivityIndicator color={colors.text} />}
            <CtaText>
              {poc.resolving
                ? t('totpMfaPoc.actions.resolving')
                : t('totpMfaPoc.actions.resolve')}
            </CtaText>
          </CtaButton>
          <Pressable
            accessibilityRole="button"
            onPress={poc.cancel}
            disabled={poc.resolving}
            style={styles.cancel}
          >
            <Text style={[typography.subtitle, { color: colors.mute }]}>
              {t('actions.cancel')}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function issueText(
  issue: TotpMfaPocIssue,
  t: ReturnType<typeof useTranslation<'auth'>>['t'],
) {
  return t(`totpMfaPoc.errors.${issue}`);
}

const styles = {
  content: {
    flexGrow: 1,
    width: '100%' as const,
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: sizes.screenGutter,
    paddingTop: spacing[8],
    paddingBottom: spacing[8],
  },
  secondaryText: {
    color: colors.textSecondary,
    marginTop: spacing[4],
  },
  hint: {
    minHeight: 52,
    paddingHorizontal: spacing[4],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  hintSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  codeInput: {
    height: 64,
    marginTop: spacing[7],
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 26,
    letterSpacing: 8,
    textAlign: 'center' as const,
  },
  feedback: {
    marginTop: spacing[4],
    padding: spacing[3.5],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(240,86,63,0.35)',
    backgroundColor: 'rgba(240,86,63,0.10)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
  },
  cancel: {
    minHeight: 48,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: spacing[3],
  },
};

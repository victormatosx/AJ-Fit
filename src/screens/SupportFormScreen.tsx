import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, Slash } from '../components/ui/Display';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { SupportImageField } from '../components/support/SupportImageField';
import { SupportChip } from '../components/support/SupportChip';
import { useSupportImagePicker } from '../hooks/useSupportImagePicker';
import { useAuth } from '../state/AuthContext';
import { createSupportCase } from '../services/supportCases';
import { validateSupportTicket } from '../validators/support';
import type { FeedbackCategory, SupportTicketType } from '../types/support';
import { radii, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { logError } from '../lib/logError';
import { useScreenFocusEffect } from '../state/ScreenActivity';

const FEEDBACK_CATEGORIES: FeedbackCategory[] = ['SUGGESTION', 'IDEA', 'COMPLIMENT', 'OTHER'];

export function SupportFormScreen({ type, initialSubject = '', onBack, onSuccess }: { type: SupportTicketType; initialSubject?: string; onBack: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('support');
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('SUGGESTION');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = useSupportImagePicker();
  const feedback = type === 'FEEDBACK';
  const bug = type === 'BUG';

  // Materialized + prewarmed (docs/23_navegacao_e_lifecycle.md §14). Two
  // resets, for two different "new session" signals:
  // - `type`/`initialSubject` identity: covers HelpArticle's "report a
  //   problem about THIS article" opening the form with a different subject
  //   while the form route itself might not toggle inactive->active (same
  //   reasoning as HelpArticleScreen's `article`-keyed reset).
  // - `useScreenFocusEffect`: covers the same type/subject being opened
  //   twice with a real deactivation in between (draft from a cancelled
  //   attempt must not reappear). `submitting` is deliberately left alone —
  //   it already clears itself in `submit`'s `finally`, and forcing it back
  //   to false here could hide a send that's genuinely still in flight.
  useEffect(() => {
    setSubject(initialSubject);
    setMessage('');
    setCategory('SUGGESTION');
    setError(null);
    image.removeImage();
    // Only the identity of the ticket being composed matters here —
    // `image` is a fresh object every render (from useSupportImagePicker)
    // and would otherwise re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, initialSubject]);
  useScreenFocusEffect(() => {
    setSubject(initialSubject);
    setMessage('');
    setCategory('SUGGESTION');
    setError(null);
    image.removeImage();
  });
  const validation = useMemo(() => validateSupportTicket(feedback ? t(`feedback.subjects.${category}`) : subject, message), [category, feedback, message, subject, t]);

  const submit = async () => {
    if (!user || !profile || !validation.subjectValid || !validation.messageValid || submitting) return;
    setSubmitting(true); setError(null);
    try {
      await createSupportCase({ userId: user.uid, userName: profile.profile.name, userEmail: profile.profile.email || user.email || '', type, subject: validation.subject, message: validation.message, attachment: image.attachment });
      onSuccess();
    } catch (err) {
      logError('support:create-ticket', err, { type, hasAttachment: !!image.attachment });
      setError(t('form.errors.sendFailed'));
    } finally { setSubmitting(false); }
  };

  const intro = feedback ? t('feedback.intro') : bug ? t('bug.intro') : null;
  const sendLabel = bug ? t('form.sendBug') : feedback ? t('form.sendFeedback') : t('form.send');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader title={feedback ? t('feedback.title') : type === 'BUG' ? t('bug.title') : t('support.title')} onBack={onBack} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing[5.5], paddingBottom: 40 }}>
            <View style={{ marginBottom: spacing[7] }}>
              <Slash>{feedback ? t('feedback.eyebrow') : t('bug.eyebrow')}</Slash>
              <Display size={28} style={{ marginTop: spacing[3] }}>
                {feedback ? t('feedback.heroTitle') : bug ? t('bug.heroTitle') : t('support.title')}
              </Display>
              {intro && (
                <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 21, marginTop: spacing[3] }}>
                  {intro}
                </Text>
              )}
            </View>

            {feedback ? (
              <View style={{ marginBottom: spacing[5] }}>
                <Slash>{t('feedback.category')}</Slash>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2.5] }}>
                  {FEEDBACK_CATEGORIES.map(item => (
                    <SupportChip key={item} label={t(`feedback.categories.${item}`)} active={category === item} onPress={() => setCategory(item)} />
                  ))}
                </View>
              </View>
            ) : (
              <Field
                index={bug ? 1 : undefined}
                label={t('form.subject')}
                value={subject}
                onChangeText={setSubject}
                placeholder={type === 'BUG' ? t('bug.subjectPlaceholder') : t('support.subjectPlaceholder')}
              />
            )}

            <Field
              index={bug ? 2 : undefined}
              label={feedback ? t('form.message') : t('form.description')}
              value={message}
              onChangeText={setMessage}
              placeholder={feedback ? t('feedback.messagePlaceholder') : type === 'BUG' ? t('bug.descriptionPlaceholder') : t('support.messagePlaceholder')}
              multiline
            />

            <View style={{ marginBottom: spacing[5] }}>
              {bug && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[2.5] }}>
                  <Text style={{ fontFamily: theme.fonts.monoBold, fontSize: 10, letterSpacing: 2, color: theme.colors.primaryEmphasis }}>03</Text>
                  <Slash>{t('form.attachment')}</Slash>
                </View>
              )}
              <SupportImageField attachment={image.attachment} onPick={image.pickImage} onRemove={image.removeImage} />
            </View>

            {error && (
              <Text accessibilityRole="alert" style={{ color: theme.colors.formErrorText, fontFamily: theme.fonts.ui, fontSize: 13, marginBottom: spacing[3] }}>
                {error}
              </Text>
            )}

            <CtaButton onPress={submit} disabled={!validation.subjectValid || !validation.messageValid || submitting || !user || !profile}>
              {submitting ? <ActivityIndicator color={theme.colors.primaryForeground} /> : <CtaText>{sendLabel}</CtaText>}
            </CtaButton>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function Field({ label, index, multiline, ...props }: { label: string; index?: number; value: string; onChangeText: (v: string) => void; placeholder: string; multiline?: boolean }) {
  const [focused, setFocused] = useState(false);
  const { theme } = useTheme();
  return (
    <View style={{ marginBottom: spacing[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
        {index != null && (
          <Text style={{ fontFamily: theme.fonts.monoBold, fontSize: 10, letterSpacing: 2, color: theme.colors.primaryEmphasis }}>
            {String(index).padStart(2, '0')}
          </Text>
        )}
        <Slash>{label}</Slash>
      </View>
      <TextInput
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholderTextColor={theme.colors.textFaint}
        style={{
          marginTop: spacing[2.5],
          minHeight: multiline ? 150 : 52,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: focused ? theme.colors.focus : theme.colors.cardBorder,
          backgroundColor: theme.colors.cardBackground,
          paddingHorizontal: spacing[4],
          paddingVertical: multiline ? spacing[3.5] : 0,
          color: theme.colors.textPrimary,
          fontFamily: theme.fonts.uiMed,
          fontSize: 14,
          lineHeight: 20,
        }}
      />
    </View>
  );
}

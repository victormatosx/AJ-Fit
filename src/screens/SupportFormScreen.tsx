import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Slash } from '../components/ui/Display';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { SupportImageField } from '../components/support/SupportImageField';
import { useSupportImagePicker } from '../hooks/useSupportImagePicker';
import { useAuth } from '../state/AuthContext';
import { createSupportTicket } from '../services/supportTickets';
import { validateSupportTicket } from '../validators/support';
import type { FeedbackCategory, SupportTicketType } from '../types/support';
import { colors, fonts } from '../theme/tokens';
import { logError } from '../lib/logError';
import { useScreenFocusEffect } from '../state/ScreenActivity';

export function SupportFormScreen({ type, initialSubject = '', onBack, onSuccess }: { type: SupportTicketType; initialSubject?: string; onBack: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('support');
  const { user, profile } = useAuth();
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('SUGGESTION');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = useSupportImagePicker();
  const feedback = type === 'FEEDBACK';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  const validation = useMemo(() => validateSupportTicket(feedback ? t(`feedback.subjects.${category}`) : subject, message), [category, feedback, message, subject, t]);

  const submit = async () => {
    if (!user || !profile || !validation.subjectValid || !validation.messageValid || submitting) return;
    setSubmitting(true); setError(null);
    try {
      await createSupportTicket({ userId: user.uid, userName: profile.profile.name, userEmail: profile.profile.email || user.email || '', type, subject: validation.subject, message: validation.message, attachment: image.attachment });
      onSuccess();
    } catch (err) {
      logError('support:create-ticket', err, { type, hasAttachment: !!image.attachment });
      setError(t('form.errors.sendFailed'));
    } finally { setSubmitting(false); }
  };

  return <ScreenBg><SafeAreaView style={{ flex: 1 }} edges={['top']}><SupportScreenHeader title={feedback ? t('feedback.title') : type === 'BUG' ? t('bug.title') : t('support.title')} onBack={onBack} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
        {feedback && <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 14, lineHeight: 21, marginBottom: 22 }}>{t('feedback.intro')}</Text>}
        {feedback ? <><Slash>{t('feedback.category')}</Slash><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 22 }}>{(['SUGGESTION','IDEA','COMPLIMENT','OTHER'] as FeedbackCategory[]).map(item => <Pressable key={item} onPress={() => setCategory(item)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: category === item ? colors.accentHi : colors.cardBorder, backgroundColor: category === item ? 'rgba(11,112,249,0.18)' : colors.cardBg }}><Text style={{ color: category === item ? '#fff' : colors.mute, fontFamily: fonts.uiSemi, fontSize: 12 }}>{t(`feedback.categories.${item}`)}</Text></Pressable>)}</View></> : <Field label={t('form.subject')} value={subject} onChangeText={setSubject} placeholder={type === 'BUG' ? t('bug.subjectPlaceholder') : t('support.subjectPlaceholder')} />}
        <Field label={feedback ? t('form.message') : t('form.description')} value={message} onChangeText={setMessage} placeholder={feedback ? t('feedback.messagePlaceholder') : type === 'BUG' ? t('bug.descriptionPlaceholder') : t('support.messagePlaceholder')} multiline />
        <SupportImageField attachment={image.attachment} onPick={image.pickImage} onRemove={image.removeImage} />
        {error && <Text accessibilityRole="alert" style={{ color: '#ff8d8d', fontFamily: fonts.ui, fontSize: 13, marginTop: 14 }}>{error}</Text>}
        <CtaButton onPress={submit} disabled={!validation.subjectValid || !validation.messageValid || submitting || !user || !profile} style={{ marginTop: 22 }}>{submitting ? <ActivityIndicator color="#fff" /> : <CtaText>{t('form.send')}</CtaText>}</CtaButton>
      </ScrollView>
    </KeyboardAvoidingView></SafeAreaView></ScreenBg>;
}

function Field({ label, multiline, ...props }: { label: string; value: string; onChangeText: (v: string) => void; placeholder: string; multiline?: boolean }) {
  return <View style={{ marginBottom: 20 }}><Slash>{label}</Slash><TextInput {...props} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} placeholderTextColor={colors.faint} style={{ marginTop: 10, minHeight: multiline ? 150 : 52, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardBg, paddingHorizontal: 16, paddingVertical: multiline ? 14 : 0, color: '#fff', fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }} /></View>;
}

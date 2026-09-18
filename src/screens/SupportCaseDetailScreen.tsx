import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { SupportChatImageButton } from '../components/support/SupportChatImageButton';
import { SupportChatAttachmentPreview } from '../components/support/SupportChatAttachmentPreview';
import { SupportImageViewerModal } from '../components/support/SupportImageViewerModal';
import { Icon } from '../components/ui/Icon';
import { useAuth } from '../state/AuthContext';
import { useSupportImagePicker } from '../hooks/useSupportImagePicker';
import { useOptimisticSupportChat } from '../hooks/useOptimisticSupportChat';
import {
  markSupportMessageRead,
  observeSupportCase,
  observeSupportMessages,
  type SupportCase,
  type SupportMessage,
} from '../services/supportCases';
import type { OptimisticSupportMessage } from '../lib/supportChatOptimistic';
import { formatAssessmentShortDateForLocale } from '../lib/dateUtils';
import { radii, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { getSupportAttachmentAccess } from '../services/supportCases';
import {
  formatSupportMessageTime,
  supportComposerBottomPadding,
} from '../lib/supportMessagePresentation';

const CLOSED_STATES: SupportCase['state'][] = ['CLOSED_SINGLE', 'CHAT_CLOSED'];

function ClosedCaseNotice({ purgeAt }: { purgeAt?: { toDate(): Date } | null }) {
  const { t, i18n } = useTranslation('support');
  const { theme } = useTheme();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const purgeDate = purgeAt?.toDate();
  const message = purgeDate
    ? t('detail.closedNoticeWithDate', { date: formatAssessmentShortDateForLocale(purgeDate, locale) })
    : t('detail.closedNotice');

  return <View style={{ marginTop: spacing[3], padding: spacing[3.5], borderRadius: radii.lg, backgroundColor: theme.colors.cardBackground, borderWidth: 1, borderColor: theme.colors.cardBorder }}>
    <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, marginBottom: spacing[1] }}>{t('detail.closedTitle')}</Text>
    <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.ui, lineHeight: 18 }}>{message}</Text>
  </View>;
}

/** Received-image bubble: fetches the temporary signed URL (never a persisted downloadURL) and is clearly tappable to open the full-screen viewer. */
function SecureSupportImage({ caseId, messageId, storagePath, onOpen }: { caseId: string; messageId: string; storagePath: string; onOpen: (url: string) => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('support');
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getSupportAttachmentAccess(caseId, messageId, storagePath).then(url => { if (active) setSource(url); });
    return () => { active = false; };
  }, [caseId, messageId, storagePath]);
  if (!source) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('detail.viewImage')}
      onPress={() => onOpen(source)}
      style={{ marginTop: spacing[3] }}
    >
      <Image source={source} contentFit="cover" style={{ width: 220, height: 150, borderRadius: radii.lg }} />
      <View style={{ position: 'absolute', left: spacing[2], bottom: spacing[2], flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: radii.sm, backgroundColor: 'rgba(2,0,16,0.6)' }}>
        <Icon name="eye" size={12} color="#fff" />
        <Text style={{ marginLeft: spacing[1], color: '#fff', fontSize: 10, fontFamily: theme.fonts.mono }}>{t('detail.viewImage')}</Text>
      </View>
    </Pressable>
  );
}

/**
 * A not-yet-persisted message: appears instantly on tap, before the backend
 * confirms anything. Local-only attachment preview (the file's own `uri`,
 * never a signed URL — there's nothing staged/accessible server-side yet).
 * Tapping a FAILED bubble retries with the exact same `requestId`/`uploadId`
 * (see `retry` in the screen below) — never a fresh send.
 */
function OptimisticMessageBubble({ item, locale, onRetry }: { item: OptimisticSupportMessage; locale: string; onRetry: (item: OptimisticSupportMessage) => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('support');
  const failed = item.status === 'FAILED';
  return (
    <Pressable
      accessibilityRole={failed ? 'button' : undefined}
      accessibilityLabel={failed ? t('detail.sendFailedRetry') : undefined}
      disabled={!failed}
      onPress={() => onRetry(item)}
      style={{ alignSelf: 'flex-end', maxWidth: '86%', marginBottom: spacing[3], padding: spacing[3.5], borderRadius: radii.lg, backgroundColor: theme.colors.primarySoft, borderWidth: 1, borderColor: failed ? theme.colors.formErrorText : theme.colors.cardBorder, opacity: item.status === 'SENDING' ? 0.7 : 1 }}
    >
      {item.message ? <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.ui, lineHeight: 20 }}>{item.message}</Text> : null}
      {item.attachment && <Image source={{ uri: item.attachment.uri }} contentFit="cover" style={{ width: 220, height: 150, borderRadius: radii.lg, marginTop: spacing[3] }} />}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], marginTop: spacing[2] }}>
        <Text style={{ flexShrink: 1, color: failed ? theme.colors.formErrorText : theme.colors.textFaint, fontSize: 10 }}>
          {failed ? t('detail.sendFailedRetry') : item.status === 'SENDING' ? t('detail.sendingStatus') : t('detail.you')}
        </Text>
        <Text style={{ color: theme.colors.textFaint, fontSize: 10 }}>{formatSupportMessageTime(item.createdAtMs, locale)}</Text>
      </View>
    </Pressable>
  );
}

export function SupportCaseDetailScreen({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('support');
  const insets = useSafeAreaInsets();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [supportCase, setSupportCase] = useState<SupportCase | null | undefined>(undefined);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const image = useSupportImagePicker();
  const { pending, send: sendOptimistic, retry } = useOptimisticSupportChat(caseId, messages);
  const authorized = !!user && supportCase?.ownerUid === user.uid;
  const chatOpen = authorized && supportCase?.state === 'CHAT_OPEN' && supportCase.mode === 'CHAT';

  useEffect(() => observeSupportCase(caseId, value => { setSupportCase(value); setError(false); }, () => { setSupportCase(null); setError(true); }), [caseId]);
  useEffect(() => {
    if (!authorized) return;
    return observeSupportMessages(caseId, setMessages, () => setError(true));
  }, [authorized, caseId]);

  const unreadIds = messages.filter(item => item.senderType === 'ADMIN' && !item.readAt).map(item => item.id);
  useEffect(() => {
    if (!authorized) return;
    unreadIds.forEach(messageId => { void markSupportMessageRead(caseId, messageId); });
  }, [authorized, caseId, unreadIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  function send() {
    if (!chatOpen) return;
    const accepted = sendOptimistic(draft, image.attachment ?? null);
    if (!accepted) return;
    setDraft('');
    image.removeImage();
  }

  if (supportCase === undefined) return <ScreenBg><SafeAreaView style={{ flex: 1 }}><SupportScreenHeader title="Atendimento" onBack={onBack} /><ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primaryEmphasis} /></SafeAreaView></ScreenBg>;
  if (!supportCase || !authorized || error) return <ScreenBg><SafeAreaView style={{ flex: 1 }}><SupportScreenHeader title="Atendimento" onBack={onBack} /><Text style={{ margin: spacing[6], color: theme.colors.textSecondary }}>Este atendimento não existe, expirou ou não está disponível para esta conta.</Text></SafeAreaView></ScreenBg>;

  return <ScreenBg><SafeAreaView style={{ flex: 1 }} edges={['top']}>
    <SupportScreenHeader title={supportCase.subject} onBack={onBack} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[5] }}>
        {messages.map(item => <View key={item.id} style={{ alignSelf: item.senderType === 'USER' ? 'flex-end' : 'flex-start', maxWidth: '86%', marginBottom: spacing[3], padding: spacing[3.5], borderRadius: radii.lg, backgroundColor: item.senderType === 'USER' ? theme.colors.primarySoft : theme.colors.cardBackground, borderWidth: 1, borderColor: theme.colors.cardBorder }}>
          {item.message ? <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.ui, lineHeight: 20 }}>{item.message}</Text> : null}
          {item.attachments.map(attachment => <SecureSupportImage key={attachment.storagePath} caseId={caseId} messageId={item.id} storagePath={attachment.storagePath} onOpen={setViewerUrl} />)}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], marginTop: spacing[2] }}>
            <Text style={{ flexShrink: 1, color: theme.colors.textFaint, fontSize: 10 }}>{item.senderType === 'ADMIN' ? t('detail.supportAuthor') : t('detail.you')}</Text>
            <Text style={{ color: theme.colors.textFaint, fontSize: 10 }}>{formatSupportMessageTime(item.createdAt, locale)}</Text>
          </View>
        </View>)}
        {pending.map(item => <OptimisticMessageBubble key={item.requestId} item={item} locale={locale} onRetry={retry} />)}
        {supportCase.state === 'SUBMITTED' && <Text style={{ textAlign: 'center', color: theme.colors.textMuted, marginTop: spacing[3] }}>Aguardando uma decisão do suporte.</Text>}
        {CLOSED_STATES.includes(supportCase.state) && <ClosedCaseNotice purgeAt={supportCase.purgeAt} />}
      </ScrollView>
      {chatOpen && <View style={{ paddingTop: spacing[3], paddingHorizontal: spacing[3], paddingBottom: supportComposerBottomPadding(insets.bottom, spacing[3]), borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.background }}>
        {image.attachment && <SupportChatAttachmentPreview uri={image.attachment.uri} onRemove={image.removeImage} />}
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          <SupportChatImageButton onPress={image.pickImage} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Escreva uma mensagem"
            placeholderTextColor={theme.colors.textFaint}
            multiline
            maxLength={5000}
            style={{ flex: 1, minHeight: 46, maxHeight: 120, borderRadius: radii.lg, borderWidth: 1, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.cardBackground, padding: spacing[3], color: theme.colors.textPrimary }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!draft.trim() && !image.attachment}
            onPress={send}
            style={{ alignSelf: 'flex-end', minHeight: 46, justifyContent: 'center', paddingHorizontal: spacing[4], borderRadius: radii.lg, backgroundColor: theme.colors.primaryEmphasis, opacity: (!draft.trim() && !image.attachment) ? 0.45 : 1 }}
          >
            <Text style={{ color: theme.colors.primaryForeground, fontFamily: theme.fonts.uiSemi }}>{t('form.send')}</Text>
          </Pressable>
        </View>
      </View>}
    </KeyboardAvoidingView>
    <SupportImageViewerModal url={viewerUrl} onClose={() => setViewerUrl(null)} />
  </SafeAreaView></ScreenBg>;
}

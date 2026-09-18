import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `SupportCaseDetailScreen.tsx` cannot be rendered in this project's test
 * suite (no React Native test renderer — same constraint documented across
 * `src/screens/__tests__`). Locks the chat-send UX contract textually: reuses
 * `useSupportImagePicker` (never a second picker), delegates all
 * optimistic-send/retry/reconciliation logic to `useOptimisticSupportChat`
 * (perf audit, 2026-09-17 — never inlines its own copy), and makes a
 * received image clearly tappable to view full-screen.
 *
 * The actual optimistic/reconciliation state machine (SENDING → SENT/FAILED,
 * retry reusing the same requestId/uploadId, real failures, double taps,
 * never matching by text or timestamp) is unit-tested with real assertions
 * in `src/lib/__tests__/supportChatOptimistic.test.ts` (pure reducer) and
 * `src/hooks/__tests__/useOptimisticSupportChat.test.ts` (service wiring,
 * mocked backend) — this file only pins how the screen wires that hook in.
 */
const source = readFileSync(new URL('../SupportCaseDetailScreen.tsx', import.meta.url), 'utf8');

describe('SupportCaseDetailScreen — chat send/attachment contract', () => {
  it('reuses the existing image picker hook — never a second picker implementation', () => {
    expect(source).toContain("from '../hooks/useSupportImagePicker'");
    expect(source).toContain('useSupportImagePicker()');
  });

  it('delegates optimistic send/retry to useOptimisticSupportChat — never re-implements it inline', () => {
    expect(source).toContain("from '../hooks/useOptimisticSupportChat'");
    expect(source).toContain('useOptimisticSupportChat(caseId, messages)');
    expect(source).not.toContain('dispatchSend');
    expect(source).not.toContain('submittingRef');
  });

  it('never blocks the whole composer/conversation while a message is sending (no global "sending" flag on TextInput)', () => {
    expect(source).not.toMatch(/editable=\{!sending\}/);
    expect(source).not.toContain('const [sending, setSending]');
  });

  it('send() only clears the draft/attachment once the hook actually accepts the message', () => {
    const sendFnStart = source.indexOf('function send()');
    const sendFnEnd = source.indexOf('\n  }', sendFnStart);
    const sendFn = source.slice(sendFnStart, sendFnEnd);
    expect(sendFn).toContain('sendOptimistic(draft, image.attachment ?? null)');
    const acceptedIdx = sendFn.indexOf('if (!accepted) return;');
    expect(acceptedIdx).toBeGreaterThan(-1);
    expect(sendFn.indexOf("setDraft('');")).toBeGreaterThan(acceptedIdx);
    expect(sendFn.indexOf('image.removeImage();')).toBeGreaterThan(acceptedIdx);
  });

  it('shows a removable preview before sending, via the shared SupportChatAttachmentPreview component', () => {
    expect(source).toContain("from '../components/support/SupportChatAttachmentPreview'");
    expect(source).toContain('{image.attachment && <SupportChatAttachmentPreview uri={image.attachment.uri} onRemove={image.removeImage} />}');
  });

  it('renders every pending optimistic bubble, wired to the hook\'s retry', () => {
    expect(source).toContain('{pending.map(item => <OptimisticMessageBubble key={item.requestId} item={item} locale={locale} onRetry={retry} />)}');
  });

  it('a FAILED optimistic bubble shows the retry copy', () => {
    expect(source).toContain("t('detail.sendFailedRetry')");
    expect(source).toContain("item.status === 'FAILED'");
  });

  it('makes a received image clearly tappable, opening the full-screen viewer', () => {
    expect(source).toContain('function SecureSupportImage(');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessibilityLabel={t('detail.viewImage')}");
    expect(source).toContain('onPress={() => onOpen(source)}');
    expect(source).toContain("from '../components/support/SupportImageViewerModal'");
    expect(source).toContain('<SupportImageViewerModal url={viewerUrl} onClose={() => setViewerUrl(null)} />');
  });

  it('never renders an empty message bubble line for an image-only message (persisted or optimistic)', () => {
    const occurrences = source.match(/\{item\.message \? <Text/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('shows locale-aware time for persisted and optimistic messages, including image-only bubbles', () => {
    expect(source).toContain('formatSupportMessageTime(item.createdAt, locale)');
    expect(source).toContain('formatSupportMessageTime(item.createdAtMs, locale)');
  });

  it('derives composer bottom padding from the device safe-area inset', () => {
    expect(source).toContain('useSafeAreaInsets()');
    expect(source).toContain('supportComposerBottomPadding(insets.bottom, spacing[3])');
    expect(source).toContain("<KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>");
  });
});

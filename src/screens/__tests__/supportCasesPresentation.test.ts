import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../SupportCasesScreen.tsx', import.meta.url), 'utf8');

describe('SupportCasesScreen presentation', () => {
  it('replaces the old editorial labels with a localized conversation search field', () => {
    expect(source).not.toContain('<Slash>');
    expect(source).not.toContain('<Display');
    expect(source).toContain("placeholder={t('cases.search')}");
    expect(source).toContain('matchesSupportCaseSearch(item.subject, item.lastMessage, search, locale)');
    expect(source).toContain('visibleCases.map(item =>');
    expect(source).toContain("t('cases.noResults')");
  });

  it('keeps the card list realtime through the existing case observer', () => {
    expect(source).toContain('observeOwnSupportCases(user.uid');
    expect(source).toContain('setCases(value)');
  });

  it('derives status and unread presentation from pure server-backed helpers', () => {
    expect(source).toContain('supportCaseStatusKind(item.state)');
    expect(source).toContain('hasUnreadSupportMessage(item.unreadByUserCount)');
    expect(source).toContain("t('cases.newMessage')");
    expect(source).toContain("t('cases.status.closed')");
  });

  it('does not mark messages read merely by rendering or opening the list', () => {
    expect(source).not.toContain('markSupportMessageRead');
    expect(source).not.toContain('readAt');
  });

  it('shows only a restrained, localized closed status and no open-status card', () => {
    expect(source).toContain("const closed = statusKind === 'closed'");
    expect(source).toContain("{closed && (");
    expect(source).toContain("{t('cases.status.closed')}");
    expect(source).not.toContain("t(`cases.status.${statusKind}`)");
    expect(source).not.toContain('borderColor: statusColor');
  });

  it('uses the requested avatar, conversation and right-side metadata columns', () => {
    const avatar = source.indexOf('accessibilityLabel={t(\'cases.supportAvatar\')}');
    const subject = source.indexOf('{item.subject}', avatar);
    const metadata = source.indexOf("<View style={{ width: 74, alignSelf: 'stretch'", subject);
    expect(avatar).toBeGreaterThan(-1);
    expect(subject).toBeGreaterThan(avatar);
    expect(metadata).toBeGreaterThan(subject);
    expect(source).toContain('{item.lastMessage}');
  });

  it('places the unread count above the status pill in the right column', () => {
    const rightColumn = source.indexOf("<View style={{ width: 74, alignSelf: 'stretch'");
    const unread = source.indexOf('{unreadLabel}', rightColumn);
    const status = source.indexOf("{t('cases.status.closed')}", rightColumn);
    expect(unread).toBeGreaterThan(rightColumn);
    expect(status).toBeGreaterThan(unread);
  });

  it('shows the locale-aware real last-message time, not the case updatedAt', () => {
    expect(source).toContain('formatSupportConversationTimestamp(');
    expect(source).toContain('item.lastMessageAt');
    expect(source).not.toContain('item.updatedAt');
    expect(source).toContain('{lastMessageTimestamp}');
  });
});

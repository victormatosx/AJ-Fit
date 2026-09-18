import { describe, expect, it } from 'vitest';

import {
  formatSupportConversationTimestamp,
  formatSupportMessageTime,
  hasUnreadSupportMessage,
  matchesSupportCaseSearch,
  supportCaseStatusKind,
  supportComposerBottomPadding,
} from '../supportMessagePresentation';

describe('support message presentation', () => {
  it('formats persisted and optimistic timestamps with the requested locale', () => {
    const date = new Date(2026, 8, 18, 14, 5);
    const expected = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
    expect(formatSupportMessageTime({ toDate: () => date }, 'pt-BR')).toBe(expected);
    expect(formatSupportMessageTime(date.getTime(), 'pt-BR')).toBe(expected);
  });

  it('formats list timestamps by local calendar day', () => {
    const now = new Date(2026, 8, 18, 16, 30);
    const today = new Date(2026, 8, 18, 14, 5);
    const yesterday = new Date(2026, 8, 17, 14, 5);
    const older = new Date(2026, 8, 16, 14, 5);
    const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(today);
    const olderDate = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    }).format(older);

    expect(formatSupportConversationTimestamp(today, 'pt-BR', 'Ontem', now)).toBe(time);
    expect(formatSupportConversationTimestamp(yesterday, 'pt-BR', 'Ontem', now)).toBe(`Ontem · ${time}`);
    expect(formatSupportConversationTimestamp(older, 'pt-BR', 'Ontem', now)).toBe(`${olderDate} · ${time}`);
  });

  it.each([
    ['SUBMITTED', 'open'],
    ['CHAT_OPEN', 'open'],
    ['CLOSED_SINGLE', 'closed'],
    ['CHAT_CLOSED', 'closed'],
  ] as const)('maps %s to the accessible %s status', (state, expected) => {
    expect(supportCaseStatusKind(state)).toBe(expected);
  });

  it('derives the new-message badge only from the server unread count', () => {
    expect(hasUnreadSupportMessage(0)).toBe(false);
    expect(hasUnreadSupportMessage(2)).toBe(true);
  });

  it('searches conversation subject and last message without accent sensitivity', () => {
    expect(matchesSupportCaseSearch('Assinatura Premium', 'Pagamento aprovado', 'assinatura', 'pt-BR')).toBe(true);
    expect(matchesSupportCaseSearch('Dúvida no treino', 'Como trocar exercício?', 'duvida', 'pt-BR')).toBe(true);
    expect(matchesSupportCaseSearch('Conta', 'Alterar e-mail', 'treino', 'pt-BR')).toBe(false);
    expect(matchesSupportCaseSearch('Conta', 'Alterar e-mail', '  ', 'pt-BR')).toBe(true);
  });

  it('uses the real safe-area inset without losing the normal composer padding', () => {
    expect(supportComposerBottomPadding(34, 12)).toBe(34);
    expect(supportComposerBottomPadding(0, 12)).toBe(12);
  });
});

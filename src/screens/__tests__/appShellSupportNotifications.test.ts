import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the Support V2 unread badge + native foreground
 * wired into AppShell. No component renderer exists in this Node-only suite
 * (see appShellNavigationStructure.test.ts) — these assertions read the
 * source directly. Each check maps to a hard requirement: the badge must
 * come from Firestore's real `unreadByUserCount` (never a local counter),
 * support presentation. Support messages must not subscribe to a second
 * in-app banner path, while native presentation, exact-case suppression and
 * cold-start/background deep-link routing stay wired.
 */
const SOURCE = readFileSync('src/screens/AppShell.tsx', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const PUSH_SOURCE = readFileSync('src/services/pushNotifications.ts', 'utf8');

describe('AppShell — Home support badge', () => {
  it('derives the badge count from useUnreadSupportCasesCount, keyed by the signed-in uid', () => {
    expect(SOURCE).toContain("from '../hooks/useUnreadSupportCasesCount'");
    expect(CODE).toContain('useUnreadSupportCasesCount(user?.uid)');
  });

  it('passes the live count and an open-cases callback into HomeScreen — never a hardcoded/static value', () => {
    expect(CODE).toContain('unreadSupportCasesCount={unreadSupportCasesCount}');
    expect(CODE).toContain("onOpenSupportCases={() => setSupportRoute({ name: 'cases', origin: 'home' })}");
  });

  it('never maintains a second, independently incremented unread counter for the badge', () => {
    expect(CODE).not.toMatch(/unreadSupportCasesCount\s*[+-]=/);
    expect(CODE).not.toMatch(/setUnreadSupportCasesCount/);
  });
});

describe('AppShell — no in-app support notification', () => {
  it('does not subscribe support messages to an in-app foreground banner', () => {
    expect(CODE).not.toContain('subscribeToForegroundMessages(');
    expect(CODE).not.toContain('resolveSupportForegroundNotice(');
    expect(CODE).not.toContain('SupportForegroundBanner');
    expect(CODE).not.toContain('supportBanner');
  });

  it('keeps the general foreground push pipeline available for other consumers', () => {
    expect(PUSH_SOURCE).toContain('subscribeToForegroundMessages');
    expect(PUSH_SOURCE).toContain('addNotificationReceivedListener(receiveNotification)');
  });

  it('keeps the native exact-case presentation policy connected', () => {
    expect(SOURCE).toContain("from '../services/pushNotifications'");
    expect(CODE).toContain("setForegroundSupportCaseId(supportRoute?.name === 'case' ? supportRoute.caseId : null)");
  });
});

describe('AppShell — cold start / background open path is untouched', () => {
  it('still consumes the "support-case" deep-link intent (DeepLinkContext) for cold start/background taps', () => {
    expect(CODE).toContain("pendingIntent.type === 'support-case'");
    expect(CODE).toContain("setSupportRoute({ name: 'case', caseId: pendingIntent.caseId, casesOrigin: 'home' });");
    expect(CODE).toContain('consumeIntent(pendingIntent);');
  });
});

describe('AppShell — contextual support back navigation', () => {
  it('records whether the cases list was opened from Home or Help Center', () => {
    expect(CODE).toContain("onOpenSupportCases={() => setSupportRoute({ name: 'cases', origin: 'home' })}");
    expect(CODE).toContain("onOpenMySupportCases={() => setSupportRoute({ name: 'cases', origin: 'help' })}");
  });

  it('returns the list to its origin and carries that origin through case detail', () => {
    expect(CODE).toContain("supportRoute.origin === 'help' ? { name: 'help' } : null");
    expect(CODE).toContain('casesOrigin: supportRoute.origin');
    expect(CODE).toContain("setSupportRoute({ name: 'cases', origin: supportRoute.casesOrigin })");
  });

  it('synchronizes the exact open case with the foreground native presentation policy', () => {
    expect(CODE).toContain("setForegroundSupportCaseId(supportRoute?.name === 'case' ? supportRoute.caseId : null)");
  });
});

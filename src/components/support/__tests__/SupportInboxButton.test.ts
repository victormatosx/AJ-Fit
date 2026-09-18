import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `SupportInboxButton.tsx` cannot be rendered in this project's test suite
 * (no React Native test renderer — same constraint documented across
 * `src/components/**\/__tests__`). Locks the contract textually: the badge
 * is driven purely by the `unreadCasesCount` prop (never local state), hides
 * at 0, caps its label at "9+", and uses the existing i18n keys/design
 * tokens instead of inventing new ones.
 */
const source = readFileSync(new URL('../SupportInboxButton.tsx', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../../../screens/HomeScreen.tsx', import.meta.url), 'utf8');

describe('SupportInboxButton — badge contract', () => {
  it('has no local state — the badge is a pure function of the unreadCasesCount prop', () => {
    expect(source).not.toContain('useState');
    expect(source).not.toContain('useEffect');
  });

  it('only shows the badge when unreadCasesCount is greater than 0', () => {
    expect(source).toContain('const hasUnread = unreadCasesCount > 0;');
    expect(source).toContain('{hasUnread && (');
  });

  it('is not mounted by Home when the realtime total is zero, leaving no hidden hit area or layout placeholder', () => {
    expect(homeSource).toContain('{onOpenSupportCases && unreadSupportCasesCount > 0 && (');
    expect(homeSource).not.toContain('opacity: unreadSupportCasesCount');
    expect(homeSource).not.toContain('pointerEvents={unreadSupportCasesCount');
  });

  it('does not mark anything read when pressed; it only invokes navigation', () => {
    expect(source).not.toContain('markSupportMessageRead');
    expect(source).toContain('onPress={onPress}');
  });

  it('caps the visible count label at "9+"', () => {
    expect(source).toContain("unreadCasesCount > 9 ? '9+' : unreadCasesCount");
  });

  it('uses the existing home i18n namespace for its accessibility label, in both unread/no-unread forms', () => {
    expect(source).toContain("useTranslation('home')");
    expect(source).toContain("t('support.iconLabelUnread', { count: unreadCasesCount })");
    expect(source).toContain("t('support.iconLabel')");
  });

  it('matches WorkoutRestHeaderStatus header-button sizing (42x42, radius 13)', () => {
    expect(source).toContain('width: 42');
    expect(source).toContain('height: 42');
    expect(source).toContain('borderRadius: 13');
  });

  it('is a real button (accessibilityRole) that calls the onPress prop, never navigating itself', () => {
    expect(source).toContain("accessibilityRole=\"button\"");
    expect(source).toContain('onPress={onPress}');
  });
});

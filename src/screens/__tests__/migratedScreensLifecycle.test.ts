import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Guard rails for the visual-vs-functional lifecycle separation
 * (docs/23_navegacao_e_lifecycle.md §14, "Migração das telas não
 * sensíveis"). No component renderer in this Node-only suite (see
 * vitest.config.mts) — these lock the *pattern* each migrated screen must
 * keep using, not the runtime behavior itself (that's the manual/E2E pass).
 */

function code(path: string): string {
  const source = readFileSync(path, 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('AssessmentScreen — data refresh follows activation, not just mount', () => {
  const CODE = code('src/screens/AssessmentScreen.tsx');

  it('re-fetches assessments via useScreenFocusEffect', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    expect(CODE).toMatch(/useScreenFocusEffect\(\(\) => \{\s*refresh\(\);/);
  });
});

describe('EditProfileScreen — draft resets explicitly per session, not via unmount', () => {
  const CODE = code('src/screens/EditProfileScreen.tsx');

  it('imports useScreenFocusEffect and resets every draft field on activation', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    const block = CODE.slice(CODE.indexOf('useScreenFocusEffect(() => {'));
    for (const setter of [
      'setName(savedName)',
      'setPendingPhoto(undefined)',
      'setBirthDay(initialDate.day)',
      'setBirthMonth(initialDate.month)',
      'setBirthYear(initialDate.year)',
      'setHeightCmText(',
      'setHeightFeetText(',
      'setHeightInchesText(',
      'setNameTouched(false)',
      'setBirthTouched(false)',
      'setHeightTouched(false)',
      'setSubmitError(null)',
    ]) {
      expect(block.slice(0, block.indexOf('});') + 3)).toContain(setter);
    }
  });

  it('does not force-reset in-flight operation flags on activation (would hide a real running save/upload)', () => {
    const block = CODE.slice(
      CODE.indexOf('useScreenFocusEffect(() => {'),
      CODE.indexOf('});', CODE.indexOf('useScreenFocusEffect(() => {')) + 3,
    );
    expect(block).not.toContain('setSaving(false)');
    expect(block).not.toContain('setProcessingPhoto(false)');
    expect(block).not.toContain('setUploadProgress(null)');
    expect(block).not.toContain('saveLock.current = false');
    expect(block).not.toContain('photoSelectionLock.current = false');
  });
});

describe('HelpArticleScreen — feedback state keyed on article identity', () => {
  const CODE = code('src/screens/HelpArticleScreen.tsx');

  it('resets `resolved` when the article prop changes, not only on (re)activation', () => {
    // This screen can go straight from one article to another without ever
    // becoming inactive in between (both route to supportRoute.name ===
    // 'article') — a useScreenFocusEffect alone would miss that transition.
    expect(CODE).toMatch(/useEffect\(\(\) => \{\s*setResolved\(null\);\s*\}, \[article\.id\]\)/);
  });
});

describe('SupportFormScreen — draft resets on new ticket identity and on reactivation', () => {
  const CODE = code('src/screens/SupportFormScreen.tsx');

  it('resets on [type, initialSubject] identity change', () => {
    expect(CODE).toMatch(/\}, \[type, initialSubject\]\)/);
  });

  it('also resets via useScreenFocusEffect, for the same type/subject reopened after a real deactivation', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    expect(CODE).toContain('useScreenFocusEffect(() => {');
  });

  it('does not force-reset `submitting` (self-clears in submit()\'s finally block)', () => {
    const lastEffectStart = CODE.lastIndexOf('useScreenFocusEffect(() => {');
    const block = CODE.slice(lastEffectStart, CODE.indexOf('});', lastEffectStart) + 3);
    expect(block).not.toContain('setSubmitting(false)');
  });
});

describe('SubscriptionCenterScreen — offerings refresh follows activation, not just mount', () => {
  const CODE = code('src/screens/SubscriptionCenterScreen.tsx');

  it('loads offerings via useScreenFocusEffect', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    expect(CODE).toMatch(/useScreenFocusEffect\(\(\) => \{\s*void loadOfferings\(\);/);
  });

  it('does not force-reset `action` (self-clears at the end of handleManage/handleRestore)', () => {
    const block = CODE.slice(
      CODE.indexOf('useScreenFocusEffect(() => {'),
      CODE.indexOf('});', CODE.indexOf('useScreenFocusEffect(() => {')) + 3,
    );
    expect(block).not.toContain('setAction(null)');
  });
});

describe('ProgressPhotosScreen — NOT migrated (real security blocker, docs/23 §6)', () => {
  const CODE = code('src/screens/ProgressPhotosScreen.tsx');

  it('still locks the vault on unmount — this is exactly why it was not persisted', () => {
    expect(CODE).toMatch(/useEffect\(\(\) => \(\) => lock\(\), \[lock\]\)/);
  });
});

describe('ChangePasswordScreen — sensitive fields wiped on deactivation, not on mount (docs/23 §10)', () => {
  const CODE = code('src/screens/ChangePasswordScreen.tsx');

  it('clears all 3 password fields in the useScreenFocusEffect cleanup, not the activation body', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    const start = CODE.indexOf('useScreenFocusEffect(() => {');
    const cleanupStart = CODE.indexOf('return () => {', start);
    const cleanupBlock = CODE.slice(cleanupStart, CODE.indexOf('};', cleanupStart) + 2);
    expect(cleanupBlock).toContain("change.setCurrentPassword('')");
    expect(cleanupBlock).toContain("change.setNewPassword('')");
    expect(cleanupBlock).toContain("change.setConfirmation('')");
  });

  it('does not clear password fields on activation — only on deactivation', () => {
    const start = CODE.indexOf('useScreenFocusEffect(() => {');
    const cleanupStart = CODE.indexOf('return () => {', start);
    const activationBody = CODE.slice(start, cleanupStart);
    expect(activationBody).not.toContain('setCurrentPassword');
  });
});

describe('TwoFactorSettingsScreen — reauth state wiped on deactivation without flashing the factor list (docs/23 §10)', () => {
  const CODE = code('src/screens/TwoFactorSettingsScreen.tsx');

  it('refreshes the factor list on activation and wipes the disable-flow on deactivation', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    expect(CODE).toMatch(/useScreenFocusEffect\(\(\) => \{\s*void mfa\.refresh\(\);/);
    const start = CODE.indexOf('useScreenFocusEffect(() => {');
    const cleanupStart = CODE.indexOf('return () => {', start);
    const cleanupBlock = CODE.slice(cleanupStart, CODE.indexOf('};', cleanupStart) + 2);
    expect(cleanupBlock).toContain('mfa.cancelDisable()');
  });

  it('does not clear `factors` on deactivation — would cause an empty-list flash on the next activation', () => {
    const start = CODE.indexOf('useScreenFocusEffect(() => {');
    const cleanupStart = CODE.indexOf('return () => {', start);
    const cleanupBlock = CODE.slice(cleanupStart, CODE.indexOf('};', cleanupStart) + 2);
    expect(cleanupBlock).not.toContain('setFactors');
  });

  it('gates every definitive-content block on mfa.loading, never on mfa.refreshing', () => {
    // The 2024-round fix (docs/23 §10): `loading` means "never resolved
    // once" and must be the only gate for "Ativar"/enabled content;
    // `refreshing` (background revalidation) must never hide content —
    // it's only wired into the small activity indicator.
    for (const gate of [
      "!mfa.enabled && !mfa.loading && !statusUnavailable",
      'mfa.enabled && !mfa.loading',
    ]) {
      expect(CODE).toContain(gate);
    }
    expect(CODE).not.toMatch(/!mfa\.refreshing/);
  });

  it('shows the activity indicator during both initial loading and background refresh', () => {
    expect(CODE).toContain('(mfa.loading || mfa.refreshing)');
  });
});

describe('TotpEnrollmentScreen — enrollment secret wiped on deactivation, never resumed stale (docs/23 §10)', () => {
  const CODE = code('src/screens/TotpEnrollmentScreen.tsx');

  it('reuses the existing cancel() as the deactivation cleanup — no bespoke secret-clearing logic', () => {
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    const start = CODE.indexOf('useScreenFocusEffect(() => {');
    const cleanupStart = CODE.indexOf('return () => {', start);
    const cleanupBlock = CODE.slice(cleanupStart, CODE.indexOf('};', cleanupStart) + 2);
    expect(cleanupBlock).toContain('enrollment.cancel()');
  });
});

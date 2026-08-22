import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the AJ Fit custom router (docs/23_navegacao_e_
 * lifecycle.md). AppShell renders React Native views, so there's no
 * component renderer in this Node-only unit suite (see vitest.config.mts) —
 * these assertions read the source directly, the same pattern already used
 * for PhotoVaultContext's wiring guarantees.
 *
 * Each check corresponds to a rule that, if silently reverted, reintroduces
 * the intermittent entry-flicker bug this architecture fixed. Full render
 * behavior (does the screen actually stay mounted, does the tab bar not
 * shift the layout, is the first presentation actually artifact-free) still
 * needs the manual/E2E pass in the doc above — Jest has no reliable native
 * layout here.
 */

const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const APP_SHELL_CODE = APP_SHELL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Boolean-flag secondary screens now covered by PersistentScreen (docs/23 §6). */
const MIGRATED_FLAGS = [
  'showCal',
  'showAssessment',
  'showSettings',
  'showSecurity',
  'showEditProfile',
  'showSubscriptionCenter',
  'showDeleteAccount',
];

/** Screens still ephemeral — sensitive/transactional, per docs/23 §10/§17. */
const STILL_EPHEMERAL_FLAGS: string[] = [];

function blockBetween(start: string, endMarker = '</PersistentScreen>'): string {
  const startIdx = APP_SHELL_CODE.indexOf(start);
  expect(startIdx, `"${start}" not found in AppShell.tsx`).toBeGreaterThan(-1);
  const endIdx = APP_SHELL_CODE.indexOf(endMarker, startIdx);
  return APP_SHELL_CODE.slice(startIdx, endIdx);
}

describe('AppShell main-tab lifecycle', () => {
  it('wraps Home, Progress and Profile in PersistentScreen with materialized inactiveMode', () => {
    for (const tab of ['home', 'progress', 'profile']) {
      const block = blockBetween(`active={tab === '${tab}'}`);
      expect(block).toContain('activeStyle={FULL_BLEED.tab}');
      expect(block).toContain('inactiveMode="materialized"');
    }
  });

  it('does not reintroduce bare conditional mount/unmount for a persistent tab', () => {
    expect(APP_SHELL_CODE).not.toMatch(/\{tab === 'home' &&/);
    expect(APP_SHELL_CODE).not.toMatch(/\{tab === 'progress' &&/);
    expect(APP_SHELL_CODE).not.toMatch(/\{tab === 'profile' &&/);
  });

  it('keeps Workout as the documented conditional-mount exception', () => {
    expect(APP_SHELL_CODE).toMatch(/\{tab === 'workout' &&/);
    expect(APP_SHELL_CODE).not.toContain("active={tab === 'workout'}");
  });

  it('imports PersistentScreen and the centralized prewarm queue', () => {
    expect(APP_SHELL_CODE).toContain(
      "import { PersistentScreen } from '../components/navigation/PersistentScreen'",
    );
    expect(APP_SHELL_CODE).toContain(
      "import { usePrewarmQueue } from '../components/navigation/usePrewarmQueue'",
    );
    // The old hand-chained hook must not come back.
    expect(APP_SHELL_CODE).not.toContain('usePrewarm(');
  });

  it('does not leave temporary transition-diagnostic instrumentation in the source', () => {
    expect(APP_SHELL_CODE).not.toContain('transitionDiagnostics');
    expect(APP_SHELL_CODE).not.toContain('tdLog');
    expect(APP_SHELL_CODE).not.toContain('TdProfiler');
    expect(APP_SHELL_CODE).not.toContain('[transitionDiagnostic]');
  });
});

describe('AppShell centralized prewarm queue', () => {
  it('calls usePrewarmQueue exactly once — no manual per-screen scheduling', () => {
    expect(APP_SHELL_CODE).toContain('const prewarmed = usePrewarmQueue()');
    expect(APP_SHELL_CODE.match(/usePrewarmQueue\(/g)?.length).toBe(1);
  });

  it('feeds each PersistentScreen its own flag from the centralized queue result', () => {
    const cases: Array<[string, string]> = [
      ["active={tab === 'progress'}", 'prewarm={prewarmed.PROGRESS}'],
      ["active={tab === 'profile'}", 'prewarm={prewarmed.PROFILE}'],
      ['active={showCal}', 'prewarm={prewarmed.CONSISTENCY}'],
      ['active={showAssessment}', 'prewarm={prewarmed.ASSESSMENT}'],
      ['active={showSettings}', 'prewarm={prewarmed.SETTINGS}'],
      ['active={showSecurity}', 'prewarm={prewarmed.SECURITY}'],
      ['active={showEditProfile}', 'prewarm={prewarmed.EDIT_PROFILE}'],
      ['active={showSubscriptionCenter}', 'prewarm={prewarmed.SUBSCRIPTION_CENTER}'],
      [
        'active={showChangePassword && canChangePassword}',
        'prewarm={prewarmed.CHANGE_PASSWORD}',
      ],
    ];
    for (const [activeProp, prewarmProp] of cases) {
      expect(blockBetween(activeProp)).toContain(prewarmProp);
    }
  });

  it('gives Home no prewarm — it is active from the very first render', () => {
    const block = blockBetween("active={tab === 'home'}");
    expect(block).not.toContain('prewarm=');
  });
});

describe('AppShell secondary-screen coverage (docs/23 §6)', () => {
  it('wraps every migrated secondary screen in PersistentScreen with materialized inactiveMode', () => {
    for (const flag of MIGRATED_FLAGS) {
      const block = blockBetween(`active={${flag}}`);
      expect(block).toContain('inactiveMode="materialized"');
      expect(APP_SHELL_CODE).not.toMatch(new RegExp(`\\{${flag} &&`));
    }
  });

  it('wraps ChangePasswordScreen in PersistentScreen with its compound active condition preserved', () => {
    const block = blockBetween('active={showChangePassword && canChangePassword}');
    expect(block).toContain('inactiveMode="materialized"');
    expect(APP_SHELL_CODE).not.toMatch(/\{showChangePassword && canChangePassword &&/);
  });

  it('keeps every still-ephemeral secondary screen as a bare conditional (docs/23 §10/§17)', () => {
    for (const flag of STILL_EPHEMERAL_FLAGS) {
      expect(APP_SHELL_CODE).toMatch(new RegExp(`\\{${flag} &&`));
      expect(APP_SHELL_CODE).not.toContain(`active={${flag}}`);
    }
    // Paywall (showPremium) is also still ephemeral, but doesn't follow the
    // showX naming used for the state check above as cleanly as the others
    // — checked directly.
    expect(APP_SHELL_CODE).toMatch(/\{showPremium &&/);
    expect(APP_SHELL_CODE).not.toContain('active={showPremium}');
  });
});

describe('AppShell Support flow (docs/23 §14 "Suporte")', () => {
  it('prewarms HelpCenter and Success — they take no data prop', () => {
    const help = blockBetween("active={supportRoute?.name === 'help'}");
    expect(help).toContain('prewarm={prewarmed.SUPPORT}');
    const success = blockBetween("active={supportRoute?.name === 'success'}");
    expect(success).toContain('prewarm={prewarmed.SUPPORT}');
  });

  it('does not prewarm HelpArticle/SupportForm — they need real data first', () => {
    const article = blockBetween("active={supportRoute?.name === 'article'}");
    expect(article).not.toContain('prewarm=');
    const form = blockBetween("active={supportRoute?.name === 'form'}");
    expect(form).not.toContain('prewarm=');
  });

  it('latches the last real article/form route so materialized screens never render with missing data', () => {
    expect(APP_SHELL_CODE).toContain('const [lastArticle, setLastArticle] = useState<HelpArticle | null>(null)');
    expect(APP_SHELL_CODE).toContain('setLastArticle(article)');
    expect(APP_SHELL_CODE).toContain('setLastFormRoute(');
  });

  it('guards HelpArticleScreen from ever mounting without an article', () => {
    const idx = APP_SHELL_CODE.indexOf("active={supportRoute?.name === 'article'}");
    const before = APP_SHELL_CODE.slice(Math.max(0, idx - 60), idx);
    expect(before).toContain('lastArticle && (');
  });
});

describe('AppShell sensitive-screen shell/secret separation (docs/23 §10)', () => {
  it('documents that each sensitive screen wipes its own state on deactivation, not AppShell', () => {
    // The cleanup lives in each screen's own useScreenFocusEffect (verified
    // in migratedScreensLifecycle.test.ts) — AppShell only needs to wire
    // active/prewarm/materialized like any other screen, never touch
    // password/secret state directly.
    for (const activeProp of ['active={showChangePassword && canChangePassword}']) {
      const block = blockBetween(activeProp);
      // The screen name legitimately contains "password" — AppShell must not
      // read or write its sensitive state (that stays inside the screen hook).
      expect(block).not.toMatch(/currentPassword|newPassword/);
    }
  });
});

describe('AppShell overlay geometry stability', () => {
  it('never removes the tab bar from layout because an overlay is open', () => {
    expect(APP_SHELL_CODE).not.toMatch(/!overlayOpen && <TabBar/);
    expect(APP_SHELL_CODE).toMatch(/\{tab !== 'workout' && \(/);
  });

  it('hides the tab bar from touch and accessibility while an overlay is open', () => {
    const tabBarBlock = APP_SHELL_CODE.slice(
      APP_SHELL_CODE.indexOf("{tab !== 'workout' && ("),
      APP_SHELL_CODE.indexOf('<TabBar'),
    );
    expect(tabBarBlock).toContain("pointerEvents={overlayOpen ? 'none' : 'auto'}");
    expect(tabBarBlock).toContain('accessibilityElementsHidden={overlayOpen}');
    expect(tabBarBlock).toContain(
      "importantForAccessibility={overlayOpen ? 'no-hide-descendants' : 'auto'}",
    );
  });

  it('keeps FULL_BLEED geometry (tab + overlay z-layers) as the single source of truth', () => {
    expect(APP_SHELL_CODE).toContain(
      "tab: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }",
    );
    expect(APP_SHELL_CODE).toContain(
      "overlayZ40: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 }",
    );
    expect(APP_SHELL_CODE).toContain(
      "overlayZ50: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }",
    );
    expect(APP_SHELL_CODE).toContain(
      "overlayZ60: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 60 }",
    );
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fase 5 (docs/13_assinaturas_e_billing.md): `<PremiumAction>`, the
 * declarative primitive on top of Fase 4's `usePremiumAction`/
 * `requestPremiumAction`. Source-inspection suite, same pattern as
 * `premiumCapabilitiesPolicyFase3.test.ts`/`premiumActionUxFase4.test.ts` —
 * no component renderer in this Node-only suite (vitest.config.mts); a
 * function component that calls hooks can't be invoked directly outside
 * React's render (no dispatcher), so behavioral guarantees are proven at
 * the layers that ARE plain functions: `canPerformPremiumCapability`/
 * `resolvePremiumCapabilities` (`premiumCapabilities.test.ts`, Fase 2) for
 * "denied never allows", and the wiring proven here for "PremiumAction
 * calls exactly those functions, in the right order, nothing else".
 */
function source(path: string): string {
  return readFileSync(path, 'utf8');
}
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('FASE 5 — PremiumAction is a thin layer over Fase 4, not a new system', () => {
  const raw = source('src/components/premium/PremiumAction.tsx');
  const code = stripComments(raw);

  it('reuses usePremiumCapabilities + usePremiumAction — no independent decision path', () => {
    expect(raw).toContain(
      "import { usePremiumCapabilities } from '../../hooks/usePremiumCapabilities';",
    );
    expect(raw).toContain(
      "import { usePremiumAction } from '../../state/PremiumActionContext';",
    );
  });

  it('locked is exactly !canPerform(capability) — the same read requestPremiumAction uses to decide', () => {
    expect(code).toContain('const locked = !canPerform(capability);');
  });

  it('onPress always routes through requestPremiumAction — never calls onAllowed directly itself', () => {
    const onPressBody = code.slice(code.indexOf('const onPress = () => {'), code.indexOf('};', code.indexOf('const onPress = () => {')));
    expect(onPressBody).toContain('requestPremiumAction({ capability, onAllowed });');
    expect(onPressBody).not.toContain('onAllowed();');
  });

  it('is headless — returns children(...) directly, no wrapping View/Pressable of its own', () => {
    expect(code).toContain('return children({ locked, onPress });');
    expect(code).not.toContain('<View');
    expect(code).not.toContain('<Pressable');
  });

  it('capability is typed against the existing PremiumCapability union — no second union created', () => {
    expect(raw).toContain(
      "import type { PremiumCapability } from '../../lib/premiumCapabilities';",
    );
    expect(code).toContain('capability: PremiumCapability;');
  });

  it('has no independent React state — nothing here can desync from usePremiumCapabilities/usePremiumAction, and no callback can survive unmount for later replay', () => {
    expect(code).not.toContain('useState');
    expect(code).not.toContain('useEffect');
    expect(code).not.toContain('useRef');
  });

  it('knows nothing about RevenueCat, Firestore, CustomerInfo, subscription status, offerings, purchase/restore or Paywall', () => {
    for (const forbidden of [
      'Purchases',
      'revenueCatService',
      'firestore',
      'CustomerInfo',
      'subscriptionCenter',
      'premiumUpgradeIntent',
      'offerings',
      'purchase',
      'restore',
      'PaywallScreen',
      'isPremium',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('FASE 5 — no parallel provider/modal was created', () => {
  it('exactly one Premium action provider exists in the codebase', () => {
    const stateFiles = [
      'src/state/PremiumActionContext.tsx',
    ];
    for (const path of stateFiles) expect(source(path)).toBeTruthy();
    for (const forbidden of [
      'PremiumActionProviderV2',
      'PremiumGateProvider',
      'PremiumModalProvider',
      'PremiumActionContext2',
    ]) {
      for (const path of [
        'src/state/PremiumActionContext.tsx',
        'src/components/premium/PremiumAction.tsx',
        'src/components/premium/PremiumRequiredSheet.tsx',
      ]) {
        expect(source(path)).not.toContain(forbidden);
      }
    }
  });

  it('exactly one blocked-action sheet component exists — PremiumAction reuses PremiumRequiredSheet, never a new one', () => {
    const provider = stripComments(source('src/state/PremiumActionContext.tsx'));
    expect(provider).toContain(
      "import { PremiumRequiredSheet } from '../components/premium/PremiumRequiredSheet';",
    );
    for (const forbidden of ['PremiumActionModal', 'PremiumGateModal', 'LockedFeatureSheet']) {
      expect(source('src/components/premium/PremiumAction.tsx')).not.toContain(forbidden);
    }
  });
});

describe('FASE 5 — START_WORKOUT, ADD_PROGRESS_PHOTO and CREATE_ASSESSMENT visual entry points migrated', () => {
  it('AppShell imports <PremiumAction> and wraps the confirm CTA with it', () => {
    const appShell = source('src/screens/AppShell.tsx');
    expect(appShell).toContain(
      "import { PremiumAction } from '../components/premium/PremiumAction';",
    );
    expect(appShell).toContain('<PremiumAction capability="START_WORKOUT" onAllowed={onConfirm}>');
  });

  it('ProgressPhotosScreen imports <PremiumAction> and wraps the primary "add" CTA with it', () => {
    const screen = source('src/screens/ProgressPhotosScreen.tsx');
    expect(screen).toContain(
      "import { PremiumAction } from '../components/premium/PremiumAction';",
    );
    expect(screen).toContain('<PremiumAction capability="ADD_PROGRESS_PHOTO" onAllowed={openSheetUnguarded}>');
  });

  it('AssessmentActionCard imports <PremiumAction> and wraps both "nova avaliação" options with it', () => {
    const card = source('src/components/fitness/AssessmentActionCard.tsx');
    expect(card).toContain("import { PremiumAction } from '../premium/PremiumAction';");
    expect(card).toContain('<PremiumAction capability="CREATE_ASSESSMENT" onAllowed={onGuided}>');
    expect(card).toContain('<PremiumAction capability="CREATE_ASSESSMENT" onAllowed={onImport}>');
  });

  it('AssessmentActionCard no longer takes a `locked` prop from its caller — it is self-gating now', () => {
    const card = stripComments(source('src/components/fitness/AssessmentActionCard.tsx'));
    const signature = card.slice(
      card.indexOf('export function AssessmentActionCard({'),
      card.indexOf('{\n  const { t }'),
    );
    expect(signature).not.toContain('locked');
  });
});

describe('FASE 5 — DELETE_PROGRESS_PHOTO stayed imperative, on purpose', () => {
  it('confirmDelete still uses requestPremiumAction directly — no <PremiumAction> wrapper forced onto a viewer/menu action', () => {
    const screen = stripComments(source('src/screens/ProgressPhotosScreen.tsx'));
    const confirmDeleteStart = screen.indexOf('const confirmDelete = useCallback(');
    const body = screen.slice(
      confirmDeleteStart,
      screen.indexOf('\n  if (!unlocked)', confirmDeleteStart),
    );
    expect(body).toContain("capability: 'DELETE_PROGRESS_PHOTO'");
    expect(body).not.toContain('<PremiumAction');
  });
});

describe('FASE 5 — defense-in-depth preserved (visual gate is not the only protection)', () => {
  it('WorkoutScreen keeps its own mount guard for START_WORKOUT', () => {
    const workoutScreen = source('src/screens/WorkoutScreen.tsx');
    expect(workoutScreen).toContain("if (!canPerform('START_WORKOUT')) onDone();");
  });

  it('both AssessmentScreen modals keep their own handleSave guard for CREATE_ASSESSMENT', () => {
    const code = stripComments(source('src/screens/AssessmentScreen.tsx'));
    const handleSaveBodies = [...code.matchAll(/const handleSave = async \(\) => \{[\s\S]*?\n  \};/g)].map(
      (m) => m[0],
    );
    expect(handleSaveBodies.length).toBe(2);
    for (const body of handleSaveBodies) {
      expect(body).toContain("if (!canPerform('CREATE_ASSESSMENT')) return;");
    }
  });
});

describe('FASE 5 — architectural convention: no feature reads isPremium directly for authorization', () => {
  const featureFiles = [
    'src/screens/AppShell.tsx',
    'src/screens/AssessmentScreen.tsx',
    'src/screens/ProgressPhotosScreen.tsx',
    'src/components/fitness/AssessmentActionCard.tsx',
    'src/components/premium/PremiumAction.tsx',
    'src/screens/HomeScreen.tsx',
    'src/screens/ProgressScreen.tsx',
    'src/screens/WorkoutScreen.tsx',
  ];

  it.each(featureFiles)('%s never writes `if (!isPremium)` / `isPremium ?` for its own gating', (path) => {
    const code = stripComments(source(path));
    expect(code).not.toMatch(/if\s*\(\s*!isPremium\s*\)/);
    expect(code).not.toMatch(/isPremium\s*\?/);
  });

  it('no <PremiumAction> usage targets a non-Premium (account) action', () => {
    const forbiddenCapabilities = [
      'VIEW_PROFILE',
      'EDIT_PROFILE',
      'CHANGE_PROFILE_PHOTO',
      'CHANGE_LANGUAGE',
      'CHANGE_UNITS',
      'OPEN_SETTINGS',
      'CONTACT_SUPPORT',
      'LOGOUT',
      'MANAGE_SUBSCRIPTION',
      'RESTORE_PURCHASES',
    ];
    const files = [
      'src/screens/AppShell.tsx',
      'src/screens/ProgressPhotosScreen.tsx',
      'src/components/fitness/AssessmentActionCard.tsx',
    ];
    for (const path of files) {
      const code = source(path);
      for (const capability of forbiddenCapabilities) {
        expect(code).not.toContain(`<PremiumAction capability="${capability}"`);
      }
    }
  });
});

describe('FASE 5 — regression: root gate, RevenueCat and backend infra untouched', () => {
  it('premiumGate.ts still opens AppShell unconditionally', () => {
    expect(source('src/lib/premiumGate.ts')).toContain("return 'app';");
  });

  it('revenueCatService.ts has no Premium-action imports', () => {
    const service = source('src/services/revenueCatService.ts');
    expect(service).not.toContain('PremiumAction');
    expect(service).not.toContain('PremiumActionContext');
  });
});

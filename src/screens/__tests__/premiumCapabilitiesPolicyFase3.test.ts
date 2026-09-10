import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fase 3 (docs/13_assinaturas_e_billing.md): "seus dados continuam seus,
 * Premium é necessário para continuar produzindo/alterando dados fitness".
 * Source-inspection suite (same pattern as the other capability structure
 * suites) —
 * no component renderer in this Node-only suite (vitest.config.mts). Runtime
 * behavior of the pure capability resolver is covered by
 * `src/lib/__tests__/premiumCapabilities.test.ts`; this file only proves the
 * screens actually call it at the right boundary, and that read/account
 * flows never do.
 *
 * FASE 4 update: the boundaries this file proved in Fase 3 still hold —
 * denied capabilities still stop the mutation — but the *shape* of the
 * denial changed from a silent `if (!canPerform(...)) return;` to routing
 * through `requestPremiumAction` (`PremiumActionContext`), which opens the
 * shared `PremiumRequiredSheet` instead. Assertions below were updated to
 * match; the UX-specific behavior (sheet content, CTA resolution, Paywall
 * reuse) is covered by `premiumActionUxFase4.test.ts`.
 *
 * FASE 5 update: the visual entry points for START_WORKOUT and
 * CREATE_ASSESSMENT moved to the declarative `<PremiumAction>` wrapper
 * (`components/premium/PremiumAction.tsx`) — the gate now lives where the
 * CTA is rendered (`StartWorkoutConfirmation` in AppShell.tsx,
 * `AssessmentActionCard.tsx`) instead of in the screen's event handler.
 * ADD_PROGRESS_PHOTO's primary CTA moved the same way; its secondary entry
 * points and DELETE_PROGRESS_PHOTO stayed on the imperative
 * `requestPremiumAction` API, per Fase 5's own convention (see
 * `premiumActionFase5.test.ts`). Assertions below were updated accordingly;
 * the invariants themselves (denied never mutates, read stays free) are
 * unchanged since Fase 3.
 */
function source(path: string): string {
  return readFileSync(path, 'utf8');
}
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('FASE 3 — START_WORKOUT boundary', () => {
  const appShell = source('src/screens/AppShell.tsx');
  const appShellCode = stripComments(appShell);
  const workoutScreen = source('src/screens/WorkoutScreen.tsx');

  it('FASE 5: startWorkout() is now a pure action — the gate moved to <PremiumAction> around its CTA', () => {
    // P0 integrity fix (2026-09): startWorkout() became `async` — it now
    // awaits the authoritative, persisted `execution.start()` before
    // revealing the session (docs §9) — but the Premium-gate boundary this
    // test protects is unchanged: it's still called with no capability
    // check of its own.
    const startWorkoutBody = appShellCode.slice(
      appShellCode.indexOf('const startWorkout = async () => {'),
      appShellCode.indexOf('};', appShellCode.indexOf('const startWorkout = async () => {')),
    );
    expect(startWorkoutBody).not.toContain('canPerform');
    expect(startWorkoutBody).not.toContain('requestPremiumAction');
    expect(startWorkoutBody).toContain("setTab('workout')");
  });

  it('StartWorkoutConfirmation gates its CTA with <PremiumAction capability="START_WORKOUT">, before onConfirm ever runs', () => {
    const confirmationBody = appShellCode.slice(
      appShellCode.indexOf('function StartWorkoutConfirmation('),
      appShellCode.indexOf('function TabBar('),
    );
    expect(confirmationBody).toContain('<PremiumAction capability="START_WORKOUT" onAllowed={onConfirm}>');
    expect(confirmationBody.indexOf('<PremiumAction capability="START_WORKOUT"')).toBeLessThan(
      confirmationBody.indexOf('onPress={() => {\n                    onCancel();\n                    onPress();'),
    );
  });

  it('selectTab bypasses startWorkout() only when returning to an already-active workout', () => {
    // selectTab itself now only decides tab vs. requestStartWorkout — the
    // resume-vs-gated-confirmation decision lives in requestStartWorkout,
    // which selectTab (and every other entry point) funnels through.
    const selectTabBody = appShellCode.slice(
      appShellCode.indexOf('const selectTab = (nextTab: TabId) => {'),
      appShellCode.indexOf('};', appShellCode.indexOf('const selectTab = (nextTab: TabId) => {')),
    );
    expect(selectTabBody).toContain('requestStartWorkout();');
    const requestStartWorkoutBody = appShellCode.slice(
      appShellCode.indexOf('const requestStartWorkout = useCallback(() => {'),
      appShellCode.indexOf('}, [workoutInProgress', appShellCode.indexOf('const requestStartWorkout = useCallback(() => {')),
    );
    // A new session still opens the gated confirmation (or the miss
    // decision first). A session that is already active was gated when it
    // started and must resume directly.
    const activeResume = requestStartWorkoutBody.slice(
      requestStartWorkoutBody.indexOf('if (workoutInProgress)'),
      requestStartWorkoutBody.indexOf("setStartWorkoutFlow('missedDecision')"),
    );
    expect(activeResume).toContain("setTab('workout')");
    expect(requestStartWorkoutBody).toContain("setStartWorkoutFlow('confirmation')");
  });

  it('WorkoutScreen defends its own mount as well (defense-in-depth, not the primary gate)', () => {
    expect(workoutScreen).toContain(
      "import { usePremiumCapabilities } from '../hooks/usePremiumCapabilities';",
    );
    expect(workoutScreen).toContain("if (!canPerform('START_WORKOUT')) onDone();");
  });

  it('no other file sets tab to "workout" outside AppShell', () => {
    // Guards against a future regression silently reopening a second,
    // ungated entry point.
    const other = ['src/screens/HomeScreen.tsx', 'src/state/AppState.tsx'];
    for (const path of other) {
      expect(source(path)).not.toContain("setTab('workout')");
    }
  });
});

describe('FASE 3 — CREATE_ASSESSMENT boundary', () => {
  const assessmentScreen = source('src/screens/AssessmentScreen.tsx');
  const code = stripComments(assessmentScreen);

  it('imports the capability hook', () => {
    expect(assessmentScreen).toContain(
      "import { usePremiumCapabilities } from '../hooks/usePremiumCapabilities';",
    );
  });

  it('both the guided and imported flows gate their actual write call, not just the entry point', () => {
    const handleSaveBodies = [...code.matchAll(/const handleSave = async \(\) => \{[\s\S]*?\n  \};/g)].map(
      (m) => m[0],
    );
    expect(handleSaveBodies.length).toBe(2);
    for (const body of handleSaveBodies) {
      expect(body).toContain("if (!canPerform('CREATE_ASSESSMENT')) return;");
      // The capability check runs before onSave (the actual
      // addGuidedAssessment/addImportedAssessment write) is ever called.
      expect(body.indexOf("canPerform('CREATE_ASSESSMENT')")).toBeLessThan(
        body.indexOf('await onSave('),
      );
    }
  });

  it('FASE 5: the "Adicionar avaliação" entry point is gated by AssessmentActionCard itself now — this screen just hands over plain callbacks', () => {
    expect(code).toContain('onGuided={() => setShowGuided(true)}');
    expect(code).toContain('onImport={() => setShowImport(true)}');
    expect(code).not.toContain('requestPremiumAction');
  });

  it('AssessmentActionCard gates both options with <PremiumAction capability="CREATE_ASSESSMENT">, before the form ever opens (no 15-field form for Free before the block)', () => {
    const card = stripComments(source('src/components/fitness/AssessmentActionCard.tsx'));
    const matches = [...card.matchAll(/<PremiumAction capability="CREATE_ASSESSMENT" onAllowed=\{(onGuided|onImport)\}>/g)];
    expect(matches.length).toBe(2);
  });

  it('reading assessment history never calls canPerform', () => {
    expect(source('src/hooks/useAssessments.ts')).not.toContain('canPerform');
    expect(source('src/services/assessments.ts')).not.toContain('canPerform');
  });
});

describe('FASE 3 — ADD_PROGRESS_PHOTO / DELETE_PROGRESS_PHOTO boundary', () => {
  const screen = source('src/screens/ProgressPhotosScreen.tsx');
  const code = stripComments(screen);

  it('FASE 5: imports <PremiumAction> for the primary CTA and usePremiumAction for the imperative paths', () => {
    expect(screen).toContain(
      "import { PremiumAction } from '../components/premium/PremiumAction';",
    );
    expect(screen).toContain(
      "import { usePremiumAction } from '../state/PremiumActionContext';",
    );
  });

  it('the primary "add" CTA is wrapped in <PremiumAction capability="ADD_PROGRESS_PHOTO">, calling the unguarded state setter only when allowed', () => {
    expect(code).toContain('<PremiumAction capability="ADD_PROGRESS_PHOTO" onAllowed={openSheetUnguarded}>');
  });

  it('openSheet (the secondary/imperative entry points — empty states, grid slots) still funnels through the same requestPremiumAction call', () => {
    const body = code.slice(
      code.indexOf('const openSheet = useCallback('),
      code.indexOf('[requestPremiumAction, openSheetUnguarded],', code.indexOf('const openSheet = useCallback(')),
    );
    expect(body).toContain("capability: 'ADD_PROGRESS_PHOTO'");
    expect(body).toContain('openSheetUnguarded(pose)');
    expect(body.indexOf("capability: 'ADD_PROGRESS_PHOTO'")).toBeLessThan(
      body.indexOf('openSheetUnguarded(pose)'),
    );
  });

  it('openSheetUnguarded itself has no capability knowledge — <PremiumAction>/openSheet are the only two callers that gate it', () => {
    const body = code.slice(
      code.indexOf('const openSheetUnguarded = useCallback('),
      code.indexOf('const openSheet = useCallback('),
    );
    expect(body).not.toContain('canPerform');
    expect(body).not.toContain('requestPremiumAction');
    expect(body).toContain('setSheetOpen(true)');
  });

  it('confirmDelete is gated before the native confirmation dialog even opens', () => {
    const body = code.slice(
      code.indexOf('const confirmDelete = useCallback('),
      code.indexOf('[requestPremiumAction, handleCloseViewer, t]'),
    );
    expect(body).toContain("capability: 'DELETE_PROGRESS_PHOTO'");
    expect(body.indexOf("capability: 'DELETE_PROGRESS_PHOTO'")).toBeLessThan(
      body.indexOf('Alert.alert('),
    );
  });

  it('gallery reads (loadGallery/subscribeToGallery) are never gated — Free can always view existing photos', () => {
    expect(code).not.toMatch(/canPerform[\s\S]{0,40}(loadGallery|subscribeToGallery)/);
    expect(code).toContain('useEffect(() => subscribeToGallery(setGallery), []);');
  });

  it('the locked-vault branch (biometrics/PIN) is independent of Premium — no canPerform involved', () => {
    const lockedBranch = code.slice(
      code.lastIndexOf('if (!unlocked) {'),
      code.indexOf('return (\n    <View'),
    );
    expect(lockedBranch).not.toContain('canPerform');
  });
});

describe('FASE 3 — account/admin actions stay outside the Premium capability layer', () => {
  const untouchedScreens = [
    'src/screens/ProfileScreen.tsx',
    'src/screens/EditProfileScreen.tsx',
    'src/screens/SettingsScreen.tsx',
    'src/screens/SupportFormScreen.tsx',
    'src/screens/SubscriptionCenterScreen.tsx',
    'src/screens/ConsistencyScreen.tsx',
    'src/screens/HomeScreen.tsx',
    'src/screens/ProgressScreen.tsx',
  ];

  it.each(untouchedScreens)('%s never imports usePremiumCapabilities', (path) => {
    expect(source(path)).not.toContain('usePremiumCapabilities');
  });

  it('SubscriptionCenterScreen (manage/renew/restore) stays reachable regardless of Premium', () => {
    const center = source('src/screens/SubscriptionCenterScreen.tsx');
    expect(center).not.toContain('canPerform');
    expect(center).not.toContain('isPremium ?');
  });
});

describe('FASE 3 — root gate stays untouched (no Fase 1 regression)', () => {
  it('premiumGate.ts still opens AppShell unconditionally once subscription resolves', () => {
    const gate = source('src/lib/premiumGate.ts');
    expect(gate).toContain("return 'app';");
    expect(gate).not.toContain('state.isPremium ?');
  });
});

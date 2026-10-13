import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 5 — structural guarantees for the questionnaire's own
 * `HealthIntegrationOnboardingScreen.tsx` step. No component renderer in
 * this Node-only suite — see `healthIntegrationScreenStructure.test.ts` for
 * the same pattern applied to the Settings screen.
 */
const SCREEN_SOURCE = readFileSync('src/screens/onboarding/HealthIntegrationOnboardingScreen.tsx', 'utf8');
const SCREEN_CODE = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('HealthIntegrationOnboardingScreen — pre-auth choice only, no second connect implementation', () => {
  it('never imports useHealthIntegration or any native-facing service — it only records a choice', () => {
    expect(SCREEN_CODE).not.toContain("from '../../hooks/useHealthIntegration'");
    expect(SCREEN_CODE).not.toContain("from '../../services/healthIntegrationPreferences'");
    expect(SCREEN_CODE).not.toContain('requestHealthPermissions(');
    expect(SCREEN_CODE).not.toContain('setHealthIntegrationIntent(');
    expect(SCREEN_CODE).not.toContain('.connect()');
  });

  it('only uses getHealthPlatform() for copy (provider name), never to gate availability/permissions', () => {
    expect(SCREEN_CODE).toContain("import { getHealthPlatform } from '../../services/healthIntegration'");
    expect(SCREEN_CODE).not.toContain('checkHealthAvailability');
  });

  it('takes uid out of the picture entirely — no auth state read here at all', () => {
    expect(SCREEN_CODE).not.toContain("from '../../state/AuthContext'");
    expect(SCREEN_CODE).not.toContain('uid');
  });
});

describe('HealthIntegrationOnboardingScreen — matches the questionnaire chrome', () => {
  it('renders the shared SegBar progress indicator, like every other question step', () => {
    expect(SCREEN_SOURCE).toContain("import { SegBar } from '../../components/ui/SegBar'");
    expect(SCREEN_CODE).toContain('<SegBar value={progress.total ? progress.current / progress.total : 0}');
  });

  it('renders a back arrow wired to onBack, same accessibility label as QuestionStepScreen', () => {
    expect(SCREEN_CODE).toContain("accessibilityLabel={t('common:actions.back')}");
    expect(SCREEN_CODE).toContain('onPress={onBack ?? undefined}');
    expect(SCREEN_CODE).toContain('disabled={!onBack}');
  });

  it('exposes the exact two required actions — Conectar and Agora não — nothing else drives navigation', () => {
    expect(SCREEN_CODE).toContain("choose('connect')");
    expect(SCREEN_CODE).toContain("choose('skip')");
  });

  it('both actions persist the choice before advancing — never advances without recording one', () => {
    const chooseBody = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('const choose = ('),
      SCREEN_CODE.indexOf('return (', SCREEN_CODE.indexOf('const choose = (')),
    );
    expect(chooseBody).toContain('onChoose(next);');
    expect(chooseBody).toContain('onNext();');
    const onChooseIdx = chooseBody.indexOf('onChoose(next);');
    const onNextIdx = chooseBody.indexOf('onNext();');
    expect(onNextIdx).toBeGreaterThan(onChooseIdx);
  });
});

describe('HealthIntegrationOnboardingScreen — three benefits, platform-aware provider naming', () => {
  it('names the provider per platform instead of a hardcoded string', () => {
    expect(SCREEN_CODE).toContain("platform === 'android' ? 'Health Connect' : 'Apple Health'");
  });

  it('presents exactly the three required benefits (weight, workouts, control)', () => {
    expect(SCREEN_CODE).toContain('healthIntegration.benefits.weight.title');
    expect(SCREEN_CODE).toContain('healthIntegration.benefits.workouts.title');
    expect(SCREEN_CODE).toContain('healthIntegration.benefits.control.title');
  });
});

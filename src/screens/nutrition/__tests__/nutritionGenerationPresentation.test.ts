import React from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { NutritionGeneratingScreen } from '../NutritionGeneratingScreen';
import type { NutritionGenerationJobDoc } from '../../../services/nutritionGeneration';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup: (element: React.ReactNode) => string;
};

vi.mock('react-native', () => ({ Text: 'span', View: 'div' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'main' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../components/nutrition/NuKit', () => ({ NU: {}, NuCap: 'h1' }));
vi.mock('../../../components/nutrition/NutritionStates', () => ({
  NutritionErrorState: ({ title, body, retryLabel }: { title: string; body: string; retryLabel?: string }) =>
    React.createElement('section', null, title, body, retryLabel && React.createElement('button', null, retryLabel)),
}));

const render = (status: NutritionGenerationJobDoc['status'], observationFailed = false, errorCode?: string) =>
  renderToStaticMarkup(React.createElement(NutritionGeneratingScreen, {
    job: { status, errorCode } as NutritionGenerationJobDoc, observationFailed,
    onRetry: vi.fn(), onBack: vi.fn(), retrying: false,
  }));

describe('generation feedback', () => {
  it.each(['queued', 'running', 'validating', 'completed'] as const)('renders real %s progress and the leave-app note', (status) => {
    const html = render(status);
    expect(html).toContain('onboarding.preparingTitle');
    expect(html).toContain('onboarding.preparingNote');
    expect(html).toContain('generating.stages.');
    expect(html).not.toContain('genericError');
  });
  it('describes lost observation as a status check while preserving a terminal failure message', () => {
    expect(render('running', true)).toContain('generating.observationInterrupted.body');
    expect(render('running', true)).toContain('generating.observationInterrupted.retry');
    expect(render('running', true)).not.toContain('generating.genericError');
    expect(render('failed', false, 'AI_MACRO_VALIDATION_FAILED')).toContain('generating.genericError.body');
    expect(render('failed', false, 'AI_MACRO_VALIDATION_FAILED')).toContain('generating.failed.retry');
    expect(render('failed', false, 'ACCOUNT_INACTIVE')).not.toContain('<button>');
  });
});

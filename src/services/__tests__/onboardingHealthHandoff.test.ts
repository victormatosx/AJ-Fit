import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ack: vi.fn(), pending: vi.fn(), seen: vi.fn() }));
vi.mock('../../onboarding/draftStorage', () => ({ acknowledgeOnboardingHealthChoice: mocks.ack }));
vi.mock('../healthIntegrationOnboardingStep', () => ({ markHealthIntegrationOnboardingPendingConfirmation: mocks.pending, markHealthIntegrationOnboardingStepSeen: mocks.seen }));
import { consumeCapturedOnboardingHealthChoice } from '../onboardingHealthHandoff';
import type { OnboardingDraft } from '../../onboarding/draftStorage';
beforeEach(() => vi.clearAllMocks());
describe('health choice independent of nutrition completion', () => {
  it('consumes a captured legacy/partial choice for its authenticated owner', async () => {
    const draft = { healthTransferUid: 'u', healthIntegrationChoice: 'connect', nutrition: { completed: false } } as OnboardingDraft;
    await consumeCapturedOnboardingHealthChoice('u', draft);
    expect(mocks.pending).toHaveBeenCalledWith('u'); expect(mocks.ack).toHaveBeenCalledWith('u');
  });
  it('does not infer ownership from the current login or another account transfer', async () => {
    await consumeCapturedOnboardingHealthChoice('other', { transfer: { uid: 'u' }, healthIntegrationChoice: 'connect' } as OnboardingDraft);
    expect(mocks.pending).not.toHaveBeenCalled(); expect(mocks.ack).not.toHaveBeenCalled();
  });
  it('acknowledges only after durable consumption and never silently retries a consumed choice', async () => {
    mocks.pending.mockRejectedValueOnce(new Error('disk'));
    await expect(consumeCapturedOnboardingHealthChoice('u', { transfer: { uid: 'u' }, healthIntegrationChoice: 'connect' } as OnboardingDraft)).rejects.toThrow('disk');
    expect(mocks.ack).not.toHaveBeenCalled();
    await consumeCapturedOnboardingHealthChoice('u', { transfer: { uid: 'u' }, healthIntegrationChoice: null } as OnboardingDraft);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});

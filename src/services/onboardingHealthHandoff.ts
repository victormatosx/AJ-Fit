import { acknowledgeOnboardingHealthChoice, type OnboardingDraft } from '../onboarding/draftStorage';
import { markHealthIntegrationOnboardingPendingConfirmation, markHealthIntegrationOnboardingStepSeen } from './healthIntegrationOnboardingStep';

/** Legacy/partial nutrition never blocks a choice whose pre-auth ownership is known. */
export async function consumeCapturedOnboardingHealthChoice(uid: string, draft: OnboardingDraft, verifiedTransfer = false): Promise<void> {
  if (!draft.healthIntegrationChoice || (!verifiedTransfer && draft.transfer?.uid !== uid && draft.healthTransferUid !== uid)) return;
  if (draft.healthIntegrationChoice === 'connect') await markHealthIntegrationOnboardingPendingConfirmation(uid);
  else await markHealthIntegrationOnboardingStepSeen(uid);
  await acknowledgeOnboardingHealthChoice(uid);
}

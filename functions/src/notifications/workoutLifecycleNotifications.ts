import { createHash } from 'node:crypto';

import { logFunctionError, logInfo } from '../lib/logger';
import {
  buildEvolutionUnlockedNotification,
  buildProgramUpdatedNotification,
} from './contentPolicy';
import type { NotificationDispatchOutcome } from './schema';
import { dispatchUserNotificationCandidate } from './userNotificationDispatch';

const SCOPE = 'notifications.workoutLifecycle';

export type WorkoutLifecycleNotificationEventType =
  | 'EVOLUTION_EARNED'
  | 'MOTIVATIONAL_RENEWAL_OFFERED'
  | 'EVOLUTION_ACTIVATED'
  | 'LEVEL_PROMOTED'
  | 'MOTIVATIONAL_RENEWAL_ACTIVATED'
  | 'PROGRAM_ADAPTED';

export type WorkoutLifecycleNotificationResult =
  | NotificationDispatchOutcome
  | { status: 'IGNORED'; reason: 'EVENT_TYPE_NOT_ELIGIBLE' }
  | { status: 'FAILED' };

export interface WorkoutLifecycleNotificationDependencies {
  dispatchCandidate: typeof dispatchUserNotificationCandidate;
}

const defaultDependencies: WorkoutLifecycleNotificationDependencies = {
  dispatchCandidate: dispatchUserNotificationCandidate,
};

function sourceEventHash(eventId: string): string {
  return createHash('sha256').update(eventId, 'utf8').digest('hex');
}

export async function dispatchWorkoutLifecycleNotification(
  input: {
    uid: string;
    eventId: string;
    eventType: string;
  },
  dependencies: WorkoutLifecycleNotificationDependencies = defaultDependencies,
): Promise<WorkoutLifecycleNotificationResult> {
  const eventHash = sourceEventHash(input.eventId);
  try {
    switch (input.eventType as WorkoutLifecycleNotificationEventType) {
      case 'EVOLUTION_EARNED':
        return await dependencies.dispatchCandidate({
          uid: input.uid,
          category: 'EVOLUTION_AND_ACHIEVEMENTS',
          build: (locale) => buildEvolutionUnlockedNotification({
            uid: input.uid,
            lifecycleEventId: input.eventId,
            locale,
            variant: 'EVOLUTION',
          }),
        });
      case 'MOTIVATIONAL_RENEWAL_OFFERED':
        return await dependencies.dispatchCandidate({
          uid: input.uid,
          category: 'EVOLUTION_AND_ACHIEVEMENTS',
          build: (locale) => buildEvolutionUnlockedNotification({
            uid: input.uid,
            lifecycleEventId: input.eventId,
            locale,
            variant: 'MOTIVATIONAL_RENEWAL',
          }),
        });
      case 'PROGRAM_ADAPTED':
        return await dependencies.dispatchCandidate({
          uid: input.uid,
          category: 'EVOLUTION_AND_ACHIEVEMENTS',
          build: (locale) => buildProgramUpdatedNotification({
            uid: input.uid,
            lifecycleEventId: input.eventId,
            locale,
          }),
        });
      case 'EVOLUTION_ACTIVATED':
      case 'LEVEL_PROMOTED':
      case 'MOTIVATIONAL_RENEWAL_ACTIVATED':
      default:
        logInfo(SCOPE, 'candidate_suppressed', {
          sourceEventHash: eventHash,
          sourceEventType: input.eventType,
          reason: 'EVENT_TYPE_NOT_ELIGIBLE',
        });
        return { status: 'IGNORED', reason: 'EVENT_TYPE_NOT_ELIGIBLE' };
    }
  } catch (error) {
    logFunctionError(SCOPE, error, {
      sourceEventHash: eventHash,
      sourceEventType: input.eventType,
      operation: 'dispatch_product_notification',
    });
    return { status: 'FAILED' };
  }
}

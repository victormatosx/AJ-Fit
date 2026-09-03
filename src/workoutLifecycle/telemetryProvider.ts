import { httpsCallable } from 'firebase/functions';

import { functions } from '../lib/firebaseFunctions';
import { errorClass, errorCode, logError } from '../lib/logger';
import {
  setWorkoutLifecycleTelemetryLogger,
  type WorkoutLifecycleTelemetryEvent,
  type WorkoutLifecycleTelemetryLogger,
} from './telemetry';

export const WORKOUT_LIFECYCLE_TELEMETRY_CALLABLE = 'recordWorkoutLifecycleTelemetry';

export type WorkoutLifecycleTelemetrySender = (
  event: WorkoutLifecycleTelemetryEvent,
) => Promise<unknown>;

export function createCloudLoggingWorkoutLifecycleTelemetryLogger(
  sender: WorkoutLifecycleTelemetrySender = async (event) => {
    const callable = httpsCallable<
      { event: WorkoutLifecycleTelemetryEvent },
      { accepted: true; trustLevel: 'CLIENT_DIAGNOSTIC' }
    >(
      functions,
      WORKOUT_LIFECYCLE_TELEMETRY_CALLABLE,
    );
    return callable({ event });
  },
): WorkoutLifecycleTelemetryLogger {
  return {
    log(event) {
      void sender(event).catch((error: unknown) => {
        // Telemetry is best-effort and must never become domain authority.
        logError('workout-lifecycle:telemetry', new Error('provider_delivery_failed'), {
          errorClass: errorClass(error),
          errorCode: errorCode(error) ?? 'UNCLASSIFIED',
          eventName: event.name,
        });
      });
    },
  };
}

/** Installs the real production provider before the application mounts. */
export function configureWorkoutLifecycleTelemetry(): void {
  setWorkoutLifecycleTelemetryLogger(createCloudLoggingWorkoutLifecycleTelemetryLogger());
}

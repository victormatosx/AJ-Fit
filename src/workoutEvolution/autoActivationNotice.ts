import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Timestamp } from 'firebase/firestore';
import type {
  PendingEvolutionType,
  WorkoutLifecycleEvent,
} from '../workoutLifecycle/types';

const ACK_PREFIX = 'ajfit:workout-evolution:auto-activation-ack:v1';
const AUTO_EVENT_TYPES = new Set([
  'LEVEL_PROMOTED',
  'EVOLUTION_ACTIVATED',
  'MOTIVATIONAL_RENEWAL_ACTIVATED',
]);
const EVOLUTION_TYPES = new Set<PendingEvolutionType>([
  'LEVEL_PROMOTION',
  'CYCLE_EVOLUTION',
  'MOTIVATIONAL_RENEWAL',
]);

export interface AutoActivationNotice {
  eventId: string;
  type: PendingEvolutionType;
  occurredAtMs: number;
}

function ackKey(uid: string): string {
  return `${ACK_PREFIX}:${uid}`;
}

/** Selects one deterministic persisted fact. Events for superseded instances
 * are excluded by the caller's instance-scoped query. */
export function selectLatestAutoActivationNotice(
  events: readonly WorkoutLifecycleEvent<Timestamp>[],
): AutoActivationNotice | null {
  return events
    .filter((event) => AUTO_EVENT_TYPES.has(event.type))
    .filter((event) => event.payload.trigger === 'AUTO')
    .map((event) => ({
      eventId: event.eventId,
      type: event.payload.evolutionType,
      occurredAtMs: event.occurredAt.toMillis(),
    }))
    .filter((event): event is AutoActivationNotice => EVOLUTION_TYPES.has(event.type as PendingEvolutionType))
    .sort((left, right) => right.occurredAtMs - left.occurredAtMs
      || right.eventId.localeCompare(left.eventId))[0] ?? null;
}

export async function loadUnacknowledgedAutoActivationNotice(
  uid: string,
  events: readonly WorkoutLifecycleEvent<Timestamp>[],
): Promise<AutoActivationNotice | null> {
  const notice = selectLatestAutoActivationNotice(events);
  if (!notice) return null;
  try {
    const acknowledgedEventId = await AsyncStorage.getItem(ackKey(uid));
    return acknowledgedEventId === notice.eventId ? null : notice;
  } catch {
    // A read failure favors explaining a real activation again over hiding it.
    return notice;
  }
}

export async function acknowledgeAutoActivationNotice(uid: string, eventId: string): Promise<void> {
  await AsyncStorage.setItem(ackKey(uid), eventId);
}

import type { ScheduleResolution } from '../scheduleEngine/types';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import type { PrescriptionResult } from '../workoutPrescription/types';

export type InitialSectionStatus = 'PENDING' | 'SUCCESS' | 'ERROR' | 'NOT_APPLICABLE';

export interface HomeInitialReadinessInput {
  prescriptionLoading: boolean;
  generatingWorkout: boolean;
  prescriptionStatus: PrescriptionResult['status'];
  scheduleLoading: boolean;
  scheduleStatus: ScheduleResolution['status'];
  scheduleRefreshFailed: boolean;
  evolutionKind: EvolutionViewModel['kind'];
  evolutionNoticeUnavailable: boolean;
  activityStatus: InitialSectionStatus;
  weekOverviewAvailable: boolean;
  frequencyStatus: InitialSectionStatus;
  frequencyWindowAvailable: boolean;
  frequencyLoading: boolean;
  supportInboxStatus: InitialSectionStatus;
}

export interface HomeInitialReadiness {
  today: InitialSectionStatus;
  evolution: InitialSectionStatus;
  activitySnapshot: InitialSectionStatus;
  frequency: InitialSectionStatus;
  supportInbox: InitialSectionStatus;
  allRequiredDataSettled: boolean;
}

function todayStatus(input: HomeInitialReadinessInput): InitialSectionStatus {
  if (input.prescriptionLoading || input.generatingWorkout || input.scheduleLoading) return 'PENDING';
  if (input.prescriptionStatus !== 'SUCCESS') return 'ERROR';
  if (input.scheduleRefreshFailed) return 'ERROR';
  return input.scheduleStatus === 'PROGRAM_NOT_AVAILABLE' ? 'PENDING' : 'SUCCESS';
}

function evolutionStatus(
  kind: EvolutionViewModel['kind'],
  noticeUnavailable: boolean,
): InitialSectionStatus {
  if (kind === 'LOADING') return 'PENDING';
  if (kind === 'SUMMARY_READY') return noticeUnavailable ? 'ERROR' : 'PENDING';
  if (kind === 'ERROR') return 'ERROR';
  if (kind === 'UNAVAILABLE') return 'NOT_APPLICABLE';
  return 'SUCCESS';
}

function renderedSectionStatus(
  status: InitialSectionStatus,
  contentAvailable: boolean,
  additionallyLoading = false,
): InitialSectionStatus {
  if (status === 'PENDING' || additionallyLoading || !contentAvailable) return 'PENDING';
  return status;
}

export function deriveHomeInitialReadiness(
  input: HomeInitialReadinessInput,
): HomeInitialReadiness {
  const result = {
    today: todayStatus(input),
    evolution: evolutionStatus(input.evolutionKind, input.evolutionNoticeUnavailable),
    activitySnapshot: renderedSectionStatus(input.activityStatus, input.weekOverviewAvailable),
    frequency: renderedSectionStatus(
      input.frequencyStatus,
      input.frequencyWindowAvailable,
      input.frequencyLoading,
    ),
    supportInbox: input.supportInboxStatus,
  };
  return {
    ...result,
    allRequiredDataSettled: Object.values(result).every((status) => status !== 'PENDING'),
  };
}

export interface HomeBootstrapState {
  dataSettled: boolean;
  layoutCommitted: boolean;
  visualReady: boolean;
}

export type HomeBootstrapEvent =
  | 'DATA_SETTLED'
  | 'DATA_PENDING'
  | 'LAYOUT_COMMITTED'
  | 'FRAME_PAINTABLE';

export const INITIAL_HOME_BOOTSTRAP_STATE: HomeBootstrapState = {
  dataSettled: false,
  layoutCommitted: false,
  visualReady: false,
};

/** Latches only after visualReady. A remounted AppShell gets a fresh initial state. */
export function reduceHomeBootstrapState(
  state: HomeBootstrapState,
  event: HomeBootstrapEvent,
): HomeBootstrapState {
  if (state.visualReady) return state;
  if (event === 'DATA_PENDING') {
    return state.dataSettled || state.layoutCommitted
      ? INITIAL_HOME_BOOTSTRAP_STATE
      : state;
  }
  if (event === 'DATA_SETTLED') {
    return state.dataSettled ? state : { ...state, dataSettled: true };
  }
  if (event === 'LAYOUT_COMMITTED') {
    return state.dataSettled && !state.layoutCommitted
      ? { ...state, layoutCommitted: true }
      : state;
  }
  return state.layoutCommitted ? { ...state, visualReady: true } : state;
}

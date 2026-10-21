import { currentPrescriptionMetadata } from '../workoutPrescription/prescriptionMetadata';
import { doc,getDoc } from 'firebase/firestore';
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { db } from '../lib/firebase';
import { PRESCRIPTION_EVOLUTION_CONFIG } from '../prescriptionEvolution/config';
import { buildRecentSlotHistory,evolveCycle,type ExerciseSubstitutionExplanation } from '../prescriptionEvolution/cycleEvolution';
import { buildLevelPromotionAnswers,type LevelPromotionTarget } from '../prescriptionEvolution/levelPromotion';
import { collectRecentPrescriptionSessions } from '../prescriptionEvolution/recentPrescriptionHistory';
import { buildPrescriptionInputSnapshot } from '../workoutLifecycle/prescriptionInputs';
import type { PrescriptionInputSnapshot,ProgramInstance } from '../workoutLifecycle/types';
import { equipmentContextFor } from '../workoutPrescription/equipment';
import type { CatalogExercise } from '../workoutPrescription/exerciseCatalog';
import { fromWorkoutTemplateDocument } from '../workoutPrescription/templateDocument';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import { loadAuthoritativePrescriptionInputs } from './prescriptionInputs';
import { loadProgramInstance,loadWorkoutLifecycle } from './workoutLifecycle';
import {
  isProgramSnapshot,
  loadActiveWorkoutProgram,
  loadWorkoutTemplate,
  prepareWorkoutProgram,
  type WorkoutProgramSnapshot,
} from './workoutPrograms';

const USERS = 'users';
const PROGRAMS = 'workoutPrograms';

export type PrescriptionEvolutionRequest =
  | { mode: 'LEVEL_PROMOTION'; uid: string; targetLevel: LevelPromotionTarget }
  | { mode: 'CYCLE_EVOLUTION' | 'MOTIVATIONAL_RENEWAL'; uid: string; targetCycleIdentity?: string };

/** Template/questionnaire identity the resulting `plan` was computed against — everything Fase 4's activation step needs to persist it as `workoutPrograms/{contentIdentity}` without re-deriving anything. */
export interface PrescriptionEvolutionTargetIdentity {
  templateId: string;
  templateVersion: number;
  templateSourceVersion: string;
  templateContentHash: string;
  questionnaireId: string;
  questionnaireVersion: number;
  prescriptionInputSnapshot: PrescriptionInputSnapshot;
}

export type PrescriptionEvolutionResult =
  | ({
      status: 'SUCCESS';
      mode: 'LEVEL_PROMOTION';
      sourceLevel: string;
      targetLevel: LevelPromotionTarget;
      preservedFrequency: number;
      plan: FinalWorkoutPlan;
    } & PrescriptionEvolutionTargetIdentity)
  | ({
      status: 'SUCCESS';
      mode: 'CYCLE_EVOLUTION' | 'MOTIVATIONAL_RENEWAL';
      sourcePlanId: string;
      plan: FinalWorkoutPlan;
      eligibleSlots: number;
      changedSlots: number;
      changeRatio: number;
      substitutions: ExerciseSubstitutionExplanation[];
      warnings: string[];
    } & PrescriptionEvolutionTargetIdentity)
  | { status: 'FAILED'; reasonCodes: string[] };

async function loadWorkoutProgramById(uid: string, programId: string): Promise<WorkoutProgramSnapshot | null> {
  const snapshot = await getDoc(doc(db, USERS, uid, PROGRAMS, programId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!isProgramSnapshot(data, programId)) return null;
  return data as WorkoutProgramSnapshot;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function evolutionPlanId(basePlanId: string, targetCycleIdentity: string, sessions: FinalWorkoutPlan['sessions']): string {
  return `wpe_${stableHash(JSON.stringify({ basePlanId, targetCycleIdentity, sessions }))}`;
}

/**
 * Loads up to `PRESCRIPTION_EVOLUTION_CONFIG.antiPingPongWindow` prior
 * prescriptions' sessions, most-recent-first, by walking the Program
 * Instance `previousProgramInstanceId` chain from the currently active
 * instance backward (Fase 1 primitive — never inferred from `programId`
 * counts, docs §96/§97).
 */
async function loadRecentPrescriptionSessions(
  uid: string,
  startingInstance: Pick<ProgramInstance<unknown>, 'previousProgramInstanceId'>,
): Promise<FinalWorkoutPlan['sessions'][]> {
  return collectRecentPrescriptionSessions({
    uid,
    previousProgramInstanceId: startingInstance.previousProgramInstanceId,
    maximumSessions: PRESCRIPTION_EVOLUTION_CONFIG.antiPingPongWindow,
    loadInstance: loadProgramInstance,
    loadProgramSessions: async (ownerUid, contentIdentity) =>
      (await loadWorkoutProgramById(ownerUid, contentIdentity))?.sessions ?? null,
  });
}

/**
 * Prescription Evolution Engine service layer (Fase 3 —
 * docs/workout-lifecycle/v2/architecture/09_PHASE_3_IMPLEMENTATION.md).
 *
 * Produces the NEXT prescription candidate for an already-made progression
 * decision. Never activates it, never supersedes the current Program
 * Instance, never writes a lifecycle event — that belongs to a future
 * phase (docs §98/§99).
 */
export async function evolvePrescription(request: PrescriptionEvolutionRequest): Promise<PrescriptionEvolutionResult> {
  const program = await loadActiveWorkoutProgram(request.uid);
  if (!program) return { status: 'FAILED', reasonCodes: ['NO_ACTIVE_PROGRAM'] };
  const lifecycle = await loadWorkoutLifecycle(request.uid);
  if (!lifecycle) return { status: 'FAILED', reasonCodes: ['NO_LIFECYCLE'] };
  const authoritative = await loadAuthoritativePrescriptionInputs(request.uid, lifecycle);
  if (!authoritative) return { status: 'FAILED', reasonCodes: ['QUESTIONNAIRE_NOT_FOUND'] };
  const currentAnswers = authoritative.answers;

  if (request.mode === 'LEVEL_PROMOTION') {
    const pinnedFrequency = program.prescribedTrainingFrequency ?? program.prescribedStructuredDays;
    const pinnedTrainingDays = (program.scheduleMode ?? 'fixed') === 'fixed'
      ? program.weeklySchedule?.filter((day) => day.state === 'TRAINING').map((day) => day.weekday) ?? []
      : [];
    const syntheticAnswers = buildLevelPromotionAnswers({
      currentAnswers,
      targetLevel: request.targetLevel,
      pinnedFrequency,
      pinnedTrainingDays,
      scheduleMode: program.scheduleMode ?? 'fixed',
    });

    const prepared = await prepareWorkoutProgram({
      answers: syntheticAnswers,
      loadTemplate: async (templateId) => {
        const template = await loadWorkoutTemplate(templateId);
        return template ? fromWorkoutTemplateDocument(template) : null;
      },
    });
    if (prepared.status !== 'SUCCESS') return { status: 'FAILED', reasonCodes: prepared.reasonCodes };
    const resultFrequency = prepared.plan.prescribedTrainingFrequency ?? prepared.plan.prescribedStructuredDays;
    if (resultFrequency !== pinnedFrequency) {
      return { status: 'FAILED', reasonCodes: ['FREQUENCY_NOT_PRESERVED'] };
    }
    // Re-fetched (rather than captured from the `loadTemplate` closure above)
    // purely to keep this a simple, independently-typed read — the template
    // was already proven to exist by `prepared.status === 'SUCCESS'`.
    const resolvedTemplate = await loadWorkoutTemplate(prepared.templateId);
    if (!resolvedTemplate) return { status: 'FAILED', reasonCodes: ['WORKOUT_TEMPLATE_NOT_FOUND'] };

    return {
      status: 'SUCCESS',
      mode: 'LEVEL_PROMOTION',
      sourceLevel: currentAnswers.level ?? 'unknown',
      targetLevel: request.targetLevel,
      preservedFrequency: pinnedFrequency,
      plan: prepared.plan,
      templateId: prepared.templateId,
      templateVersion: resolvedTemplate.version,
      templateSourceVersion: resolvedTemplate.sourceVersion,
      templateContentHash: resolvedTemplate.contentHash,
      questionnaireId: program.questionnaireId,
      questionnaireVersion: program.questionnaireVersion,
      prescriptionInputSnapshot: buildPrescriptionInputSnapshot({
        answers: syntheticAnswers,
        currentTrainingLevel: request.targetLevel,
        source: 'LEVEL_PROMOTION',
      }),
    };
  }

  // CYCLE_EVOLUTION / MOTIVATIONAL_RENEWAL share the exact same conservative
  // transformer — the docs describe Motivational Renewal as usable "the same
  // controlled 20-30% rotation rules" without assigning it to a later phase,
  // so it is treated here as the same algorithm under a different mode tag
  // (architecture/09_PHASE_3_IMPLEMENTATION.md documents this as a deliberate
  // judgment call). Neither mode marks earned evolution or activates anything.
  const targetCycleIdentity = request.targetCycleIdentity
    ?? (lifecycle
      ? `${lifecycle.lifecycle.currentCycleId}:${lifecycle.lifecycle.activeProgramInstanceId}`
      : `${program.programId}:no-lifecycle`);

  const catalog = new Map<string, CatalogExercise>(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
  const equipmentContext = equipmentContextFor(currentAnswers, program.environment);
  const priorSessions = lifecycle
    ? await loadRecentPrescriptionSessions(request.uid, lifecycle.programInstance)
    : [];

  const result = evolveCycle({
    sessions: program.sessions,
    targetCycleIdentity,
    equipmentContext,
    catalog,
    recentSlotHistory: buildRecentSlotHistory(priorSessions),
  });

  const nextPlan: FinalWorkoutPlan = {
    planId: evolutionPlanId(program.planId, targetCycleIdentity, result.sessions),
    templateId: program.templateId,
    requestedDays: program.requestedDays,
    prescribedStructuredDays: program.prescribedStructuredDays,
    prescribedTrainingFrequency: program.prescribedTrainingFrequency,
    scheduleMode: program.scheduleMode ?? 'fixed',
    availability: program.availability,
    weeklySchedule: program.weeklySchedule,
    population: program.population,
    environment: program.environment,
    goalFamily: program.goalFamily,
    split: program.split,
    adaptationStage: program.adaptationStage,
    sessions: result.sessions,
    ...currentPrescriptionMetadata(program as FinalWorkoutPlan),
  };

  return {
    status: 'SUCCESS',
    mode: request.mode,
    sourcePlanId: program.planId,
    plan: nextPlan,
    eligibleSlots: result.eligibleSlots,
    changedSlots: result.changedSlots,
    changeRatio: result.changeRatio,
    substitutions: result.substitutions,
    warnings: result.warnings,
    templateId: program.templateId,
    templateVersion: program.templateVersion,
    templateSourceVersion: program.templateSourceVersion,
    templateContentHash: program.templateContentHash,
    questionnaireId: program.questionnaireId,
    questionnaireVersion: program.questionnaireVersion,
    prescriptionInputSnapshot: buildPrescriptionInputSnapshot({
      answers: currentAnswers,
      currentTrainingLevel: lifecycle.lifecycle.currentTrainingLevel,
      source: request.mode === 'MOTIVATIONAL_RENEWAL' ? 'MOTIVATIONAL_RENEWAL' : 'CYCLE_EVOLUTION',
    }),
  };
}

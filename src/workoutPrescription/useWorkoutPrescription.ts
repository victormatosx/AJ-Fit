import { useCallback, useEffect, useState } from 'react';
import { logInfo, logWarn } from '../lib/logger';
import { generateAndPersistWorkoutProgram, loadActiveWorkoutProgram } from '../services/workoutPrograms';
import { useAuth } from '../state/AuthContext';
import type { PrescriptionResult } from './types';

const loadingResult: PrescriptionResult = {
  status: 'NEEDS_QUESTIONNAIRE_UPDATE',
  reasonCodes: ['ACTIVE_WORKOUT_PROGRAM_LOADING'],
};

export interface WorkoutPrescriptionController {
  prescription: PrescriptionResult;
  generating: boolean;
  generate: () => Promise<PrescriptionResult>;
  reload: () => Promise<void>;
}

/** Loading this hook never runs the engine; generation is an explicit command. */
export function useWorkoutPrescription(): WorkoutPrescriptionController {
  const { user, questionnaire } = useAuth();
  const identity = user?.uid ?? 'signed-out';
  const [resolved, setResolved] = useState<{ identity: string; result: PrescriptionResult }>({
    identity: 'unresolved',
    result: loadingResult,
  });
  const [generating, setGenerating] = useState(false);

  const reload = useCallback(async () => {
    if (!user) {
      setResolved({ identity, result: { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: ['AUTHENTICATION_REQUIRED'] } });
      return;
    }
    setResolved({ identity, result: loadingResult });
    try {
      const program = await loadActiveWorkoutProgram(user.uid);
      setResolved({
        identity,
        result: program
          ? { status: 'SUCCESS', plan: program }
          : { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: [questionnaire ? 'WORKOUT_PROGRAM_NOT_GENERATED' : 'QUESTIONNAIRE_NOT_LOADED'] },
      });
      logInfo('workout_program', 'active_workout_program_loaded', { found: Boolean(program), templateId: program?.templateId });
    } catch (error) {
      setResolved({ identity, result: { status: 'INVALID_CONFIGURATION', reasonCodes: ['ACTIVE_WORKOUT_PROGRAM_LOAD_FAILED'] } });
      logWarn('workout_program', 'active_workout_program_load_failed', { error });
    }
  }, [identity, questionnaire, user]);

  useEffect(() => { void reload(); }, [reload]);

  const generate = useCallback(async (): Promise<PrescriptionResult> => {
    if (!user || !questionnaire) {
      return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: ['QUESTIONNAIRE_NOT_LOADED'] };
    }
    setGenerating(true);
    try {
      const result = await generateAndPersistWorkoutProgram({
        uid: user.uid,
        questionnaireId: questionnaire.id,
        questionnaireVersion: questionnaire.version,
        answers: questionnaire.answers,
        source: 'manual_regeneration',
      });
      const prescription: PrescriptionResult = result.status === 'SUCCESS'
        ? { status: 'SUCCESS', plan: result.program }
        : result;
      setResolved({ identity, result: prescription });
      return prescription;
    } catch (error) {
      logWarn('workout_program', 'workout_program_generation_failed', { error });
      const result: PrescriptionResult = { status: 'INVALID_CONFIGURATION', reasonCodes: ['PROGRAM_PERSIST_FAILED'] };
      setResolved({ identity, result });
      return result;
    } finally {
      setGenerating(false);
    }
  }, [identity, questionnaire, user]);

  return {
    prescription: resolved.identity === identity ? resolved.result : loadingResult,
    generating,
    generate,
    reload,
  };
}

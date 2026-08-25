import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { logInfo, logWarn } from '../lib/logger';
import { generateWorkoutPrescription } from './engine';
import { persistPrescriptionSnapshot, readPrescriptionSnapshot } from './storage';
import type { PrescriptionResult } from './types';

export function useWorkoutPrescription(): PrescriptionResult {
  const { user, questionnaire } = useAuth();
  const generated = useMemo(
    () => questionnaire
      ? generateWorkoutPrescription(questionnaire.answers)
      : { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: ['QUESTIONNAIRE_NOT_LOADED'] } as PrescriptionResult,
    [questionnaire],
  );
  const identity = user && questionnaire ? `${user.uid}:${questionnaire.id}` : 'unresolved';
  const loadingResult: PrescriptionResult = {
    status: 'NEEDS_QUESTIONNAIRE_UPDATE',
    reasonCodes: ['PRESCRIPTION_SNAPSHOT_LOADING'],
  };
  const [resolved, setResolved] = useState<{ identity: string; result: PrescriptionResult }>({
    identity: 'unresolved',
    result: loadingResult,
  });

  useEffect(() => {
    if (!user || !questionnaire) {
      setResolved({ identity, result: generated });
      return;
    }
    let active = true;
    void (async () => {
      try {
        const snapshot = await readPrescriptionSnapshot(user.uid, questionnaire.id);
        if (!active) return;
        if (snapshot) {
          setResolved({ identity, result: { status: 'SUCCESS', plan: snapshot } });
          logInfo('workout_generation', 'workout_generation_snapshot_loaded', {
            templateId: snapshot.templateId,
            engineVersion: snapshot.versions.compositionEngine,
          });
          return;
        }
        setResolved({ identity, result: generated });
        if (generated.status === 'SUCCESS') {
          await persistPrescriptionSnapshot(user.uid, questionnaire.id, generated.plan);
          logInfo('workout_generation', 'workout_generation_completed', {
            templateId: generated.plan.templateId,
            engineVersion: generated.plan.versions.compositionEngine,
            modifierCount: generated.plan.trace.appliedModifiers.length,
          });
        } else {
          logInfo('workout_generation', 'workout_generation_not_completed', {
            outcome: generated.status,
          });
        }
      } catch (error) {
        if (!active) return;
        setResolved({ identity, result: generated });
        logWarn('workout_generation', 'workout_generation_snapshot_failed', {
          outcome: generated.status,
          error,
        });
      }
    })();
    return () => { active = false; };
  }, [generated, identity, questionnaire, user]);

  return resolved.identity === identity ? resolved.result : loadingResult;
}

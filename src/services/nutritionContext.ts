import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { computeAge } from '../lib/ageCalculator';
import type { Quiz } from '../state/AppState';
import type { NutritionPhysicalContext, WorkoutNutritionContext } from '../types/nutrition';
import type { UserProfile } from './userProfile';
import { getLatestQuestionnaire, getUserProfile } from './userProfile';
import { getAssessments, type AssessmentDoc } from './assessments';

export function resolveNutritionPhysicalContextFromSources(
  profile: UserProfile | null, quiz: Quiz | null, assessments: readonly AssessmentDoc[], now = new Date(),
): NutritionPhysicalContext<Date> | null {
  const profileBirthDate = profile?.profile.birthDate?.toDate();
  const birthDate = profileBirthDate ?? quiz?.birthDate;
  const profileHeight = profile?.profile.height;
  const heightCm = typeof profileHeight === 'number' && profileHeight > 0 ? profileHeight : quiz?.height;
  const latest = [...assessments].sort((a, b) => b.measuredAt.toMillis() - a.measuredAt.toMillis()
    || (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))[0];
  const assessmentWeight = latest?.weight;
  const hasAssessmentWeight = typeof assessmentWeight === 'number' && Number.isFinite(assessmentWeight) && assessmentWeight > 0;
  const weightKg = hasAssessmentWeight ? assessmentWeight : quiz?.weight;
  if (!birthDate || !(birthDate instanceof Date) || !Number.isFinite(birthDate.getTime())
    || !heightCm || heightCm <= 0 || typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0 || !quiz?.sex || !quiz.goal) return null;
  return { birthDate, ageYears: computeAge(birthDate, now), heightCm, weightKg,
    sex: quiz.sex, goal: quiz.goal,
    sources: { birthDate: profileBirthDate ? 'profile' : 'questionnaire',
      height: typeof profileHeight === 'number' && profileHeight > 0 ? 'profile' : 'questionnaire',
      weight: hasAssessmentWeight ? 'assessment' : 'questionnaire', sex: 'questionnaire', goal: 'questionnaire' } };
}

export async function resolveNutritionPhysicalContext(uid: string): Promise<NutritionPhysicalContext<Date> | null> {
  const [profile, questionnaire, assessments] = await Promise.all([
    getUserProfile(uid), getLatestQuestionnaire(uid), getAssessments(uid, 1),
  ]);
  return resolveNutritionPhysicalContextFromSources(profile, questionnaire?.answers ?? null, assessments);
}

const NO_TRAINING_FREQUENCY = 0;
function validFrequency(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7;
}

export function resolveWorkoutNutritionContextFromSources(
  activeProgram: { prescribedTrainingFrequency?: unknown; prescribedStructuredDays?: unknown } | null,
  quizDays: unknown,
): WorkoutNutritionContext {
  if (activeProgram) {
    if (validFrequency(activeProgram.prescribedTrainingFrequency)) return { weeklyTrainingFrequency: activeProgram.prescribedTrainingFrequency };
    if (validFrequency(activeProgram.prescribedStructuredDays)) return { weeklyTrainingFrequency: activeProgram.prescribedStructuredDays };
    // An active but malformed program must not be replaced with historical availability.
    return { weeklyTrainingFrequency: NO_TRAINING_FREQUENCY };
  }
  return { weeklyTrainingFrequency: validFrequency(quizDays) ? quizDays : NO_TRAINING_FREQUENCY };
}

/** Reads only the active pointer and two frequency fields; no Workout service graph. */
export async function loadWorkoutNutritionContext(uid: string): Promise<WorkoutNutritionContext> {
  const lifecycle = await getDoc(doc(db, 'users', uid, 'workoutLifecycleState', 'current'));
  let programId: string | null = null;
  if (lifecycle.exists()) {
    const data = lifecycle.data() as { lifecycle?: { activeContentIdentity?: unknown }; activeContentIdentity?: unknown };
    const value = data.lifecycle?.activeContentIdentity ?? data.activeContentIdentity;
    if (typeof value === 'string' && value.length > 0) programId = value;
  } else {
    const pointer = await getDoc(doc(db, 'users', uid, 'workoutProgramState', 'active'));
    const value = pointer.data()?.programId;
    if (typeof value === 'string' && value.length > 0) programId = value;
  }
  if (programId) {
    const program = await getDoc(doc(db, 'users', uid, 'workoutPrograms', programId));
    if (!program.exists()) throw new Error('ACTIVE_WORKOUT_PROGRAM_NOT_FOUND');
    return resolveWorkoutNutritionContextFromSources(program.data(), null);
  }
  const questionnaire = await getLatestQuestionnaire(uid);
  return resolveWorkoutNutritionContextFromSources(null, questionnaire?.answers.days);
}

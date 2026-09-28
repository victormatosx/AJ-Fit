import type { LocalizedInstructions, LocalizedText, MovementPattern } from '../types/exercise';

/**
 * v1.27 Fase 2 closure — the 6 canonical ids that are cardio/mobility
 * "blocks" rather than muscle-targeted exercises (see
 * docs/workouts/AJ_Fit_v1_27_exercise_identity_matrix.json's prior
 * AMBIGUOUS evidence: forcing a primaryMuscle/equipment/modality here would
 * have fabricated a choice — walking vs. bike vs. elliptical for cardio,
 * a single joint region for the generic mobility blocks — that the product
 * decision now explicitly says the user never makes in-app). Deliberately
 * NOT part of `EXERCISES_SEED`/`Exercise` (`data/exercisesSeedData.ts`):
 * that catalog's `target.primaryMuscle` is required and read
 * unconditionally by the active v2 runtime's limitation resolver,
 * equipment substitution and muscle-priority reordering — none of which
 * this list is, or ever needs to be, part of.
 *
 * `id` is the same string as the v1.27 canonical `exercise_id` — no
 * translation/aliasing needed; `resolveCanonicalExerciseId` in
 * `canonicalExerciseIdentity.ts` resolves these as an exact match.
 */
export interface CanonicalActivity {
  id: string;
  kind: 'cardio' | 'mobility';
  name: LocalizedText;
  /** Only ever `'mobility'` (mobility items) — see this file's doc on why cardio deliberately has none. */
  movementPattern?: Extract<MovementPattern, 'mobility'>;
  instructions: LocalizedInstructions;
  /**
   * Always `false` today — WorkoutScreen shows duration/instructions and a
   * plain complete/check action (the same flow used for any
   * duration-only exercise). Reserved so a future guided-sequence surface
   * can key off the same `id` without a schema/identity change.
   */
  guidedSequenceAvailable: boolean;
}

export const CANONICAL_ACTIVITIES: CanonicalActivity[] = [
  {
    id: 'cardio-leve',
    kind: 'cardio',
    name: { ptBR: 'Cardio Leve', en: 'Light Cardio', es: 'Cardio Ligero' },
    instructions: {
      ptBR: ['Realize uma atividade cardiovascular contínua em intensidade leve pelo tempo prescrito e conclua ao final.'],
      en: ['Perform a continuous cardio activity at light intensity for the prescribed duration and mark it complete when done.'],
      es: ['Realice una actividad cardiovascular continua en intensidad leve durante el tiempo prescrito y márquela como completa al finalizar.'],
    },
    guidedSequenceAvailable: false,
  },
  {
    id: 'cardio-continuo',
    kind: 'cardio',
    name: { ptBR: 'Cardio Contínuo', en: 'Continuous Cardio', es: 'Cardio Continuo' },
    instructions: {
      ptBR: ['Realize uma atividade cardiovascular contínua em intensidade moderada pelo tempo prescrito e conclua ao final.'],
      en: ['Perform a continuous cardio activity at moderate intensity for the prescribed duration and mark it complete when done.'],
      es: ['Realice una actividad cardiovascular continua en intensidad moderada durante el tiempo prescrito y márquela como completa al finalizar.'],
    },
    guidedSequenceAvailable: false,
  },
  {
    id: 'cardio-intervalado',
    kind: 'cardio',
    name: { ptBR: 'Cardio Intervalado', en: 'Interval Cardio', es: 'Cardio Intervalado' },
    // Structure (cycle count + strong/light phase durations) already lives
    // on the composed exercise slot's own `cycleRange`/`duration` — the
    // catalog entry itself carries no interval-specific field to avoid a
    // second, redundant source of truth.
    instructions: {
      ptBR: ['Alterne fases de esforço forte e leve pela quantidade de ciclos prescrita e conclua ao final do último ciclo.'],
      en: ['Alternate strong- and light-effort phases for the prescribed number of cycles and mark it complete after the last cycle.'],
      es: ['Alterne fases de esfuerzo fuerte y leve durante la cantidad de ciclos prescrita y márquela como completa al final del último ciclo.'],
    },
    guidedSequenceAvailable: false,
  },
  {
    id: 'mobilidade-geral',
    kind: 'mobility',
    movementPattern: 'mobility',
    name: { ptBR: 'Mobilidade Geral', en: 'General Mobility', es: 'Movilidad General' },
    instructions: {
      ptBR: ['Realize movimentos de mobilidade confortáveis pelo tempo prescrito, sem forçar amplitude, e conclua ao final.'],
      en: ['Perform comfortable mobility movements for the prescribed duration without forcing range of motion, and mark it complete when done.'],
      es: ['Realice movimientos de movilidad cómodos durante el tiempo prescrito, sin forzar la amplitud, y márquela como completa al finalizar.'],
    },
    guidedSequenceAvailable: false,
  },
  {
    id: 'mobilidade-dinamica-geral',
    kind: 'mobility',
    movementPattern: 'mobility',
    name: { ptBR: 'Mobilidade Dinâmica Geral', en: 'General Dynamic Mobility', es: 'Movilidad Dinámica General' },
    instructions: {
      ptBR: ['Realize movimentos dinâmicos de preparação pelo tempo prescrito, aumentando a amplitude gradualmente, e conclua ao final.'],
      en: ['Perform dynamic preparation movements for the prescribed duration, gradually increasing range of motion, and mark it complete when done.'],
      es: ['Realice movimientos dinámicos de preparación durante el tiempo prescrito, aumentando la amplitud gradualmente, y márquela como completa al finalizar.'],
    },
    guidedSequenceAvailable: false,
  },
  {
    id: 'mobilidade-dinamica-quadril-tornozelo',
    kind: 'mobility',
    movementPattern: 'mobility',
    name: { ptBR: 'Mobilidade Dinâmica de Quadril e Tornozelo', en: 'Dynamic Hip and Ankle Mobility', es: 'Movilidad Dinámica de Cadera y Tobillo' },
    instructions: {
      ptBR: ['Realize movimentos dinâmicos de quadril e tornozelo pelo tempo prescrito, com amplitude confortável, e conclua ao final.'],
      en: ['Perform dynamic hip and ankle movements for the prescribed duration, within a comfortable range, and mark it complete when done.'],
      es: ['Realice movimientos dinámicos de cadera y tobillo durante el tiempo prescrito, con amplitud cómoda, y márquela como completa al finalizar.'],
    },
    guidedSequenceAvailable: false,
  },
];

const activityById = new Map(CANONICAL_ACTIVITIES.map((activity) => [activity.id, activity]));

export function getCanonicalActivityById(id: string): CanonicalActivity | undefined {
  return activityById.get(id);
}

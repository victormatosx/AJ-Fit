/**
 * Prescription Evolution Engine domain constants (Fase 3 —
 * docs/workout-lifecycle/v2/prescription/02_CYCLE_ROTATION.md, ADR-008).
 */
export const PRESCRIPTION_EVOLUTION_CONFIG = {
  /** Midpoint of the docs' ~20-30% novelty target; see ADR-008 for the rounding rule this drives. */
  noveltyTargetRatio: 0.25,
  /** How many of the most recent prior prescriptions feed the anti-ping-pong penalty (docs prescription/02, ADR-008). */
  antiPingPongWindow: 2,
} as const;

export type PrescriptionEvolutionConfig = typeof PRESCRIPTION_EVOLUTION_CONFIG;

import { Timestamp } from 'firebase/firestore';
import type { WorkoutSessionRecoveryState } from '../../workoutExecution/useWorkoutSessionRecovery';
import type { PersistedWorkoutExecution } from '../../services/workoutExecutions';
import type { WorkoutExecutionStatePointer } from '../../workoutExecution/types';
import { LONG_WORKOUT_SESSION_THRESHOLD_SECONDS } from '../../lib/workoutSessionTimer';

/**
 * Dev-only preview inputs for the three AJ assistant moments — never
 * imported by anything that ships to a real user. See `AjDebugPanel.tsx`,
 * the only consumer.
 *
 * The point of this file is that the panel previews the REAL components
 * (`MissedSessionDecisionModal`, `WorkoutSessionRecoveryModal`,
 * `AjCyclePausedMoment`) rather than a second copy of their layout: every
 * scenario below is just a prop set those components would legitimately
 * receive, so what you see on screen is the actual branching, the actual
 * guards and the actual copy — not an approximation that can drift.
 *
 * Nothing here touches Firestore, the Schedule Engine or the workout
 * execution. The fabricated execution is a plain in-memory object, and the
 * panel's own handlers only ever simulate an outcome locally (a spinner for
 * a moment, then "success" or "failure"); no real decision is ever resolved,
 * nothing is persisted, and no callable is invoked.
 */

/** Simulated latency for a fake resolution, long enough to actually see the spinner. */
export const AJ_DEBUG_RESOLVE_MS = 1200;

const FAKE_POINTER: WorkoutExecutionStatePointer = {
  executionId: 'dev-execution',
  programId: 'dev-program',
  programInstanceId: 'dev-program-instance',
  sessionIndex: 1,
  scheduledLocalDate: '2026-10-16',
  status: 'IN_PROGRESS',
  schemaVersion: 1,
  createdAt: null,
  updatedAt: null,
};

/**
 * A plausible in-progress execution. `startedAt` is relative to "now" so the
 * long-session branch can be driven by `minutesAgo` alone — the real modal
 * computes elapsed time from this field and nothing else, so this is the only
 * knob that decides between the plain and the "ainda está treinando?" copy.
 */
export function fakeExecution(minutesAgo: number): PersistedWorkoutExecution {
  const startedAtMs = Date.now() - minutesAgo * 60_000;
  return {
    executionId: 'dev-execution',
    programId: 'dev-program',
    programInstanceId: 'dev-program-instance',
    templateId: 'T001',
    sessionIndex: 1,
    sessionName: 'Treino B',
    scheduledLocalDate: '2026-10-16',
    status: 'IN_PROGRESS',
    startedAt: Timestamp.fromMillis(startedAtMs),
    finishedAt: null,
    exercises: [],
    cardio: null,
    executionSchemaVersion: 1,
    createdAt: Timestamp.fromMillis(startedAtMs),
    updatedAt: Timestamp.fromMillis(startedAtMs),
    timestampAuthority: 'SERVER',
  };
}

/** Comfortably past the 4h threshold, so the long-session copy is guaranteed. */
const LONG_SESSION_MINUTES = Math.round(LONG_WORKOUT_SESSION_THRESHOLD_SECONDS / 60) + 12;

export type AjDebugScenario =
  | {
      id: string;
      label: string;
      /** What the preview is actually meant to show you. */
      note: string;
      kind: 'missed';
      /** Both answers inert, as during a concurrent schedule reload. */
      refreshing?: boolean;
      /** Whether the simulated resolution succeeds or fails (and stays retryable). */
      outcome: 'success' | 'failure';
    }
  | {
      id: string;
      label: string;
      note: string;
      kind: 'recovery';
      state: WorkoutSessionRecoveryState;
      canResume: boolean;
      canFinalize: boolean;
      outcome: 'success' | 'failure';
    }
  | {
      id: string;
      label: string;
      note: string;
      kind: 'missedResolved';
    }
  | {
      id: string;
      label: string;
      note: string;
      kind: 'paused';
    }
  | {
      id: string;
      label: string;
      note: string;
      kind: 'bot';
    };

export const AJ_DEBUG_SCENARIOS: AjDebugScenario[] = [
  {
    id: 'missed-success',
    label: 'Treino perdido — escolha resolve',
    note: 'Entrada em arco, 2 falas digitadas, hop ao responder, spinner na opção escolhida e, ao resolver, o AJ dá um nod e passa para a tela de confirmação.',
    kind: 'missed',
    outcome: 'success',
  },
  {
    id: 'missed-failure',
    label: 'Treino perdido — falha (tentar de novo)',
    note: 'A escolha falha: o erro aparece acima das respostas e TODAS voltam a ser tocáveis.',
    kind: 'missed',
    outcome: 'failure',
  },
  {
    id: 'missed-refreshing',
    label: 'Treino perdido — recarregando agenda',
    note: '`refreshing` ligado: as duas respostas ficam inertes, sem spinner.',
    kind: 'missed',
    refreshing: true,
    outcome: 'success',
  },
  {
    id: 'missed-resolved',
    label: 'Treino perdido — tela de confirmação',
    note: 'Abre direto no segundo tempo: o AJ feliz, a frase do que mudou, o CTA azul e "Depois".',
    kind: 'missedResolved',
  },
  {
    id: 'recovery-normal',
    label: 'Treino abandonado — 3 ações',
    note: 'Retomar / Finalizar / Descartar. Backdrop e voltar do Android são inertes. Toque em Descartar para ver o sub-passo de confirmação (o AJ dá um nod e redigita).',
    kind: 'recovery',
    state: { status: 'pending', pointer: FAKE_POINTER, execution: fakeExecution(35) },
    canResume: true,
    canFinalize: true,
    outcome: 'success',
  },
  {
    id: 'recovery-long',
    label: 'Treino abandonado — sessão longa (>4h)',
    note: 'A fala de contexto troca para "ainda está treinando?" com a duração real formatada.',
    kind: 'recovery',
    state: { status: 'pending', pointer: FAKE_POINTER, execution: fakeExecution(LONG_SESSION_MINUTES) },
    canResume: true,
    canFinalize: true,
    outcome: 'success',
  },
  {
    id: 'recovery-mismatch',
    label: 'Treino abandonado — programa diferente',
    note: 'Sem "Retomar": a pergunta do AJ muda para a variante que não promete continuar.',
    kind: 'recovery',
    state: { status: 'pending', pointer: FAKE_POINTER, execution: fakeExecution(35) },
    canResume: false,
    canFinalize: false,
    outcome: 'success',
  },
  {
    id: 'recovery-terminal',
    label: 'Treino abandonado — já finalizado em outro aparelho',
    note: 'EXECUTION_TERMINAL: só o descarte (auto-reparo do ponteiro) é oferecido.',
    kind: 'recovery',
    state: {
      status: 'inconsistent',
      reason: 'EXECUTION_TERMINAL',
      pointer: FAKE_POINTER,
      execution: fakeExecution(600),
    },
    canResume: false,
    canFinalize: false,
    outcome: 'success',
  },
  {
    id: 'recovery-missing',
    label: 'Treino abandonado — ponteiro órfão',
    note: 'EXECUTION_MISSING: uma única resposta ("Entendi"), nenhuma ação destrutiva alcançável.',
    kind: 'recovery',
    state: { status: 'inconsistent', reason: 'EXECUTION_MISSING', pointer: FAKE_POINTER, execution: null },
    canResume: false,
    canFinalize: false,
    outcome: 'success',
  },
  {
    id: 'recovery-failure',
    label: 'Treino abandonado — falha ao finalizar/descartar',
    note: 'Qualquer ação falha: o erro aparece e as respostas continuam tocáveis.',
    kind: 'recovery',
    state: { status: 'pending', pointer: FAKE_POINTER, execution: fakeExecution(35) },
    canResume: true,
    canFinalize: true,
    outcome: 'failure',
  },
  {
    id: 'paused',
    label: 'Ciclo pausado (3 faltas) — Home',
    note: 'Espera 1,4 s antes de abrir, como na Home real. "Sim" fecha e chamaria o fluxo normal de iniciar treino (aqui só registra no console).',
    kind: 'paused',
  },
  {
    id: 'bot',
    label: 'Laboratório do mascote',
    note: 'O AjBot isolado e grande: dispare cada fase e cada humor um por um.',
    kind: 'bot',
  },
];

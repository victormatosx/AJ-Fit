import { describe, expect, it } from 'vitest';

import { addDaysLocal, type LocalDate } from '../../scheduleEngine/calendar';
import {
  buildCycleWeeklyTargets,
  computeCycleProgression,
  cycleInactivityDayThresholdAt,
  type CycleInstanceProgressionWindow,
} from '../cycleProgression';
import { inactivityThresholdDays } from '../activeTime';

/**
 * Cycle continuity + unified adherence.
 *
 * The rule under test, stated once:
 *
 *     meta(semana)     = min(frequência vigente naquela semana, dias ativos na semana)
 *     cumprido(semana) = min(meta(semana), dias DISTINTOS treinados na semana)
 *     ratio            = Σ cumprido / Σ meta
 *
 * applied across EVERY ProgramInstance of one TrainingCycle.
 */

// 2026-10-19 is a Monday. Week 1 runs 19→25/10, week 2 26/10→01/11.
const MON = '2026-10-19', TUE = '2026-10-20', WED = '2026-10-21';
const THU = '2026-10-22', FRI = '2026-10-23', SAT = '2026-10-24', SUN = '2026-10-25';
const NEXT_MON = '2026-10-26', NEXT_TUE = '2026-10-27', NEXT_WED = '2026-10-28';
const NEXT_THU = '2026-10-29', NEXT_FRI = '2026-10-30', NEXT_SAT = '2026-10-31', NEXT_SUN = '2026-11-01';

/** Six sessions of one exercise with three sets: only 3/3 clears the 70% floor. */
const SESSIONS = Array.from({ length: 6 }, (_, index) => ({
  exercises: [{ exerciseId: `ex-${index}`, setCount: 3 }],
}));

function window(input: {
  id: string;
  from: LocalDate;
  to?: LocalDate | null;
  frequency: number;
  sessions?: typeof SESSIONS;
}): CycleInstanceProgressionWindow {
  return {
    programInstanceId: input.id,
    activatedAtLocalDate: input.from,
    supersededAtLocalDate: input.to ?? null,
    prescribedTrainingFrequency: input.frequency,
    prescribedSessions: input.sessions ?? SESSIONS,
  };
}

function execution(input: {
  instance: string;
  date: LocalDate;
  sessionIndex?: number;
  performedLocalDate?: LocalDate;
  completedSets?: number;
  status?: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED' | 'IN_PROGRESS';
  exerciseId?: string;
  prescribedExerciseId?: string;
}) {
  const sessionIndex = input.sessionIndex ?? 0;
  const completed = input.completedSets ?? 3;
  return {
    programInstanceId: input.instance,
    sessionIndex,
    scheduledLocalDate: input.date,
    ...(input.performedLocalDate ? { performedLocalDate: input.performedLocalDate } : {}),
    status: input.status ?? ('COMPLETED' as const),
    exercises: [{
      exerciseIndex: 0,
      exerciseId: input.exerciseId ?? `ex-${sessionIndex}`,
      ...(input.prescribedExerciseId ? { prescribedExerciseId: input.prescribedExerciseId } : {}),
      sets: [0, 1, 2].map((setIndex) => ({
        setIndex,
        status: setIndex < completed ? ('COMPLETED' as const) : ('PENDING' as const),
      })),
    }],
  };
}

function ledger(execution: { programInstanceId: string; sessionIndex: number; scheduledLocalDate: string }) {
  return {
    type: 'COMPLETED' as const,
    programInstanceId: execution.programInstanceId,
    sessionIndex: execution.sessionIndex,
    scheduledDate: execution.scheduledLocalDate,
  };
}

function progression(input: {
  windows: CycleInstanceProgressionWindow[];
  today: LocalDate;
  executions: ReturnType<typeof execution>[];
  /** Omit a ledger event to simulate an unproven execution. */
  withoutLedger?: boolean;
}) {
  return computeCycleProgression({
    windows: input.windows,
    todayLocalDate: input.today,
    executions: input.executions,
    scheduleEvents: input.withoutLedger ? [] : input.executions.map(ledger),
  });
}

describe('o cenário obrigatório do brief', () => {
  it('agenda SEG/QUA/SEX, meta 3x, treinos TER/QUI/SÁB = 100% e nenhuma pausa', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })],
      today: SUN,
      executions: [
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: THU, sessionIndex: 1 }),
        execution({ instance: 'wpi-1', date: SAT, sessionIndex: 2 }),
      ],
    })!;
    expect(result.adherence.ratio).toBe(1);
    expect(result.activeTime.pausedAt).toBeNull();
    expect(result.activeTime.activeDays).toBe(7);
    // The recommended weekdays were never consulted: they are not an input.
    expect(result.trainedLocalDates).toEqual(new Set([TUE, THU, SAT]));
  });
});

describe('o dia é a unidade, e a meta é o teto', () => {
  it('dois treinos no mesmo dia valem um único crédito', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 2 })],
      today: SUN,
      executions: [
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 1 }),
      ],
    })!;
    expect(result.validSessionCount).toBe(1);
    expect(result.expectedSessions).toBe(2);
    expect(result.adherence.ratio).toBeCloseTo(0.5, 10);
  });

  it('meta 3x com cinco dias válidos credita exatamente três', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })],
      today: SUN,
      executions: [MON, TUE, WED, THU, FRI].map((date, index) =>
        execution({ instance: 'wpi-1', date, sessionIndex: index })),
    })!;
    expect(result.validSessionCount).toBe(3);
    expect(result.expectedSessions).toBe(3);
    expect(result.adherence.ratio).toBe(1);
  });

  it('nenhuma semana passa de 100%, nem com sete dias treinados', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })],
      today: SUN,
      executions: [MON, TUE, WED, THU, FRI, SAT, SUN].map((date, index) =>
        execution({ instance: 'wpi-1', date, sessionIndex: index % 6 })),
    })!;
    expect(result.adherence.ratio).toBe(1);
  });
});

describe('o que conta como treino não mudou', () => {
  it('60% das séries não conta; exatamente 70% conta', () => {
    // Ten sets in one exercise: 6/10 = 60% fails, 7/10 = 70% passes.
    const tenSetSessions = [{ exercises: [{ exerciseId: 'ex-0', setCount: 10 }] }];
    const build = (completedSets: number) => {
      const item = {
        programInstanceId: 'wpi-1',
        sessionIndex: 0,
        scheduledLocalDate: TUE,
        status: 'PARTIALLY_COMPLETED' as const,
        exercises: [{
          exerciseIndex: 0,
          exerciseId: 'ex-0',
          sets: Array.from({ length: 10 }, (_, setIndex) => ({
            setIndex,
            status: setIndex < completedSets ? ('COMPLETED' as const) : ('PENDING' as const),
          })),
        }],
      };
      return computeCycleProgression({
        windows: [{ ...window({ id: 'wpi-1', from: MON, frequency: 1 }), prescribedSessions: tenSetSessions }],
        todayLocalDate: SUN,
        executions: [item],
        scheduleEvents: [ledger(item)],
      })!;
    };
    expect(build(6).validSessionCount).toBe(0);
    expect(build(7).validSessionCount).toBe(1);
  });

  it('IN_PROGRESS e ABANDONED não recebem crédito', () => {
    for (const status of ['IN_PROGRESS', 'ABANDONED'] as const) {
      const result = progression({
        windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
        today: SUN,
        executions: [execution({ instance: 'wpi-1', date: TUE, status })],
      })!;
      expect(result.validSessionCount, status).toBe(0);
    }
  });

  it('sem evento COMPLETED no ledger não há crédito — fabricação segue impossível', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
      today: SUN,
      executions: [execution({ instance: 'wpi-1', date: TUE })],
      withoutLedger: true,
    })!;
    expect(result.validSessionCount).toBe(0);
  });

  it('credita um exercício substituído pelo id PRESCRITO, igual à autoridade do servidor', () => {
    const substituted = execution({
      instance: 'wpi-1', date: TUE,
      exerciseId: 'ex-substituto', prescribedExerciseId: 'ex-0',
    });
    const result = computeCycleProgression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
      todayLocalDate: SUN,
      executions: [substituted],
      scheduleEvents: [ledger(substituted)],
    })!;
    expect(result.validSessionCount).toBe(1);
  });

  it('usa performedLocalDate para localizar o dia treinado', () => {
    const anticipated = execution({ instance: 'wpi-1', date: SAT, performedLocalDate: THU });
    const result = computeCycleProgression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
      todayLocalDate: SUN,
      // The ledger is keyed on the SCHEDULED day, which is what it is written with.
      executions: [anticipated],
      scheduleEvents: [ledger(anticipated)],
    })!;
    expect(result.trainedLocalDates).toEqual(new Set([THU]));
    expect(result.adherence.ratio).toBe(1);
  });
});

describe('continuidade do ciclo ao adaptar', () => {
  /**
   * Week 1 at 3x on the first instance, then ADAPT to 5x on Monday of week 2.
   * The cycle started on 19/10 and the progression window must still start
   * there — not at the new instance's activation.
   */
  const adapted = [
    window({ id: 'wpi-1', from: MON, to: SUN, frequency: 3 }),
    window({ id: 'wpi-2', from: NEXT_MON, frequency: 5 }),
  ];

  it('mantém o tempo ativo acumulado do ciclo em vez de recomeçar na nova instância', () => {
    const result = progression({
      windows: adapted,
      today: NEXT_SUN,
      executions: [
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: THU, sessionIndex: 1 }),
        execution({ instance: 'wpi-1', date: SAT, sessionIndex: 2 }),
        ...[NEXT_MON, NEXT_TUE, NEXT_WED, NEXT_THU, NEXT_FRI].map((date, index) =>
          execution({ instance: 'wpi-2', date, sessionIndex: index })),
      ],
    })!;
    expect(result.cycleStartLocalDate).toBe(MON);
    expect(result.activeTime.activeDays).toBe(14);
    // Week 1 keeps its own 3x goal, week 2 gets the new 5x goal.
    expect([...result.weeklyTargets.entries()]).toEqual([[MON, 3], [NEXT_MON, 5]]);
    expect(result.validSessionCount).toBe(8);
    expect(result.adherence.ratio).toBe(1);
  });

  it('não reescreve a meta de semanas anteriores quando a frequência muda', () => {
    // Week 1 was a 3x week and was fully met. Raising the goal to 5x later
    // must not turn it into 3/5 retroactively.
    const result = progression({
      windows: adapted,
      today: NEXT_SUN,
      executions: [
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: THU, sessionIndex: 1 }),
        execution({ instance: 'wpi-1', date: SAT, sessionIndex: 2 }),
      ],
    })!;
    expect(result.weeklyTargets.get(MON)).toBe(3);
    // 3 of 3 in week 1, 0 of 5 in week 2.
    expect(result.validSessionCount).toBe(3);
    expect(result.expectedSessions).toBe(8);
  });

  it('não transporta progresso entre ciclos diferentes', () => {
    // A new cycle passes only its own window; the previous cycle's week is
    // simply not part of it, and effort from it has no target to pay into.
    const result = progression({
      windows: [window({ id: 'wpi-3', from: NEXT_MON, frequency: 3 })],
      today: NEXT_SUN,
      executions: [
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 0 }),
        execution({ instance: 'wpi-3', date: NEXT_TUE, sessionIndex: 0 }),
      ],
    })!;
    expect(result.cycleStartLocalDate).toBe(NEXT_MON);
    expect(result.activeTime.activeDays).toBe(7);
    expect(result.weeklyTargets.has(MON)).toBe(false);
    expect(result.validSessionCount).toBe(1);
  });

  it('não duplica um dia quando duas instâncias do mesmo ciclo têm registro na mesma data', () => {
    // Both instances hold a credited record for NEXT_MON — the ADAPT day.
    const overlapping = [
      window({ id: 'wpi-1', from: MON, to: NEXT_MON, frequency: 3 }),
      window({ id: 'wpi-2', from: NEXT_MON, frequency: 3 }),
    ];
    const result = progression({
      windows: overlapping,
      today: NEXT_SUN,
      executions: [
        execution({ instance: 'wpi-1', date: NEXT_MON, sessionIndex: 0 }),
        execution({ instance: 'wpi-2', date: NEXT_MON, sessionIndex: 1 }),
      ],
    })!;
    expect(result.trainedLocalDates).toEqual(new Set([NEXT_MON]));
    // One day credited in week 2, not two.
    expect(result.validSessionCount).toBe(1);
  });

  it('uma troca de dias mantendo a frequência não muda nada no cálculo', () => {
    // Same frequency, different recommended days => no ADAPT, one window.
    // The result is identical whichever days were recommended, because days
    // are not an input at all.
    const executions = [
      execution({ instance: 'wpi-1', date: TUE, sessionIndex: 0 }),
      execution({ instance: 'wpi-1', date: THU, sessionIndex: 1 }),
      execution({ instance: 'wpi-1', date: SAT, sessionIndex: 2 }),
    ];
    const before = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })], today: SUN, executions,
    })!;
    const after = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })], today: SUN, executions,
    })!;
    expect(after.adherence).toEqual(before.adherence);
    expect(after.activeTime).toEqual(before.activeTime);
    expect(after.cycleStartLocalDate).toBe(before.cycleStartLocalDate);
  });
});

describe('mudança de frequência no meio da semana', () => {
  it('a semana da virada recebe UMA única meta, nunca duas integrais', () => {
    // 3x until Wednesday, 5x from Thursday — one week, one goal.
    const result = progression({
      windows: [
        window({ id: 'wpi-1', from: MON, to: WED, frequency: 3 }),
        window({ id: 'wpi-2', from: THU, frequency: 5 }),
      ],
      today: SUN,
      executions: [],
    })!;
    expect(result.weeklyTargets.size).toBe(1);
    // `weeklyGoalForWeek`: 3x covered MON–WED (3 days), 5x covered THU–SUN
    // (4 days) — the instance that covered most of the week wins.
    expect(result.weeklyTargets.get(MON)).toBe(5);
    expect(result.expectedSessions).toBe(5);
  });

  it('créditos dos dois lados da virada somam no mesmo dia-unidade da semana', () => {
    const result = progression({
      windows: [
        window({ id: 'wpi-1', from: MON, to: WED, frequency: 3 }),
        window({ id: 'wpi-2', from: THU, frequency: 5 }),
      ],
      today: SUN,
      executions: [
        execution({ instance: 'wpi-1', date: MON, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: WED, sessionIndex: 1 }),
        execution({ instance: 'wpi-2', date: FRI, sessionIndex: 2 }),
      ],
    })!;
    expect(result.trainedLocalDates).toEqual(new Set([MON, WED, FRI]));
    expect(result.validSessionCount).toBe(3);
    expect(result.expectedSessions).toBe(5);
    expect(result.adherence.ratio).toBeCloseTo(3 / 5, 10);
  });

  it('a semana parcial de início de ciclo só espera os dias que realmente teve', () => {
    // Cycle starts on Friday: that week has 3 active days, so a 5x goal is
    // capped at 3.
    const result = progression({
      windows: [window({ id: 'wpi-1', from: FRI, frequency: 5 })],
      today: SUN,
      executions: [
        execution({ instance: 'wpi-1', date: FRI, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: SAT, sessionIndex: 1 }),
      ],
    })!;
    expect(result.expectedSessions).toBe(3);
    // Quantized to basis points by design: floor(20000/3) = 6666.
    expect(result.adherence.ratio).toBe(0.6666);
    expect(result.adherenceAtEarnBp).toBe(6666);
  });

  it('a semana em andamento não é cobrada por dias que ainda não aconteceram', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 6 })],
      today: TUE,
      executions: [
        execution({ instance: 'wpi-1', date: MON, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: TUE, sessionIndex: 1 }),
      ],
    })!;
    expect(result.expectedSessions).toBe(2);
    expect(result.adherence.ratio).toBe(1);
  });
});

describe('semanas de segunda a domingo', () => {
  it('domingo fecha a semana que o precede e segunda abre a seguinte', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
      today: NEXT_SUN,
      executions: [
        execution({ instance: 'wpi-1', date: SUN, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: NEXT_MON, sessionIndex: 1 }),
      ],
    })!;
    expect([...result.weeklyTargets.keys()]).toEqual([MON, NEXT_MON]);
    expect(result.validSessionCount).toBe(2);
    expect(result.adherence.ratio).toBe(1);
  });

  it('um sétimo treino não compra de volta uma semana inteira perdida', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })],
      today: NEXT_SUN,
      executions: [MON, TUE, WED, THU, FRI, SAT].map((date, index) =>
        execution({ instance: 'wpi-1', date, sessionIndex: index })),
    })!;
    expect(result.adherence.ratio).toBeCloseTo(0.5, 10);
  });
});

describe('pausa por inatividade e retorno', () => {
  it('congela o tempo ativo e o retoma sem perder os dias acumulados', () => {
    // 3x/week => 9 silent days are prolonged inactivity. Trained the first
    // week, vanished for three weeks, came back.
    const returnDate = addDaysLocal(MON, 28);
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 3 })],
      today: returnDate,
      executions: [
        execution({ instance: 'wpi-1', date: MON, sessionIndex: 0 }),
        execution({ instance: 'wpi-1', date: WED, sessionIndex: 1 }),
        execution({ instance: 'wpi-1', date: FRI, sessionIndex: 2 }),
        execution({ instance: 'wpi-1', date: returnDate, sessionIndex: 3 }),
      ],
    })!;
    expect(result.inactivityDayThreshold).toBe(9);
    // Froze on the 9th silent day after FRI and resumed on the return day:
    // the first week's days are all still there.
    expect(result.activeTime.pausedAt).toBeNull();
    expect(result.activeTime.activeDays).toBeGreaterThanOrEqual(13);
    expect(result.activeTime.activeDays).toBeLessThan(29);
    expect(result.countedDates.has(MON)).toBe(true);
    expect(result.countedDates.has(returnDate)).toBe(true);
    // The paused stretch owes no weekly target, so a silent week neither
    // expects nor credits anything.
    expect(result.weeklyTargets.has(addDaysLocal(MON, 14))).toBe(false);
  });

  it('a tolerância é a da frequência VIGENTE em cada dia, não a do ciclo', () => {
    // 2x até domingo, 6x a partir de segunda. Cada período é julgado pela
    // própria cadência — mudar a meta não reinterpreta o passado.
    const at = cycleInactivityDayThresholdAt([
      window({ id: 'a', from: MON, to: SUN, frequency: 2 }),
      window({ id: 'b', from: NEXT_MON, frequency: 6 }),
    ]);
    expect(at(WED)).toBe(inactivityThresholdDays(2));
    expect(at(SUN)).toBe(inactivityThresholdDays(2));
    // O dia da virada pertence às duas janelas; a mais recente vence, igual
    // ao desempate de `weeklyGoalForWeek`.
    expect(at(NEXT_MON)).toBe(inactivityThresholdDays(6));
    expect(at(NEXT_SUN)).toBe(inactivityThresholdDays(6));
  });

  it('sem frequência utilizável não há pausa possível', () => {
    expect(cycleInactivityDayThresholdAt([window({ id: 'a', from: MON, frequency: 0 })])(MON)).toBeNull();
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 0 })],
      today: addDaysLocal(MON, 40),
      executions: [],
    })!;
    expect(result.activeTime.pausedAt).toBeNull();
    expect(result.activeTime.activeDays).toBe(41);
    // No usable goal means no target at all — never a fabricated 0%.
    expect(result.weeklyTargets.size).toBe(0);
    expect(result.expectedSessions).toBe(0);
    expect(result.adherence.ratio).toBe(0);
  });
});

describe('dados ausentes, duplicados e legados', () => {
  it('sem janelas não há progressão inventada', () => {
    expect(computeCycleProgression({
      windows: [], todayLocalDate: SUN, executions: [], scheduleEvents: [],
    })).toBeNull();
  });

  it('eventos de ledger duplicados não dobram o crédito', () => {
    const item = execution({ instance: 'wpi-1', date: TUE });
    const result = computeCycleProgression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 2 })],
      todayLocalDate: SUN,
      executions: [item, item],
      scheduleEvents: [ledger(item), ledger(item), ledger(item)],
    })!;
    expect(result.validSessionCount).toBe(1);
  });

  it('ignora execução de instância que não pertence à janela', () => {
    const foreign = execution({ instance: 'wpi-outro', date: TUE });
    const result = computeCycleProgression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
      todayLocalDate: SUN,
      executions: [foreign],
      scheduleEvents: [ledger(foreign)],
    })!;
    expect(result.validSessionCount).toBe(0);
  });

  it('uma execução legada sem performedLocalDate cai no dia agendado', () => {
    const legacy = {
      programInstanceId: 'wpi-1',
      sessionIndex: 0,
      scheduledLocalDate: WED,
      status: 'COMPLETED' as const,
      exercises: [{
        exerciseIndex: 0,
        exerciseId: 'ex-0',
        sets: [0, 1, 2].map((setIndex) => ({ setIndex, status: 'COMPLETED' as const })),
      }],
    };
    const result = computeCycleProgression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 1 })],
      todayLocalDate: SUN,
      executions: [legacy],
      scheduleEvents: [ledger(legacy)],
    })!;
    expect(result.trainedLocalDates).toEqual(new Set([WED]));
  });
});

describe('buildCycleWeeklyTargets', () => {
  it('descarta semanas sem meta reconstruível em vez de inventar denominador', () => {
    const targets = buildCycleWeeklyTargets({
      countedActiveDates: new Set([MON, TUE, NEXT_MON]),
      // Only week 2 is covered by a window.
      goalWindows: [{ goal: 3, activatedAtLocalDate: NEXT_MON, supersededAtLocalDate: null }],
    });
    expect([...targets.entries()]).toEqual([[NEXT_MON, 1]]);
  });

  it('limita a meta aos dias ativos da semana', () => {
    const targets = buildCycleWeeklyTargets({
      countedActiveDates: new Set([FRI, SAT, SUN]),
      goalWindows: [{ goal: 5, activatedAtLocalDate: FRI, supersededAtLocalDate: null }],
    });
    expect(targets.get(MON)).toBe(3);
  });
});

describe('fusos horários e a virada de domingo para segunda', () => {
  it('a semana é definida pelas datas civis locais já resolvidas pelo chamador', () => {
    // The caller resolves instants to local dates; the same civil Sunday
    // belongs to the same week regardless of which timezone produced it.
    const sundayInTokyo = SUN;
    const result = progression({
      windows: [window({ id: 'wpi-1', from: SUN, frequency: 1 })],
      today: NEXT_SAT,
      executions: [execution({ instance: 'wpi-1', date: sundayInTokyo, sessionIndex: 0 })],
    })!;
    // Sunday is a one-day partial week (target capped at 1) and it was met;
    // the following Monday opens a fresh week.
    expect([...result.weeklyTargets.entries()]).toEqual([[MON, 1], [NEXT_MON, 1]]);
    expect(result.validSessionCount).toBe(1);
  });

  it('atravessa o horário de verão contando datas civis, nunca durações', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: '2026-10-29', frequency: 3 })],
      today: '2026-11-06',
      executions: [],
    })!;
    expect(result.activeTime.activeDays).toBe(9);
  });
});

describe('jornada longa: um ciclo Intermediário de 85 dias com duas adaptações', () => {
  /**
   * 13 full weeks (91 days, past the 85-day Intermediate gate), frequency
   * 3 → 4 → 5, changing on week boundaries. The user trains exactly their
   * goal every week, on arbitrary days. Nothing but the goals changes, so the
   * cycle must end at 91 active days and 100%.
   */
  function journey() {
    const windows: CycleInstanceProgressionWindow[] = [
      window({ id: 'wpi-1', from: MON, to: addDaysLocal(MON, 27), frequency: 3 }),
      window({ id: 'wpi-2', from: addDaysLocal(MON, 28), to: addDaysLocal(MON, 55), frequency: 4 }),
      window({ id: 'wpi-3', from: addDaysLocal(MON, 56), frequency: 5 }),
    ];
    const executions: ReturnType<typeof execution>[] = [];
    let sessionIndex = 0;
    for (let week = 0; week < 13; week += 1) {
      const weekStartOffset = week * 7;
      const goal = weekStartOffset < 28 ? 3 : weekStartOffset < 56 ? 4 : 5;
      const instance = weekStartOffset < 28 ? 'wpi-1' : weekStartOffset < 56 ? 'wpi-2' : 'wpi-3';
      // Deliberately irregular days inside the week — never the "recommended"
      // ones, which do not exist as far as this calculation is concerned.
      const dayOffsets = [1, 3, 5, 6, 2].slice(0, goal);
      for (const dayOffset of dayOffsets) {
        executions.push(execution({
          instance,
          date: addDaysLocal(MON, weekStartOffset + dayOffset),
          sessionIndex: sessionIndex % 6,
        }));
        sessionIndex += 1;
      }
    }
    return { windows, executions };
  }

  it('acumula 91 dias ativos e 100% atravessando as duas adaptações', () => {
    const { windows, executions } = journey();
    const result = progression({ windows, today: addDaysLocal(MON, 90), executions })!;
    expect(result.cycleStartLocalDate).toBe(MON);
    expect(result.activeTime.activeDays).toBe(91);
    expect(result.activeTime.pausedAt).toBeNull();
    // 4 weeks x 3 + 4 weeks x 4 + 5 weeks x 5 = 12 + 16 + 25 = 53.
    expect(result.expectedSessions).toBe(53);
    expect(result.validSessionCount).toBe(53);
    expect(result.adherence.ratio).toBe(1);
    expect(result.adherence.quality).toBe('HIGH');
    // Every credited day is distinct: no instance paid for another's date.
    expect(result.trainedLocalDates.size).toBe(53);
  });

  it('reavaliar o mesmo estado dá exatamente o mesmo resultado', () => {
    const { windows, executions } = journey();
    const first = progression({ windows, today: addDaysLocal(MON, 90), executions })!;
    const second = progression({ windows, today: addDaysLocal(MON, 90), executions })!;
    expect(second).toEqual(first);
  });

  it('a ordem das janelas e das execuções não altera o resultado', () => {
    const { windows, executions } = journey();
    const straight = progression({ windows, today: addDaysLocal(MON, 90), executions })!;
    const shuffled = progression({
      windows: [...windows].reverse(),
      today: addDaysLocal(MON, 90),
      executions: [...executions].reverse(),
    })!;
    expect(shuffled.adherence).toEqual(straight.adherence);
    expect(shuffled.activeTime).toEqual(straight.activeTime);
    expect(shuffled.expectedSessions).toBe(straight.expectedSessions);
    expect(shuffled.validSessionCount).toBe(straight.validSessionCount);
  });
});

describe('os limiares de elegibilidade seguem intocados', () => {
  it('70% é mérito e 85% é classificação alta, sobre a nova base', () => {
    // 7 of 10 weekly day-credits is exactly the earning boundary.
    const sevenOfTen = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 5 })],
      today: NEXT_SUN,
      executions: [
        ...[MON, TUE, WED, THU].map((date, index) => execution({ instance: 'wpi-1', date, sessionIndex: index })),
        ...[NEXT_MON, NEXT_TUE, NEXT_WED].map((date, index) => execution({ instance: 'wpi-1', date, sessionIndex: index })),
      ],
    })!;
    expect(sevenOfTen.expectedSessions).toBe(10);
    expect(sevenOfTen.validSessionCount).toBe(7);
    expect(sevenOfTen.adherence.quality).toBe('GOOD');

    const nineOfTen = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 5 })],
      today: NEXT_SUN,
      executions: [
        ...[MON, TUE, WED, THU, FRI].map((date, index) => execution({ instance: 'wpi-1', date, sessionIndex: index })),
        ...[NEXT_MON, NEXT_TUE, NEXT_WED, NEXT_THU].map((date, index) => execution({ instance: 'wpi-1', date, sessionIndex: index })),
      ],
    })!;
    expect(nineOfTen.validSessionCount).toBe(9);
    expect(nineOfTen.adherence.quality).toBe('HIGH');
  });

  it('abaixo de 70% permanece BELOW_TARGET', () => {
    const result = progression({
      windows: [window({ id: 'wpi-1', from: MON, frequency: 5 })],
      today: NEXT_SUN,
      executions: [MON, TUE, WED, NEXT_MON, NEXT_TUE, NEXT_WED].map((date, index) =>
        execution({ instance: 'wpi-1', date, sessionIndex: index })),
    })!;
    expect(result.validSessionCount).toBe(6);
    expect(result.expectedSessions).toBe(10);
    expect(result.adherence.quality).toBe('BELOW_TARGET');
  });
});

/**
 * REGRESSION — a frequency change must never reinterpret a closed history.
 *
 * The audit proved that taking ONE inactivity tolerance for the whole cycle
 * (the lowest frequency it ever prescribed) let a later ADAPT un-pause old
 * silent stretches. Those weeks came back into the counted window carrying
 * their OWN historical goals with zero fulfilment, so adherence collapsed and
 * a Beginner who was eligible stopped being eligible — measured on this very
 * engine as 54 days / 89.36% becoming 70 days / 68.85%.
 *
 * These tests reproduce that exact scenario and fail if a single cycle-wide
 * threshold is ever reintroduced.
 */
describe('REGRESSÃO — ADAPT não reinterpreta inatividade antiga', () => {
  /** 6x/week for 10 weeks with a 20-day silence in weeks 5-7. */
  function sixTimesWithHole(): number[] {
    const offsets: number[] = [];
    for (let day = 0; day <= 69; day += 1) {
      if (day >= 28 && day <= 47) continue;   // the 20-day hole
      if (day % 7 === 6) continue;            // Sundays off => 6x/week
      offsets.push(day);
    }
    return offsets;
  }

  function cycle(windows: CycleInstanceProgressionWindow[], offsets: number[], todayOffset: number) {
    const executions = offsets.map((offset) => {
      const date = addDaysLocal(MON, offset);
      const owner = [...windows].reverse().find((item) =>
        date >= item.activatedAtLocalDate) ?? windows[0];
      return execution({ instance: owner.programInstanceId, date, sessionIndex: offset % 6 });
    });
    return computeCycleProgression({
      windows,
      todayLocalDate: addDaysLocal(MON, todayOffset),
      executions,
      scheduleEvents: executions.map(ledger),
    })!;
  }

  const offsets = sixTimesWithHole();
  const before = () => cycle([window({ id: 'wpi-1', from: MON, frequency: 6 })], offsets, 69);
  const afterAdaptDown = () => cycle([
    window({ id: 'wpi-1', from: MON, to: addDaysLocal(MON, 69), frequency: 6 }),
    window({ id: 'wpi-2', from: addDaysLocal(MON, 70), frequency: 1 }),
  ], offsets, 70);

  it('o histórico de 6x segue julgado pela tolerância de 6x após adaptar para 1x', () => {
    const b = before();
    const a = afterAdaptDown();
    // The pause the 20-day silence earned under 6x is still a pause.
    expect(b.activeTime.activeDays).toBe(54);
    expect(a.activeTime.activeDays).toBe(55);  // +1: only the new day elapsed
    // The closed history keeps its numerator AND its denominator.
    expect(b.validSessionCount).toBe(42);
    expect(b.expectedSessions).toBe(47);
    expect(a.validSessionCount).toBe(42);
    expect(a.expectedSessions).toBe(48);       // +1: the new 1x week's target
  });

  it('um Iniciante elegível NÃO perde a elegibilidade ao reduzir a frequência', () => {
    const earnedBeginner = (r: ReturnType<typeof before>) =>
      r.activeTime.activeDays >= 28 && r.adherence.ratio >= 0.7;
    expect(earnedBeginner(before())).toBe(true);
    // The exact regression: this used to flip to false (68.85%).
    expect(earnedBeginner(afterAdaptDown())).toBe(true);
    expect(afterAdaptDown().adherence.ratio).toBeGreaterThanOrEqual(0.7);
  });

  it('aumentar a frequência também não reinterpreta o passado', () => {
    const up = cycle([
      window({ id: 'wpi-1', from: MON, to: addDaysLocal(MON, 69), frequency: 6 }),
      window({ id: 'wpi-2', from: addDaysLocal(MON, 70), frequency: 7 }),
    ], offsets, 70);
    expect(up.validSessionCount).toBe(42);
    expect(up.activeTime.activeDays).toBe(55);
  });

  it('o mesmo histórico encerrado dá o mesmo resultado sob qualquer sequência de ADAPTs', () => {
    // Three different futures bolted onto one identical closed history: the
    // part already closed must be byte-identical in all of them.
    const futures = [1, 3, 7].map((frequency) => cycle([
      window({ id: 'wpi-1', from: MON, to: addDaysLocal(MON, 69), frequency: 6 }),
      window({ id: 'wpi-2', from: addDaysLocal(MON, 70), frequency }),
    ], offsets, 70));
    const closedWeeks = (r: ReturnType<typeof before>) =>
      [...r.weeklyTargets.entries()].filter(([week]) => week < addDaysLocal(MON, 70));
    expect(closedWeeks(futures[1])).toEqual(closedWeeks(futures[0]));
    expect(closedWeeks(futures[2])).toEqual(closedWeeks(futures[0]));
    for (const future of futures) expect(future.validSessionCount).toBe(42);
  });

  it('quem está realmente inativo continua pausando, e retoma sem perder o acumulado', () => {
    // Same 6x history, evaluated DURING the silence: the pause must be live.
    const during = cycle([window({ id: 'wpi-1', from: MON, frequency: 6 })], offsets, 40);
    expect(during.activeTime.pausedAt).not.toBeNull();
    // ...and after the return it is cleared, with the pre-pause days intact.
    const after = before();
    expect(after.activeTime.pausedAt).toBeNull();
    expect(after.countedDates.has(MON)).toBe(true);
    expect(after.activeTime.activeDays).toBeGreaterThan(during.activeTime.activeDays);
  });
});

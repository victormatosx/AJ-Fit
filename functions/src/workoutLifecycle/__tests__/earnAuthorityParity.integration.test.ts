import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authoritativeEarnedFact, authorizeWorkoutLifecycleMutationHandler } from '../authorizeMutation';
import { readApproachingContext } from '../../notifications/evolutionApproachingContext';
import {
  adherenceBasisPoints,
  computeAdherence,
} from '../prescriptionEngine/progressionEngineV2/adherence';
import { computeCycleProgression } from '../prescriptionEngine/progressionEngineV2/cycleProgression';

/**
 * CLIENT ↔ AUTHORITY PARITY, against the REAL recomputation.
 *
 * Every assertion here runs `authoritativeEarnedFact` — the same function the
 * EARN grant is issued from — against real Firestore Emulator documents, and
 * compares it with the pure engine the client runs. Deliberately NOT a
 * fixture that echoes the client's own values back: that circularity is
 * exactly why the audit's basis-point divergence survived every existing
 * test. The three scenarios that found real defects are pinned permanently:
 *
 *  1. a repeating adherence ratio (11/12) used to diverge by one basis point
 *     between `Math.round` on the client and `Math.floor` on the server, and
 *     the authority rejected the EARN as forged;
 *  2. the EARN authority used to demand byte-for-byte equality with the
 *     client's counters, making two honest app builds mutually exclusive;
 *  3. the evolution-approaching observer scoped its window to the ACTIVE
 *     ProgramInstance, so after an ADAPT it reported 0% adherence for a user
 *     the authority was simultaneously promoting.
 */
const enabled = process.env.EARN_AUTHORITY_PARITY_INTEGRATION === '1';
const UID = 'earn-authority-parity';
const TZ = 'UTC';
/** A Monday — used wherever `now` can be injected explicitly. */
const START = '2026-01-05';
const START_MS = Date.UTC(2026, 0, 5, 12, 0, 0);

/**
 * `authorizeWorkoutLifecycleMutationHandler` has no injectable clock: it calls
 * `authoritativeEarnedFact(..., new Date())`. Scenarios that go through the
 * handler therefore anchor their cycle so that its LAST day is today, which
 * keeps the expected counts deterministic whatever day the suite runs on.
 */
function anchoredStart(cycleDays: number): { startMs: number; startLocalDate: string } {
  const todayMidday = new Date();
  todayMidday.setUTCHours(12, 0, 0, 0);
  const startMs = todayMidday.getTime() - (cycleDays - 1) * 86_400_000;
  return { startMs, startLocalDate: new Date(startMs).toISOString().slice(0, 10) };
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

/** `now` at midday on the given cycle-day offset. */
function at(offset: number): Date {
  return new Date(START_MS + offset * 86_400_000);
}

interface Scenario {
  frequency: number;
  /** Cycle-day offsets with a credited workout. */
  trainedOffsets: number[];
  /** Cycle-day offset of "today", inclusive. */
  todayOffset: number;
  /** Overrides the fixed anchor; used by handler-driven scenarios. */
  startMs?: number;
  startLocalDate?: string;
}

describe.skipIf(!enabled)('EARN authority ↔ client parity (real Firestore Emulator)', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'earn-authority-parity');
    db = getFirestore(app);
  });
  afterAll(async () => deleteApp(app));

  async function seed(scenario: Scenario): Promise<void> {
    const startMs = scenario.startMs ?? START_MS;
    const startLocalDate = scenario.startLocalDate ?? START;
    await db.recursiveDelete(db.collection('users').doc(UID));
    const root = db.collection('users').doc(UID);
    await Promise.all([
      root.set({ metadata: {} }),
      root.collection('workoutLifecycleState').doc('current').set({
        currentTrainingLevel: 'BEGINNER', currentCycleId: 'cyc_1', currentCycleNumber: 1,
        activeProgramInstanceId: 'wpi_1', activeContentIdentity: 'wpg_1',
        activePrescriptionIdentity: 'rx_1',
      }),
      root.collection('programInstances').doc('wpi_1').set({
        programInstanceId: 'wpi_1', cycleId: 'cyc_1', contentIdentity: 'wpg_1',
        prescriptionIdentity: 'rx_1', activatedAt: Timestamp.fromMillis(startMs), supersededAt: null,
      }),
      root.collection('trainingCycles').doc('cyc_1').set({
        cycleId: 'cyc_1', level: 'BEGINNER', cycleNumber: 1, status: 'ACTIVE',
      }),
      root.collection('workoutPrograms').doc('wpg_1').set({
        programId: 'wpg_1', prescriptionId: 'rx_1', status: 'active',
        scheduleMode: 'flexible', prescribedTrainingFrequency: scenario.frequency,
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'squat', sets: 1 }] }],
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: TZ, scheduleVersion: 1,
      }),
    ]);
    await Promise.all(scenario.trainedOffsets.flatMap((offset) => {
      const date = addDays(startLocalDate, offset);
      return [
        db.collection('users').doc(UID).collection('workoutExecutions').doc(`ex_${offset}`).set({
          programId: 'wpg_1', programInstanceId: 'wpi_1', sessionIndex: 0,
          scheduledLocalDate: date, status: 'COMPLETED',
          exercises: [{
            exerciseIndex: 0, exerciseId: 'squat', prescribedSets: 1,
            sets: [{ setIndex: 0, status: 'COMPLETED' }],
          }],
        }),
        db.collection('users').doc(UID).collection('workoutPrograms').doc('wpg_1')
          .collection('scheduleEvents').doc(`ev_${offset}`).set({
            type: 'COMPLETED', programInstanceId: 'wpi_1', sessionIndex: 0, scheduledDate: date,
          }),
      ];
    }));
  }

  /** The pure engine, exactly as the client runs it. */
  function clientSide(scenario: Scenario) {
    const startLocalDate = scenario.startLocalDate ?? START;
    const progression = computeCycleProgression({
      windows: [{
        programInstanceId: 'wpi_1',
        activatedAtLocalDate: startLocalDate,
        supersededAtLocalDate: null,
        prescribedTrainingFrequency: scenario.frequency,
        prescribedSessions: [{ exercises: [{ exerciseId: 'squat', setCount: 1 }] }],
      }],
      todayLocalDate: addDays(startLocalDate, scenario.todayOffset),
      executions: scenario.trainedOffsets.map((offset) => ({
        programInstanceId: 'wpi_1', sessionIndex: 0,
        scheduledLocalDate: addDays(startLocalDate, offset), status: 'COMPLETED' as const,
        exercises: [{ exerciseIndex: 0, exerciseId: 'squat', sets: [{ setIndex: 0, status: 'COMPLETED' as const }] }],
      })),
      scheduleEvents: scenario.trainedOffsets.map((offset) => ({
        type: 'COMPLETED' as const, programInstanceId: 'wpi_1', sessionIndex: 0,
        scheduledDate: addDays(startLocalDate, offset),
      })),
    })!;
    return progression;
  }

  /** 4 full weeks at goal 3 => expected 12. */
  const fourWeeks = (trainedOffsets: number[]): Scenario =>
    ({ frequency: 3, todayOffset: 27, trainedOffsets });

  const ALL_DAYS = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];

  it.each([
    ['9/12 — an exact ratio (75%)', ALL_DAYS.slice(0, 9), 9, 7500],
    ['10/12 — 83.33…%, floor 8333', ALL_DAYS.slice(0, 10), 10, 8333],
    ['11/12 — 91.66…%, the pair that used to be rejected as forged', ALL_DAYS.slice(0, 11), 11, 9166],
    ['12/12 — exactly 100%', ALL_DAYS, 12, 10_000],
  ] as const)('%s: client and authority agree to the basis point', async (_label, offsets, valid, bp) => {
    const scenario = fourWeeks([...offsets]);
    await seed(scenario);
    const client = clientSide(scenario);
    const authority = await authoritativeEarnedFact(UID, db, at(27));

    expect(client.expectedSessions).toBe(12);
    expect(client.validSessionCount).toBe(valid);
    expect(client.adherenceAtEarnBp).toBe(bp);
    // The authority's own recomputation, from real documents.
    expect(authority.sessionsCompletedAtEarn).toBe(valid);
    expect(authority.adherenceAtEarnBp).toBe(bp);
    // ...and the shared pure function agrees with both.
    expect(adherenceBasisPoints(valid, 12)).toBe(bp);
    expect(computeAdherence(valid, 12).ratio).toBe(bp / 10_000);
  });

  it('active days come from the CYCLE and the decision matches the client', async () => {
    const scenario = fourWeeks(ALL_DAYS);
    await seed(scenario);
    expect(clientSide(scenario).activeTime.activeDays).toBe(28);
    await expect(authoritativeEarnedFact(UID, db, at(27))).resolves.toMatchObject({
      type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE', quality: 'HIGH',
    });
  });

  describe('version skew — the authority authors the fact', () => {
    /** A 28-day cycle whose last day is today, goal 3 => expected 12. */
    function anchoredFourWeeks(trainedOffsets: number[]): Scenario {
      const { startMs, startLocalDate } = anchoredStart(28);
      return { frequency: 3, todayOffset: 27, trainedOffsets, startMs, startLocalDate };
    }

    async function authorize(earnedFact: Record<string, unknown> | undefined) {
      return authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'EARN',
          sourceProgramInstanceId: 'wpi_1',
          sourceCycleId: 'cyc_1',
          ...(earnedFact === undefined ? {} : { earnedFact }),
        },
      } as never, db);
    }

    it('a CURRENT build sends only the transition type and receives the server figures', async () => {
      const scenario = anchoredFourWeeks(ALL_DAYS.slice(0, 11));
      await seed(scenario);
      const client = clientSide(scenario);
      const result = await authorize({ type: 'LEVEL_PROMOTION' });
      // The whole point: the authority's own recomputation, and the pure
      // engine the client runs, produce the SAME figures — asserted against
      // the client's computation rather than a hardcoded constant, so this
      // stays a parity test and never degenerates into a snapshot.
      expect(result.earned?.fact).toMatchObject({
        type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
        sessionsCompletedAtEarn: client.validSessionCount,
        adherenceAtEarnBp: client.adherenceAtEarnBp,
      });
      expect(client.adherenceAtEarnBp).toBe(adherenceBasisPoints(
        client.validSessionCount, client.expectedSessions,
      ));
      // The identity the ledger entry must use comes back too, so the client
      // never has to derive it.
      expect(result.earned?.eventType).toBe('EVOLUTION_EARNED');
      expect(result.earned?.idempotencyKey).toBe('evolution:wpi_1:LEVEL_PROMOTION');
      expect(result.earned?.eventId).toBeTypeOf('string');
    });

    it('an OLDER build sending its own (divergent) counters is still authorized', async () => {
      const scenario = anchoredFourWeeks(ALL_DAYS.slice(0, 11));
      await seed(scenario);
      const client = clientSide(scenario);
      // `+ 1` reproduces exactly what the old client's `Math.round` produced
      // for a repeating ratio — the value that used to be rejected outright
      // as `forged_earned_fact`.
      const staleBp = client.adherenceAtEarnBp + 1;
      const result = await authorize({
        type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
        quality: 'GOOD', sessionsCompletedAtEarn: client.validSessionCount + 3,
        adherenceAtEarnBp: staleBp,
      });
      // Authorized — and the grant carries the SERVER's figures, never the
      // caller's, so nothing unauthoritative can reach the ledger.
      expect(result.earned?.fact.adherenceAtEarnBp).toBe(client.adherenceAtEarnBp);
      expect(result.earned?.fact.adherenceAtEarnBp).not.toBe(staleBp);
      expect(result.earned?.fact.sessionsCompletedAtEarn).toBe(client.validSessionCount);
    });

    it('a caller asking for a DIFFERENT transition is refused', async () => {
      await seed(anchoredFourWeeks(ALL_DAYS));
      await expect(authorize({ type: 'CYCLE_EVOLUTION' }))
        .rejects.toMatchObject({ message: 'earned_fact_transition_mismatch' });
      await expect(authorize({ type: 'LEVEL_PROMOTION', toLevel: 'ADVANCED' }))
        .rejects.toMatchObject({ message: 'earned_fact_transition_mismatch' });
    });

    it('a caller with no earned transition at all is refused', async () => {
      // One workout in four weeks: nowhere near the 70% bar.
      await seed(anchoredFourWeeks([0]));
      await expect(authorize({ type: 'LEVEL_PROMOTION' }))
        .rejects.toBeInstanceOf(HttpsError);
      await expect(authorize({ type: 'LEVEL_PROMOTION' }))
        .rejects.toMatchObject({ message: 'progression_not_eligible' });
    });

    it('a forged event identity is still refused when supplied', async () => {
      await seed(anchoredFourWeeks(ALL_DAYS));
      await expect(authorizeWorkoutLifecycleMutationHandler({
        auth: { uid: UID },
        data: {
          operation: 'EARN', sourceProgramInstanceId: 'wpi_1', sourceCycleId: 'cyc_1',
          earnedFact: { type: 'LEVEL_PROMOTION' },
          eventId: 'wle_forged', eventType: 'EVOLUTION_EARNED',
          idempotencyKey: 'evolution:wpi_1:LEVEL_PROMOTION',
        },
      } as never, db)).rejects.toMatchObject({ message: 'forged_earned_event_identity' });
    });

    it('a malformed earnedFact is rejected rather than ignored', async () => {
      await seed(anchoredFourWeeks(ALL_DAYS));
      await expect(authorize('not-an-object' as never))
        .rejects.toMatchObject({ message: 'invalid_earned_fact' });
    });
  });

  describe('the approaching notification sees the same window as the authority', () => {
    /** 09:00 UTC is inside the observer's 08:00–10:00 local dispatch window. */
    const nineAm = (offset: number) =>
      Timestamp.fromMillis(Date.UTC(2026, 0, 5 + offset, 9));

    async function adaptOnDay(offset: number) {
      const root = db.collection('users').doc(UID);
      const adaptMs = Date.UTC(2026, 0, 5 + offset, 12, 0, 0);
      await Promise.all([
        root.collection('programInstances').doc('wpi_1').update({
          supersededAt: Timestamp.fromMillis(adaptMs),
        }),
        root.collection('workoutPrograms').doc('wpg_2').set({
          programId: 'wpg_2', prescriptionId: 'rx_2', status: 'active',
          scheduleMode: 'flexible', prescribedTrainingFrequency: 3,
          sessions: [{ name: 'A', exercises: [{ exerciseId: 'squat', sets: 1 }] }],
        }),
        root.collection('programInstances').doc('wpi_2').set({
          programInstanceId: 'wpi_2', cycleId: 'cyc_1', contentIdentity: 'wpg_2',
          prescriptionIdentity: 'rx_2', activatedAt: Timestamp.fromMillis(adaptMs), supersededAt: null,
        }),
        root.collection('workoutLifecycleState').doc('current').update({
          activeProgramInstanceId: 'wpi_2', activeContentIdentity: 'wpg_2',
          activePrescriptionIdentity: 'rx_2',
        }),
      ]);
    }

    it('REGRESSION — an ADAPT no longer blinds the observer to the cycle progress', async () => {
      // 25 cycle days at 100%: three days from the Beginner bar, which is
      // exactly the approaching window.
      await seed({ frequency: 3, todayOffset: 24, trainedOffsets: [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23] });
      await adaptOnDay(22);
      const context = await readApproachingContext(db, UID, nineAm(24));
      // Before the fix this denied with ADHERENCE_BELOW_THRESHOLD, because
      // every execution belonged to the superseded instance.
      expect(context).toMatchObject({ allowed: true, progressionWindowId: 'wpi_2' });
    });

    it('still denies when the cycle genuinely is not approaching', async () => {
      // Full adherence (goal 3, trained 3 + 2 of a partial week) but only 11
      // cycle days: far outside the 3-day approaching window.
      await seed({ frequency: 3, todayOffset: 10, trainedOffsets: [0, 2, 4, 7, 9] });
      await adaptOnDay(8);
      const context = await readApproachingContext(db, UID, nineAm(10));
      expect(context.allowed).toBe(false);
      expect((context as { reason: string }).reason).toBe('OUTSIDE_APPROACHING_WINDOW');
    });
  });
});

/**
 * SYNTHETIC CAREERS — one account walked through the whole domain against the
 * REAL authority: frequency changes, prolonged inactivity and a return, a
 * level evolution, and a second cycle. Each step asserts that the client
 * engine, the EARN authority and the approaching observer describe the SAME
 * account.
 */
const SYN = 'synthetic-career';

describe.skipIf(!enabled)('synthetic careers (real Firestore Emulator)', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'synthetic-career');
    db = getFirestore(app);
  });
  afterAll(async () => deleteApp(app));

  interface Instance {
    id: string;
    contentIdentity: string;
    frequency: number;
    /** Cycle-day offset it activated on. */
    from: number;
    /** Cycle-day offset it was superseded on; `null` while active. */
    to: number | null;
  }

  /**
   * Seeds one TrainingCycle made of `instances`, with a credited workout on
   * every offset in `trained`. The cycle's last day is `days - 1`, anchored
   * so that day is TODAY (the authority has no injectable clock).
   */
  async function seedCareer(input: {
    uid: string;
    cycleId: string;
    cycleNumber: number;
    level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    days: number;
    instances: Instance[];
    trained: number[];
    reset?: boolean;
  }): Promise<{ startLocalDate: string; startMs: number }> {
    const { startMs, startLocalDate } = anchoredStart(input.days);
    const root = db.collection('users').doc(input.uid);
    if (input.reset !== false) await db.recursiveDelete(root);
    const active = input.instances[input.instances.length - 1];
    const dayMs = (offset: number) => startMs + offset * 86_400_000;

    await Promise.all([
      root.set({ metadata: {} }, { merge: true }),
      root.collection('workoutLifecycleState').doc('current').set({
        currentTrainingLevel: input.level,
        currentCycleId: input.cycleId,
        currentCycleNumber: input.cycleNumber,
        activeProgramInstanceId: active.id,
        activeContentIdentity: active.contentIdentity,
        activePrescriptionIdentity: `rx_${active.id}`,
      }),
      root.collection('trainingCycles').doc(input.cycleId).set({
        cycleId: input.cycleId, level: input.level, cycleNumber: input.cycleNumber, status: 'ACTIVE',
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: TZ, scheduleVersion: 1,
      }),
      ...input.instances.flatMap((instance) => [
        root.collection('programInstances').doc(instance.id).set({
          programInstanceId: instance.id, cycleId: input.cycleId,
          contentIdentity: instance.contentIdentity, prescriptionIdentity: `rx_${instance.id}`,
          activatedAt: Timestamp.fromMillis(dayMs(instance.from)),
          supersededAt: instance.to === null ? null : Timestamp.fromMillis(dayMs(instance.to)),
        }),
        root.collection('workoutPrograms').doc(instance.contentIdentity).set({
          programId: instance.contentIdentity, prescriptionId: `rx_${instance.id}`, status: 'active',
          scheduleMode: 'flexible', prescribedTrainingFrequency: instance.frequency,
          sessions: [{ name: 'A', exercises: [{ exerciseId: 'squat', sets: 1 }] }],
        }),
      ]),
    ]);

    /** The instance that covered a given offset — latest activation wins. */
    const owner = (offset: number) =>
      [...input.instances].reverse().find((item) => offset >= item.from) ?? input.instances[0];

    await Promise.all(input.trained.flatMap((offset) => {
      const instance = owner(offset);
      const date = addDays(startLocalDate, offset);
      return [
        root.collection('workoutExecutions').doc(`ex_${input.cycleId}_${offset}`).set({
          programId: instance.contentIdentity, programInstanceId: instance.id, sessionIndex: 0,
          scheduledLocalDate: date, status: 'COMPLETED',
          exercises: [{
            exerciseIndex: 0, exerciseId: 'squat', prescribedSets: 1,
            sets: [{ setIndex: 0, status: 'COMPLETED' }],
          }],
        }),
        root.collection('workoutPrograms').doc(instance.contentIdentity)
          .collection('scheduleEvents').doc(`ev_${input.cycleId}_${offset}`).set({
            type: 'COMPLETED', programInstanceId: instance.id, sessionIndex: 0, scheduledDate: date,
          }),
      ];
    }));
    return { startLocalDate, startMs };
  }

  /** The pure engine over the same window the authority will read. */
  function clientCareer(input: {
    startLocalDate: string; days: number; instances: Instance[]; trained: number[];
  }) {
    const windows = input.instances.map((instance) => ({
      programInstanceId: instance.id,
      activatedAtLocalDate: addDays(input.startLocalDate, instance.from),
      supersededAtLocalDate: instance.to === null ? null : addDays(input.startLocalDate, instance.to),
      prescribedTrainingFrequency: instance.frequency,
      prescribedSessions: [{ exercises: [{ exerciseId: 'squat', setCount: 1 }] }],
    }));
    const owner = (offset: number) =>
      [...input.instances].reverse().find((item) => offset >= item.from) ?? input.instances[0];
    const executions = input.trained.map((offset) => ({
      programInstanceId: owner(offset).id, sessionIndex: 0,
      scheduledLocalDate: addDays(input.startLocalDate, offset), status: 'COMPLETED' as const,
      exercises: [{ exerciseIndex: 0, exerciseId: 'squat', sets: [{ setIndex: 0, status: 'COMPLETED' as const }] }],
    }));
    return computeCycleProgression({
      windows,
      todayLocalDate: addDays(input.startLocalDate, input.days - 1),
      executions,
      scheduleEvents: executions.map((item) => ({
        type: 'COMPLETED' as const, programInstanceId: item.programInstanceId,
        sessionIndex: 0, scheduledDate: item.scheduledLocalDate,
      })),
    })!;
  }

  /** Every third day, across `days`, honouring an optional silent stretch. */
  function everyOtherDay(days: number, silentFrom?: number, silentTo?: number): number[] {
    const trained: number[] = [];
    for (let day = 0; day < days; day += 2) {
      if (silentFrom != null && silentTo != null && day >= silentFrom && day <= silentTo) continue;
      trained.push(day);
    }
    return trained;
  }

  it('CAREER A — two frequency changes inside one cycle: progress is continuous', async () => {
    const days = 28;
    const instances: Instance[] = [
      { id: 'wpi_a1', contentIdentity: 'wpg_a1', frequency: 3, from: 0, to: 9 },
      { id: 'wpi_a2', contentIdentity: 'wpg_a2', frequency: 4, from: 10, to: 20 },
      { id: 'wpi_a3', contentIdentity: 'wpg_a3', frequency: 5, from: 21, to: null },
    ];
    const trained = everyOtherDay(days);
    const { startLocalDate } = await seedCareer({
      uid: SYN, cycleId: 'cyc_a', cycleNumber: 1, level: 'BEGINNER', days, instances, trained,
    });

    const client = clientCareer({ startLocalDate, days, instances, trained });
    // The window spans the CYCLE, not the active instance's 8 days.
    expect(client.cycleStartLocalDate).toBe(startLocalDate);
    expect(client.activeTime.activeDays).toBe(days);
    expect(client.activeTime.pausedAt).toBeNull();

    const authority = await authoritativeEarnedFact(SYN, db, new Date());
    expect(authority.sessionsCompletedAtEarn).toBe(client.validSessionCount);
    expect(authority.adherenceAtEarnBp).toBe(client.adherenceAtEarnBp);
    expect(authority.quality).toBe(client.adherence.quality);
  });

  it('CAREER B — prolonged inactivity then a return: the pre-pause days survive', async () => {
    const days = 40;
    const instances: Instance[] = [
      { id: 'wpi_b1', contentIdentity: 'wpg_b1', frequency: 3, from: 0, to: null },
    ];
    // Trained every other day, silent from day 10 to day 29 (20 days), back after.
    const trained = everyOtherDay(days, 10, 29);
    const { startLocalDate } = await seedCareer({
      uid: SYN, cycleId: 'cyc_b', cycleNumber: 1, level: 'BEGINNER', days, instances, trained,
    });

    const client = clientCareer({ startLocalDate, days, instances, trained });
    // 3x/week => 9 silent days freeze Active Time, so the 40 calendar days
    // cannot all have counted...
    expect(client.activeTime.activeDays).toBeGreaterThan(10);
    expect(client.activeTime.activeDays).toBeLessThan(days);
    // ...the return cleared the pause...
    expect(client.activeTime.pausedAt).toBeNull();
    // ...and the first day is still in the window: nothing was lost.
    expect(client.countedDates.has(startLocalDate)).toBe(true);

    const authority = await authoritativeEarnedFact(SYN, db, new Date()).catch((error) => error as Error);
    if (authority instanceof Error) {
      // Not eligible is a legitimate outcome here; what matters is that the
      // authority agrees it is not eligible rather than disagreeing about why.
      expect(client.adherence.ratio < 0.7 || client.activeTime.activeDays < 28).toBe(true);
    } else {
      expect(authority.sessionsCompletedAtEarn).toBe(client.validSessionCount);
      expect(authority.adherenceAtEarnBp).toBe(client.adherenceAtEarnBp);
    }
  });

  it('CAREER C — the authority grants a BEGINNER promotion and the observer agrees', async () => {
    const days = 28;
    const instances: Instance[] = [
      { id: 'wpi_c1', contentIdentity: 'wpg_c1', frequency: 3, from: 0, to: 13 },
      { id: 'wpi_c2', contentIdentity: 'wpg_c2', frequency: 3, from: 14, to: null },
    ];
    // Three workouts per 7-day block, across the adaptation. The cycle is
    // anchored so its last day is TODAY, so these blocks do not align with
    // Monday-anchored weeks — the exact per-week arithmetic is pinned
    // deterministically in the pure suite; what matters here is continuity
    // across the ADAPT and agreement with the authority.
    const trained: number[] = [];
    for (let week = 0; week < 4; week += 1) trained.push(week * 7, week * 7 + 2, week * 7 + 4);
    const { startLocalDate } = await seedCareer({
      uid: SYN, cycleId: 'cyc_c', cycleNumber: 1, level: 'BEGINNER', days, instances, trained,
    });

    const client = clientCareer({ startLocalDate, days, instances, trained });
    // Continuity: the whole cycle counted, despite the ADAPT on day 14.
    expect(client.activeTime.activeDays).toBe(28);
    expect(client.activeTime.pausedAt).toBeNull();
    // Above the earning threshold, which is what the promotion needs.
    expect(client.adherence.ratio).toBeGreaterThanOrEqual(0.7);

    const authority = await authoritativeEarnedFact(SYN, db, new Date());
    expect(authority).toMatchObject({
      type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE',
      quality: client.adherence.quality,
    });
    expect(authority.sessionsCompletedAtEarn).toBe(client.validSessionCount);
    expect(authority.adherenceAtEarnBp).toBe(client.adherenceAtEarnBp);

    // The observer sees the same cycle. It denies because the account is
    // already EARNED (not because an ADAPT blinded it to the history) — the
    // precise distinction the audit found broken.
    const nineAm = Timestamp.fromMillis(Date.UTC(
      new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 9,
    ));
    const context = await readApproachingContext(db, SYN, nineAm);
    expect(context.allowed).toBe(false);
    expect((context as { reason: string }).reason).toBe('LEVEL_PROMOTION_ELIGIBLE');
  });

  it('CAREER D — a second cycle starts from zero and never inherits cycle 1', async () => {
    const days = 14;
    // Cycle 1's instance stays in Firestore, superseded — exactly what an
    // earned evolution leaves behind.
    const cycle1: Instance[] = [
      { id: 'wpi_d1', contentIdentity: 'wpg_d1', frequency: 3, from: 0, to: 6 },
    ];
    await seedCareer({
      uid: SYN, cycleId: 'cyc_d1', cycleNumber: 1, level: 'BEGINNER', days,
      instances: cycle1, trained: [0, 2, 4],
    });
    // Now cycle 2, pointed at by the lifecycle, with its OWN instance.
    const cycle2: Instance[] = [
      { id: 'wpi_d2', contentIdentity: 'wpg_d2', frequency: 3, from: 7, to: null },
    ];
    const { startLocalDate } = await seedCareer({
      uid: SYN, cycleId: 'cyc_d2', cycleNumber: 2, level: 'INTERMEDIATE', days,
      instances: cycle2, trained: [7, 9, 11], reset: false,
    });

    const client = clientCareer({ startLocalDate, days, instances: cycle2, trained: [7, 9, 11] });
    // The window starts at cycle 2's activation, never at cycle 1's.
    expect(client.cycleStartLocalDate).toBe(addDays(startLocalDate, 7));
    expect(client.activeTime.activeDays).toBe(7);
    // Cycle 1's three workouts are not credited here.
    expect(client.validSessionCount).toBe(3);
    expect(client.trainedLocalDates.size).toBe(3);

    // An INTERMEDIATE at 7 active days is nowhere near the 85-day bar.
    await expect(authoritativeEarnedFact(SYN, db, new Date()))
      .rejects.toMatchObject({ message: 'progression_not_eligible' });
  });
});

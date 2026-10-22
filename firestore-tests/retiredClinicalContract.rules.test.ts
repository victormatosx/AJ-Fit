import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

/**
 * Fechamento da arquitetura clínica aposentada.
 *
 * O sistema musculoesquelético foi removido. O produto está em
 * pré-lançamento, sem usuários externos, e os aparelhos internos são
 * atualizados ou reinstalados — então NÃO existe compatibilidade a preservar
 * com binários antigos, e as Rules podem recusar o contrato aposentado em
 * definitivo.
 *
 * O que se prova aqui é a fronteira exata dessa recusa: ela vale para
 * ESCRITA NOVA, e não para o que já está gravado. Um questionário antigo
 * continua legível; uma execução que já carrega o metadado de política
 * continua utilizável até ser finalizada. Fechar a porta de entrada não pode
 * virar perda de histórico.
 */

let env: RulesTestEnvironment;
const db = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@ajfit.test`, email_verified: true }).firestore();

/** Questionário no formato ATUAL: sem nenhum campo clínico. */
const questionario = (overrides: Record<string, unknown> = {}) => ({
  answers: {
    sex: 'male', goal: 'hypertrophy', level: 'intermediate',
    specialConditions: [], duration: 60, days: 5,
    ...overrides,
  },
  version: 1,
  createdAt: serverTimestamp(),
});

const EXEC = 'exec_inst1_0_2026-10-22';

/** Execução no formato aposentado, como só o Admin SDK consegue gravar hoje. */
const execucaoHistorica = () => ({
  programId: 'prog1', programInstanceId: 'inst1', templateId: 'T004', sessionIndex: 0,
  scheduledLocalDate: '2026-10-22', status: 'IN_PROGRESS', startedAt: Timestamp.now(),
  finishedAt: null, exercises: [], executionSchemaVersion: 2, createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(), mutexProtocolVersion: 1, cardio: null,
  substitutionPolicySnapshot: 'v3',
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'ajfit-rules-test',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const f = context.firestore();
    // `inscrita` está no piloto; `legada` não. Idênticas no resto, para que
    // qualquer diferença de resultado seja atribuível só à inscrição.
    for (const uid of ['inscrita', 'legada']) {
      await setDoc(doc(f, `users/${uid}`), {
        accountStatus: 'active',
        profile: { email: `${uid}@ajfit.test` },
      });
    }
    await setDoc(doc(f, 'workoutPilotEnrollment/inscrita'), { enabled: true });
  });
});

describe('o contrato aposentado nao entra mais por escrita nova', () => {
  it('recusa um questionario com `limits`', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      questionario({ limits: ['knee', 'shoulder'] })));
  });

  it('recusa um questionario com `limitationImpact`', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      questionario({ limitationImpact: 'moderate' })));
  });

  it('recusa `musculoskeletal_limitation` dentro de specialConditions', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      questionario({ specialConditions: ['musculoskeletal_limitation'] })));
  });

  it('recusa mesmo quando o valor parece inofensivo — a chave e o que importa', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      questionario({ limits: [] })));
  });

  it('recusa para conta do piloto exatamente igual', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/inscrita/questionnaires/q1'),
      questionario({ limits: ['back'] })));
  });

  it('nenhuma execucao nova pode carregar o metadado de politica', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/legada/workoutLifecycleState/current'),
        { activeProgramInstanceId: 'inst1' });
    });
    await assertFails(setDoc(doc(db('legada'), `users/legada/workoutExecutions/${EXEC}`), {
      ...execucaoHistorica(), startedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
});

describe('o questionario no formato atual continua funcionando', () => {
  it('conta comum conclui o onboarding', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'), questionario()));
  });

  it('conta do piloto conclui o onboarding', async () => {
    await assertSucceeds(setDoc(doc(db('inscrita'), 'users/inscrita/questionnaires/q1'), questionario()));
  });

  it('as outras condicoes especiais seguem aceitas — so a clinica saiu', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q2'),
      questionario({ specialConditions: ['lipedema', 'post_surgical'] })));
  });
});

describe('fechar a entrada nao apaga o historico', () => {
  it('um questionario ja gravado com campos clinicos continua LEGIVEL', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/legada/questionnaires/antigo'), {
        answers: { sex: 'male', goal: 'hypertrophy', level: 'intermediate',
                   specialConditions: ['musculoskeletal_limitation'], limits: ['knee'], limitationImpact: 'moderate' },
        version: 1, createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(getDoc(doc(db('legada'), 'users/legada/questionnaires/antigo')));
  });

  it('uma execucao historica com o metadado continua LEGIVEL', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const f = context.firestore();
      await setDoc(doc(f, 'users/legada/workoutLifecycleState/current'), { activeProgramInstanceId: 'inst1' });
      await setDoc(doc(f, `users/legada/workoutExecutions/${EXEC}`), execucaoHistorica());
    });
    await assertSucceeds(getDoc(doc(db('legada'), `users/legada/workoutExecutions/${EXEC}`)));
  });

  it('e o valor do metadado nao pode ser alterado nem removido', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const f = context.firestore();
      await setDoc(doc(f, 'users/legada/workoutLifecycleState/current'), { activeProgramInstanceId: 'inst1' });
      await setDoc(doc(f, `users/legada/workoutExecutions/${EXEC}`), execucaoHistorica());
    });
    const ref = doc(db('legada'), `users/legada/workoutExecutions/${EXEC}`);
    await assertFails(updateDoc(ref, { substitutionPolicySnapshot: 'legacy', updatedAt: serverTimestamp() }));
  });

  it('o questionario continua imutavel depois de criado', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'), questionario()));
    await assertFails(updateDoc(doc(db('legada'), 'users/legada/questionnaires/q1'), { version: 2 }));
  });
});

describe('as protecoes alheias a esta mudanca seguem de pe', () => {
  it('o marcador diario continua sendo escrito so pelo backend', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/inscrita/workoutDailyCompletions/2026-10-22'),
      { localDate: '2026-10-22', executionId: EXEC, programInstanceId: 'inst1', sessionIndex: 0, completedAt: serverTimestamp() }));
  });

  it('a evidencia nutricional da Chama continua sendo escrita so pelo backend', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/inscrita/streakNutritionDays/2026-10-22'),
      { activeItemCount: 1 }));
  });

  it('a inscricao no piloto nao pode ser criada nem alterada por cliente nenhum', async () => {
    await assertFails(setDoc(doc(db('legada'), 'workoutPilotEnrollment/legada'), { enabled: true }));
    await assertFails(updateDoc(doc(db('inscrita'), 'workoutPilotEnrollment/inscrita'), { enabled: false }));
  });

  it('ninguem escreve no questionario de outra conta', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/legada/questionnaires/q9'), questionario()));
  });
});

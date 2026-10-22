import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

/**
 * Convivência entre a versão do app que está NAS LOJAS e a versão nova.
 *
 * Este projeto não tem OTA (`expo-updates` não está instalado e `app.json`
 * não declara `updates`/`runtimeVersion`), então publicar o backend novo não
 * atualiza o binário de ninguém. Durante a janela entre a publicação e a
 * adoção, as duas versões gravam ao mesmo tempo — e as Rules são o único
 * ponto onde isso pode quebrar silenciosamente.
 *
 * O cliente ANTIGO ainda envia `limits`, `limitationImpact` e
 * `musculoskeletal_limitation` no questionário; o cliente NOVO os descarta na
 * fronteira de gravação. O que se prova aqui é que os dois concluem o
 * onboarding, que tolerar o legado não abre espaço livre, e que nada do que
 * a nova arquitetura fechou foi reaberto junto.
 */

let env: RulesTestEnvironment;
const db = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@ajfit.test`, email_verified: true }).firestore();

/** Questionário como o cliente NOVO grava: sem nenhum campo clínico. */
const novoCliente = (overrides: Record<string, unknown> = {}) => ({
  answers: {
    sex: 'male', goal: 'hypertrophy', level: 'intermediate',
    specialConditions: [], duration: 60, days: 5,
    ...overrides,
  },
  version: 1,
  createdAt: serverTimestamp(),
});

/** Questionário como o binário das lojas ainda grava. */
const clienteAntigo = (overrides: Record<string, unknown> = {}) => novoCliente({
  specialConditions: ['musculoskeletal_limitation'],
  limits: ['knee', 'shoulder'],
  limitationImpact: 'moderate',
  ...overrides,
});

const EXEC = 'exec_inst1_0_2026-10-21';

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
    // `inscrita` está no piloto; `legada` não. Idênticas em todo o resto, para
    // que qualquer diferença de resultado seja atribuível só à inscrição.
    for (const uid of ['inscrita', 'legada']) {
      await setDoc(doc(f, `users/${uid}`), {
        accountStatus: 'active',
        profile: { email: `${uid}@ajfit.test` },
      });
    }
    await setDoc(doc(f, 'workoutPilotEnrollment/inscrita'), { enabled: true });
  });
});

describe('o onboarding continua possível nas DUAS versões', () => {
  it('o cliente das lojas conclui o questionário com os campos clínicos legados', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'), clienteAntigo()));
  });

  it('o cliente novo conclui sem nenhum campo clínico', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q2'), novoCliente()));
  });

  it('uma conta do piloto também conclui nas duas formas', async () => {
    await assertSucceeds(setDoc(doc(db('inscrita'), 'users/inscrita/questionnaires/q1'), clienteAntigo()));
    await assertSucceeds(setDoc(doc(db('inscrita'), 'users/inscrita/questionnaires/q2'), novoCliente()));
  });

  it('aceita o legado parcial — só `limits`, ou só `limitationImpact`', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q3'),
      novoCliente({ limits: ['back'] })));
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q4'),
      novoCliente({ limitationImpact: 'severe' })));
  });

  it('aceita `none`, que é como o cliente antigo diz "sem limitação"', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q5'),
      novoCliente({ limits: ['none'] })));
  });
});

describe('tolerar o legado não vira depósito livre', () => {
  it('recusa uma região que nenhum cliente real emite', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      clienteAntigo({ limits: ['knee', 'pescoco_inventado'] })));
  });

  it('recusa `limits` acima do tamanho possível do questionário', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      clienteAntigo({ limits: ['knee','hip','back','shoulder','elbow','wrist','ankle_foot','other','none'] })));
  });

  it('recusa `limits` que não é lista', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      clienteAntigo({ limits: 'knee' })));
  });

  it('recusa `limitationImpact` que não é texto', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      clienteAntigo({ limitationImpact: { nivel: 'alto' } })));
  });

  it('continua recusando campos fora do contrato do documento', async () => {
    await assertFails(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'),
      { ...clienteAntigo(), contrabando: true }));
  });

  it('o questionário continua imutável depois de criado', async () => {
    await assertSucceeds(setDoc(doc(db('legada'), 'users/legada/questionnaires/q1'), clienteAntigo()));
    await assertFails(updateDoc(doc(db('legada'), 'users/legada/questionnaires/q1'), { version: 2 }));
  });

  it('ninguém lê nem escreve o questionário de outra conta', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/legada/questionnaires/q9'), clienteAntigo()));
  });
});

describe('a arquitetura clínica continua fechada', () => {
  it('nenhuma execução nova pode carregar o metadado de política V3', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/legada/workoutLifecycleState/current'),
        { activeProgramInstanceId: 'inst1' });
    });
    await assertFails(setDoc(doc(db('legada'), `users/legada/workoutExecutions/${EXEC}`), {
      programId: 'prog1', programInstanceId: 'inst1', templateId: 'T004', sessionIndex: 0,
      scheduledLocalDate: '2026-10-21', status: 'IN_PROGRESS', startedAt: serverTimestamp(),
      finishedAt: null, exercises: [], executionSchemaVersion: 2, createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(), mutexProtocolVersion: 1, cardio: null,
      substitutionPolicySnapshot: 'v3',
    }));
  });

  it('uma execução HISTÓRICA com o metadado continua editável, mas o valor não muda', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const f = context.firestore();
      await setDoc(doc(f, 'users/legada/workoutLifecycleState/current'), { activeProgramInstanceId: 'inst1' });
      await setDoc(doc(f, `users/legada/workoutExecutions/${EXEC}`), {
        programId: 'prog1', programInstanceId: 'inst1', templateId: 'T004', sessionIndex: 0,
        scheduledLocalDate: '2026-10-21', status: 'IN_PROGRESS', startedAt: Timestamp.now(),
        finishedAt: null, exercises: [], executionSchemaVersion: 2, createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(), mutexProtocolVersion: 1, cardio: null,
        substitutionPolicySnapshot: 'v3',
      });
    });
    const ref = doc(db('legada'), `users/legada/workoutExecutions/${EXEC}`);
    // Mexer no valor é recusado — é o que mantém o campo aposentado.
    await assertFails(updateDoc(ref, { substitutionPolicySnapshot: 'legacy', updatedAt: serverTimestamp() }));
  });
});

describe('as proteções que não têm nada a ver com esta transição seguem de pé', () => {
  it('o marcador diário continua sendo escrito só pelo backend', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/inscrita/workoutDailyCompletions/2026-10-21'),
      { localDate: '2026-10-21', executionId: EXEC, programInstanceId: 'inst1', sessionIndex: 0, completedAt: serverTimestamp() }));
  });

  it('a evidência nutricional da Chama continua sendo escrita só pelo backend', async () => {
    await assertFails(setDoc(doc(db('inscrita'), 'users/inscrita/streakNutritionDays/2026-10-21'),
      { activeItemCount: 1 }));
  });

  it('a inscrição no piloto não pode ser criada nem alterada por cliente nenhum', async () => {
    await assertFails(setDoc(doc(db('legada'), 'workoutPilotEnrollment/legada'), { enabled: true }));
    await assertFails(updateDoc(doc(db('inscrita'), 'workoutPilotEnrollment/inscrita'), { enabled: false }));
  });

  it('cada conta só enxerga a própria inscrição', async () => {
    const leitura = async (quem: string, dono: string) =>
      setDoc(doc(db(quem), `users/${dono}/questionnaires/x`), novoCliente());
    await assertFails(leitura('legada', 'inscrita'));
  });
});

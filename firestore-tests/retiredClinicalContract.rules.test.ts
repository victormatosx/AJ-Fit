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

/**
 * Os campos `limitationDatasetVersion`/`limitationDatasetHash` do contrato
 * clínico aposentado existem em 20 dos 21 programas reais. Recusá-los no
 * `hasOnly` do validador compartilhado tornaria qualquer update de um
 * documento histórico impossível — inclusive um supersede legítimo. Eles são
 * portanto TOLERADOS na leitura/atualização e recusados em tudo o mais.
 */
describe('programas historicos com os campos clinicos aposentados', () => {
  const UID = 'legada';

  const programaV2 = (programId: string) => ({
    programId, planId: 'wp_12345678', prescriptionId: 'wp_12345678',
    templateId: 'T003', templateVersion: 2, templateSourceVersion: '2.0.0',
    templateContentHash: 'a'.repeat(64), questionnaireId: 'q1',
    questionnaireVersion: 1, status: 'active', source: 'onboarding',
    requestedDays: 4, prescribedStructuredDays: 4, population: 'conventional',
    environment: 'gym', goalFamily: 'hypertrophy_body_composition', split: 'upper/lower',
    sessions: [{ name: 'A', type: 'strength', exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 3, reps: '8-12' }] }],
    versions: { templateLibrary: '2.0.0', selectionEngine: '1.0.0', safetyRules: '1.0.0',
      modifierRules: '2.0.0', compositionEngine: '2.1.0', limitationResolver: '1.0.0' },
    trace: { selectionReasons: [], safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] },
      appliedModifiers: [], unresolvedModifiers: [], conflicts: [], substitutions: [],
      compositionDecisions: [], validationCodes: [] },
    createdAt: Timestamp.now(), activatedAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });

  const CAMPOS = {
    limitationDatasetVersion: 'phase3-limitation-profiles-v2',
    limitationDatasetHash: 'a'.repeat(64),
  };

  /** Semeia o estado que existe hoje em produção: documento válido + os dois
   *  campos aposentados, com o ponteiro `active` apontando para outro. */
  async function semear(programId: string, extra: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled(async (context) => {
      const f = context.firestore();
      await setDoc(doc(f, 'workoutTemplates/T003'), {
        id: 'T003', version: 2, sourceVersion: '2.0.0', libraryId: 'reformed-v2',
        contentHash: 'a'.repeat(64), status: 'active',
        profile: { sex: 'male', environment: 'gym', primaryGoal: 'hypertrophy_body_composition', daysPerWeek: 4 },
        split: 'upper/lower', rationale: 'fixture',
        sessions: [{ name: 'A', type: 'strength', exercises: [{ exerciseId: 'squat', sets: 3, reps: '8-12' }] }],
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
      await setDoc(doc(f, `users/${UID}/questionnaires/q1`), {
        answers: { specialConditions: ['none'], level: 'intermediate' }, version: 1, createdAt: Timestamp.now(),
      });
      await setDoc(doc(f, `users/${UID}/workoutPrograms/${programId}`), { ...programaV2(programId), ...extra });
      await setDoc(doc(f, `users/${UID}/workoutProgramState/active`), { programId: 'outro', updatedAt: Timestamp.now() });
    });
  }

  const supersede = (programId: string, patch: Record<string, unknown> = {}) =>
    updateDoc(doc(db(UID), `users/${UID}/workoutPrograms/${programId}`),
      { status: 'superseded', updatedAt: serverTimestamp(), ...patch });

  it('ATUALIZA um programa historico preservando os campos (o caso dos 3 em producao)', async () => {
    await semear('wpg_hist2000', CAMPOS);
    await assertSucceeds(supersede('wpg_hist2000'));
  });

  it('o mesmo programa SEM os campos tambem atualiza — a tolerancia nao e uma exigencia', async () => {
    await semear('wpg_limpo200');
    await assertSucceeds(supersede('wpg_limpo200'));
  });

  it('os valores historicos sao IMUTAVEIS: alterar qualquer um deles e recusado', async () => {
    await semear('wpg_imut2000', CAMPOS);
    await assertFails(supersede('wpg_imut2000', { limitationDatasetVersion: 'outra-versao' }));
    await assertFails(supersede('wpg_imut2000', { limitationDatasetHash: 'b'.repeat(64) }));
  });

  it('nao se pode ACRESCENTAR os campos a um programa que nao os tinha', async () => {
    await semear('wpg_add20000');
    await assertFails(supersede('wpg_add20000', CAMPOS));
  });

  it('nao se pode REMOVER os campos de um programa historico', async () => {
    await semear('wpg_rem20000', CAMPOS);
    const { deleteField } = await import('firebase/firestore');
    await assertFails(supersede('wpg_rem20000', {
      limitationDatasetVersion: deleteField(), limitationDatasetHash: deleteField(),
    }));
  });

  it('um programa NOVO nao pode ser criado carregando os campos aposentados', async () => {
    await semear('wpg_base0000');
    const { runTransaction } = await import('firebase/firestore');
    const f = db(UID);
    await assertFails(runTransaction(f, async (tx) => {
      tx.set(doc(f, `users/${UID}/workoutPrograms/wpg_novo2000`),
        { ...programaV2('wpg_novo2000'), ...CAMPOS,
          createdAt: serverTimestamp(), activatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(f, `users/${UID}/workoutProgramState/active`), { programId: 'wpg_novo2000', updatedAt: serverTimestamp() });
    }));
  });

  it('a LEITURA de um programa historico nunca foi afetada', async () => {
    await semear('wpg_read2000', CAMPOS);
    await assertSucceeds(getDoc(doc(db(UID), `users/${UID}/workoutPrograms/wpg_read2000`)));
  });
});

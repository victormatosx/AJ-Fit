#!/usr/bin/env -S node --import tsx
/**
 * Seeds `exercises/{exerciseId}` — the official global exercise library
 * (docs/27_biblioteca_de_exercicios.md) — from `src/data/exercisesSeedData.ts`.
 *
 * SAFETY
 * ------
 * This repo has exactly ONE Firebase project configured (`.firebaserc`:
 * "production" → the real, live project). There is no staging/dev project.
 * Because of that:
 *
 *   - Default mode is DRY RUN. It validates the dataset, connects to
 *     Firestore, diffs against what's already there, and prints a plan —
 *     it never writes.
 *   - Real writes require the explicit `--confirm` flag. There is no
 *     "oops" path: running this file with no flags is always safe.
 *
 * CREDENTIALS
 * -----------
 * No service account key is read or expected in this repo (see
 * functions/src/lib/firebaseAdmin.ts for the same rule on the Cloud
 * Functions side). This script uses Application Default Credentials:
 * before running for real, authenticate once with
 *
 *   gcloud auth application-default login
 *
 * using an account that has Firestore write access on the target project.
 *
 * USAGE
 * -----
 *   npm run seed:exercises                    # dry run (default)
 *   npm run seed:exercises -- --dry-run        # same, explicit
 *   npm run seed:exercises -- --confirm        # real write
 *   npm run seed:exercises -- --confirm --project some-other-id
 *
 * IDEMPOTENCY
 * -----------
 * Each exercise's `id` is used as the Firestore document id (never a
 * random id — docs/27 §2). Re-running is safe: existing documents are
 * updated in place (their `metadata.createdAt` and `metadata.version` are
 * preserved), missing documents are created. No document is ever deleted
 * by this script — exercises are retired via `status`/`availability`, not
 * removal (docs/27 §8).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import { validateExerciseSeed } from '../src/validators/exerciseValidation';

const EXPECTED_TOTAL = 79;
const COLLECTION = 'exercises';
const BATCH_SIZE = 400; // Firestore hard limit is 500 writes/batch.

function parseArgs(argv: string[]) {
  const confirm = argv.includes('--confirm');
  const projectFlagIndex = argv.indexOf('--project');
  const projectOverride = projectFlagIndex >= 0 ? argv[projectFlagIndex + 1] : undefined;
  return { confirm, projectOverride };
}

function resolveDefaultProjectId(): string {
  const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const firebaserc = JSON.parse(readFileSync(join(repoRoot, '.firebaserc'), 'utf8')) as {
    projects?: Record<string, string>;
  };
  const projectId = firebaserc.projects?.production;
  if (!projectId) {
    throw new Error('.firebaserc não define projects.production — não sei para qual projeto apontar.');
  }
  return projectId;
}

async function main() {
  const { confirm, projectOverride } = parseArgs(process.argv.slice(2));
  const projectId = projectOverride ?? resolveDefaultProjectId();

  console.log('='.repeat(70));
  console.log('SEED: exercises (biblioteca oficial de exercícios)');
  console.log('='.repeat(70));
  console.log(`Projeto alvo: ${projectId} (único projeto configurado em .firebaserc — produção)`);
  console.log(`Modo: ${confirm ? 'ESCRITA REAL (--confirm)' : 'DRY RUN (padrão — nenhuma escrita será feita)'}`);
  console.log('');

  // 1. Validate the dataset before touching the network at all.
  console.log(`Exercícios no dataset: ${EXERCISES_SEED.length} (esperado: ${EXPECTED_TOTAL})`);
  if (EXERCISES_SEED.length !== EXPECTED_TOTAL) {
    console.error(`ERRO: dataset tem ${EXERCISES_SEED.length} exercícios, esperado exatamente ${EXPECTED_TOTAL}.`);
    process.exit(1);
  }

  const validation = validateExerciseSeed(EXERCISES_SEED);
  if (!validation.valid) {
    console.error(`\nERRO: ${validation.errors.length} problema(s) de validação encontrados:\n`);
    validation.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('Validação: OK (ids/slugs/nomes únicos, enums válidos, referências consistentes)\n');

  // 2. Connect and diff against what's already there.
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  const db = getFirestore();

  const existingSnapshot = await db.collection(COLLECTION).get();
  const existingById = new Map(existingSnapshot.docs.map((d) => [d.id, d.data()]));

  const toCreate = EXERCISES_SEED.filter((e) => !existingById.has(e.id));
  const toUpdate = EXERCISES_SEED.filter((e) => existingById.has(e.id));

  console.log(`Documentos existentes na collection "${COLLECTION}": ${existingSnapshot.size}`);
  console.log(`Planejado: ${toCreate.length} criação(ões), ${toUpdate.length} atualização(ões), 0 remoção(ões)`);
  console.log('(este script nunca deleta documentos — desativação é feita via status/availability)\n');

  if (!confirm) {
    console.log('DRY RUN — nenhuma escrita foi realizada. Rode novamente com --confirm para aplicar.');
    return;
  }

  // 3. Real write, batched, preserving createdAt/version on updates.
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < EXERCISES_SEED.length; i += BATCH_SIZE) {
    const chunk = EXERCISES_SEED.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const exercise of chunk) {
      const ref = db.collection(COLLECTION).doc(exercise.id);
      const existing = existingById.get(exercise.id) as { metadata?: { version?: number } } | undefined;
      const { id: _id, ...body } = exercise;

      if (existing) {
        batch.set(
          ref,
          {
            ...body,
            metadata: {
              version: existing.metadata?.version ?? 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        );
        updated += 1;
      } else {
        batch.set(ref, {
          ...body,
          metadata: {
            version: 1,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
        created += 1;
      }
    }

    try {
      await batch.commit();
    } catch (err) {
      failed += chunk.length;
      created -= chunk.filter((e) => !existingById.has(e.id)).length;
      updated -= chunk.filter((e) => existingById.has(e.id)).length;
      console.error(`ERRO ao commitar lote [${i}, ${i + chunk.length}):`, err);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTADO');
  console.log('='.repeat(70));
  console.log(`esperados: ${EXPECTED_TOTAL}`);
  console.log(`validados: ${EXERCISES_SEED.length}`);
  console.log(`criados: ${created}`);
  console.log(`atualizados: ${updated}`);
  console.log(`ignorados: 0`);
  console.log(`falharam: ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Falha ao executar o seed:', err);
  process.exit(1);
});

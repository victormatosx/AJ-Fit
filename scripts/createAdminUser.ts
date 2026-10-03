#!/usr/bin/env -S node --import tsx
/**
 * Creates `users/{uid}` for a Firebase Auth user that exists ONLY to access
 * the admin panel — not a real athlete account. Writes `metadata.role:
 * 'admin'` directly via the Admin SDK, which is the only way to do so
 * (firestore.rules forbids the client from ever writing role: 'admin').
 *
 * SAFETY
 * ------
 * This repo has exactly ONE Firebase project configured (`.firebaserc`:
 * "production" → the real, live project). There is no staging/dev project.
 * Default mode is DRY RUN — it prints the document it would write and never
 * touches Firestore. Real writes require the explicit `--confirm` flag.
 *
 * CREDENTIALS
 * -----------
 * No service account key is read or expected in this repo. This script uses
 * Application Default Credentials: before running for real, authenticate
 * once with
 *
 *   gcloud auth application-default login
 *
 * using an account that has Firestore write access on the target project.
 *
 * USAGE
 * -----
 *   npx tsx scripts/createAdminUser.ts <uid> <name>                # dry run
 *   npx tsx scripts/createAdminUser.ts <uid> <name> --confirm       # real write
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const COLLECTION = 'users';

function parseArgs(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const confirm = argv.includes('--confirm');
  const [uid, name] = positional;
  return { uid, name, confirm };
}

async function main() {
  const { uid, name, confirm } = parseArgs(process.argv.slice(2));

  if (!uid || !name) {
    console.error('Usage: createAdminUser.ts <uid> <name> [--confirm]');
    process.exitCode = 1;
    return;
  }

  const projectId = 'ajfit-2f321';

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  const db = getFirestore();

  const docData = {
    profile: {
      name,
      email: '',
    },
    preferences: {
      language: 'pt-BR',
      units: 'system',
      theme: 'dark',
    },
    subscription: {},
    metadata: {
      role: 'admin',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  };

  console.log(`Project: ${projectId}`);
  console.log(`Collection: ${COLLECTION}/${uid}`);
  console.log('Document to write:');
  console.log(JSON.stringify(docData, null, 2));

  if (!confirm) {
    console.log('\nDry run only — no write performed. Re-run with --confirm to write.');
    return;
  }

  const ref = db.collection(COLLECTION).doc(uid);
  const existing = await ref.get();
  if (existing.exists) {
    console.error(`\nAborting: users/${uid} already exists. Refusing to overwrite.`);
    process.exitCode = 1;
    return;
  }

  await ref.set(docData);
  console.log(`\nCreated users/${uid} with metadata.role = 'admin'.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node

const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const projectId = valueAfter('--project');
  const readOnly = process.argv.includes('--read');
  const turnOff = process.argv.includes('--off');
  const rawPercentage = valueAfter('--set');
  const apply = process.argv.includes('--apply');
  if (!projectId || (!readOnly && !turnOff && rawPercentage === undefined)) {
    throw new Error('Usage: --project <id> (--read | --off | --set <0..100>) [--apply]');
  }
  const percentage = turnOff ? 0 : Number(rawPercentage);
  if (!readOnly && (!Number.isInteger(percentage) || percentage < 0 || percentage > 100)) {
    throw new Error('Rollout percentage must be an integer from 0 through 100.');
  }
  initializeApp({ credential: applicationDefault(), projectId });
  const ref = getFirestore().doc('workoutLifecycleRolloutConfig/active');
  if (readOnly) {
    const snapshot = await ref.get();
    console.log(JSON.stringify({ projectId, exists: snapshot.exists, config: snapshot.data() ?? null }, null, 2));
    return;
  }
  const config = { schemaVersion: 1, enabled: !turnOff, percentage };
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, projectId, path: ref.path, config }, null, 2));
    return;
  }
  await ref.set(config);
  console.log(JSON.stringify({ applied: true, projectId, path: ref.path, config }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

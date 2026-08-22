#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const REQUIRED_ROLE = 'roles/firebaserules.firestoreServiceAgent';

function requestedProject() {
  const flagIndex = process.argv.indexOf('--project');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  const firebaserc = JSON.parse(readFileSync(join(process.cwd(), '.firebaserc'), 'utf8'));
  return firebaserc.projects?.production;
}

async function main() {
  const projectId = requestedProject();
  if (!projectId) throw new Error('Informe --project ou configure projects.production em .firebaserc.');

  const globalModules = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  const firebaseLib = join(globalModules, 'firebase-tools', 'lib');
  const { configstore } = require(join(firebaseLib, 'configstore'));
  const auth = require(join(firebaseLib, 'auth'));
  const { getProjectNumber } = require(join(firebaseLib, 'getProjectNumber'));
  const { serviceAccountHasRoles } = require(join(firebaseLib, 'gcp', 'resourceManager'));

  const refreshToken = configstore.get('tokens')?.refresh_token;
  if (!refreshToken) throw new Error('Faça login no Firebase CLI antes de executar este check.');
  auth.setRefreshToken(refreshToken);

  const projectNumber = await getProjectNumber({ project: projectId });
  const serviceAccount = `service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
  const hasRole = await serviceAccountHasRoles(projectNumber, serviceAccount, [REQUIRED_ROLE], true);

  if (!hasRole) {
    throw new Error(
      `O service agent ${serviceAccount} não possui ${REQUIRED_ROLE}; ` +
      'leituras Firestore feitas pelas Storage Rules falharão fechadas em produção.',
    );
  }

  console.log(`OK: ${projectId} possui o vínculo IAM exigido pelas Storage Rules cross-service.`);
}

main().catch((error) => {
  console.error(`ERRO: ${error.message}`);
  process.exitCode = 1;
});

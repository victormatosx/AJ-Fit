#!/usr/bin/env node

const { readFileSync } = require('node:fs');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const functionsPkg = JSON.parse(readFileSync('functions/package.json', 'utf8'));
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

requireCondition(readFileSync('.nvmrc', 'utf8').trim() === '20', 'root .nvmrc must be Node 20');
requireCondition(functionsPkg.engines?.node === '22', 'Functions engine must be Node 22');
requireCondition(pkg.devDependencies?.['firebase-tools'] === '15.26.0', 'firebase-tools must be exactly 15.26.0');
requireCondition(!workflow.includes('continue-on-error'), 'critical CI cannot use continue-on-error');
requireCondition(!workflow.includes('npm install -g firebase-tools'), 'CI must use the repo-pinned Firebase CLI');
requireCondition(workflow.includes("node-version: '22'"), 'Functions CI must select Node 22');
requireCondition(workflow.includes("java-version: '21'"), 'emulator CI must select Java 21');
requireCondition(workflow.includes("grep -Fx '15.26.0'"), 'CI must assert the exact Firebase CLI version');

for (const command of [
  'npm run quality:static', 'npm run test', 'npm run test:rules', 'npm run test:integration',
  'npm run typecheck', 'npm run build',
  'test:integration:lifecycleAuthority',
  'test:integration:firestoreCleanup', 'test:integration:storageCleanup',
  'test:integration:retainedData', 'test:integration:authDeletion',
  'test:integration:vaultKeyDestruction', 'test:integration:backendAutonomy',
  'test:integration:faultInjection', 'test:integration:accountDeletionReconciliation',
  'test:integration:commercialGate',
]) {
  requireCondition(workflow.includes(command), `CI is missing critical command: ${command}`);
}

if (failures.length) {
  console.error(['CI audit failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'));
  process.exit(1);
}
console.log('CI audit OK: Node, Java, Firebase pin, gates, opt-in suites, and failure policy are explicit.');

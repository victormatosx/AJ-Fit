#!/usr/bin/env node

// Fase 6 preflight (docs architecture/12_PHASE_6_IMPLEMENTATION.md "Emulator
// Infrastructure") — Firebase Emulator's Firestore/Storage Rules engine
// requires JDK 21+; this repo's default `java` may still resolve to an
// older JDK (commonly 17) on a developer machine. Rather than silently fail
// deep inside `firebase emulators:exec` with an unhelpful Java error, this
// fails fast with an actionable message. Never modifies the machine's
// global Java configuration — `JAVA_HOME` for emulator commands stays scoped
// to the npm script invocation (see package.json), same as every
// emulator-backed command run manually in this project's history.

const { execSync } = require('node:child_process');

const MIN_MAJOR_VERSION = 21;
const REQUIRED_NODE_MAJOR = 20;
const REQUIRED_FIREBASE_VERSION = '15.26.0';

function resolveJavaVersion() {
  try {
    // `java -version` writes to stderr, not stdout, on every JDK vendor —
    // `2>&1` merges it into the captured stream regardless of exit code.
    return execSync('java -version 2>&1', { encoding: 'utf8' });
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && error.stdout) {
      return String(error.stdout);
    }
    return null;
  }
}

function parseMajorVersion(versionOutput) {
  // Matches both legacy `1.8.0_x` and modern `21.0.x` / `21-ea` formats.
  const match = versionOutput.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const first = Number(match[1]);
  if (first === 1 && match[2]) return Number(match[2]); // "1.8" -> 8
  return first;
}

function main() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor !== REQUIRED_NODE_MAJOR) {
    console.error(`PREFLIGHT FAILED: root tooling requires Node ${REQUIRED_NODE_MAJOR}.x; detected ${process.versions.node}.`);
    process.exit(1);
  }

  let firebaseVersion = null;
  try {
    const firebaseOutput = execSync('firebase --version', { encoding: 'utf8' });
    // Firebase CLI emits diagnostic banners when DEBUG is inherited from an
    // editor/agent process. Select the standalone semver line instead of
    // treating unrelated diagnostics as the version string.
    firebaseVersion = firebaseOutput.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^\d+\.\d+\.\d+$/.test(line)) ?? null;
  } catch {
    // The executable must come from this repository's node_modules/.bin via npm scripts.
  }
  if (firebaseVersion !== REQUIRED_FIREBASE_VERSION) {
    console.error(`PREFLIGHT FAILED: expected Firebase CLI ${REQUIRED_FIREBASE_VERSION}; detected ${firebaseVersion ?? 'missing'}. Run npm ci.`);
    process.exit(1);
  }

  const output = resolveJavaVersion();
  if (!output) {
    console.error(
      [
        '',
        'PREFLIGHT FAILED: `java` was not found on PATH.',
        '',
        `Firebase Emulator (Firestore/Storage Rules, all *.integration.test.ts suites) requires JDK ${MIN_MAJOR_VERSION}+.`,
        '',
        'Install one (this repo has been developed against Homebrew\'s openjdk@21) and run',
        'emulator-backed commands with it explicitly scoped, e.g.:',
        '',
        '  JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:rules',
        '',
        'This never changes your machine\'s default/global `java` — only the one command.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const major = parseMajorVersion(output);
  if (major === null || major < MIN_MAJOR_VERSION) {
    console.error(
      [
        '',
        `PREFLIGHT FAILED: detected Java major version ${major ?? 'unknown'}, but Firebase Emulator needs JDK ${MIN_MAJOR_VERSION}+.`,
        '',
        'Raw `java -version` output:',
        output.trim(),
        '',
        'Run this emulator-backed command with JDK 21 explicitly scoped, e.g.:',
        '',
        '  JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:rules',
        '',
        'This never changes your machine\'s default/global `java` — only the one command.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log(`Toolchain preflight OK (Node ${process.versions.node}, Firebase ${firebaseVersion}, Java ${major}).`);
}

main();

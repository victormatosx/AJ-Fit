import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Support V1 (the removed ticket collection, "support" + "Tickets") was
 * fully removed from the AJ Fit app and Functions (see
 * docs/25_exclusao_de_conta_arquitetura.md). Only Support V2
 * (`supportCases`/`supportUploadSessions`/`supportRateLimits`) remains. This
 * guard fails loudly — with a specific offending path — instead of letting a
 * copy-paste or a merge silently resurrect the removed collection.
 *
 * This file deliberately never spells the removed name as a literal string
 * (always `['support', 'Tickets'].join('')`) so it does not trip its own
 * scan below.
 *
 * `ajfit-admin` is a separate repository (not checked out alongside this
 * one in every environment) and is audited manually, not by this guard.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const SCAN_ROOTS = ['src', 'functions/src', 'scripts'];
const NEEDLE = ['support', 'Tickets'].join('');
const SELF_PATH = resolve(__filename);

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'lib') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:[cm]?js|tsx?)$/.test(entry.name) ? [path] : [];
  });
}

describe('Support V1 removal — repository-wide guard', () => {
  it('never references the removed ticket collection in app/Functions/scripts source', () => {
    const offenders = SCAN_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
      .filter((path) => resolve(path) !== SELF_PATH)
      .filter((path) => readFileSync(path, 'utf8').includes(NEEDLE))
      .map((path) => relative(REPO_ROOT, path).replaceAll('\\', '/'));

    expect(offenders).toEqual([]);
  });

  it('never re-declares the removed collection in Firestore Rules, Storage Rules or indexes', () => {
    const targets = ['firestore.rules', 'storage.rules', 'firestore.indexes.json'];
    const offenders = targets.filter((name) => readFileSync(join(REPO_ROOT, name), 'utf8').includes(NEEDLE));

    expect(offenders).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPPORTED_LANGUAGES } from '../../types/language';
import {
  DEFAULT_UNITS_PREFERENCE,
  UNITS_PREFERENCES,
} from '../../types/units';

/**
 * Structural contract between TS and firestore.rules.
 *
 * The rules are validated for real behavior in
 * `firestore-tests/preferences.rules.test.ts` (requires the Firestore
 * emulator + @firebase/rules-unit-testing). This file is the always-on
 * safety net that runs in every Vitest execution: if someone edits either
 * SUPPORTED_LANGUAGES or firestore.rules without keeping them in sync, the
 * suite fails immediately instead of drifting silently until QA.
 */
const RULES = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');

describe('firestore.rules — structural contract', () => {
  it('accepts exactly the languages listed in SUPPORTED_LANGUAGES', () => {
    // The rules line looks like: && data.language in ['pt-BR', 'en', 'es']
    const match = RULES.match(/data\.language in \[([^\]]+)\]/);
    expect(match, 'preferencesValid does not check data.language').not.toBeNull();

    const quoted = match![1].match(/'([^']+)'/g) ?? [];
    const languagesInRules = quoted.map((s) => s.slice(1, -1)).sort();
    const languagesInTs = [...SUPPORTED_LANGUAGES].sort();

    expect(languagesInRules).toEqual(languagesInTs);
  });

  it('accepts exactly the units listed in UNITS_PREFERENCES', () => {
    const match = RULES.match(/data\.units in \[([^\]]+)\]/);
    expect(match, 'preferencesValid does not check data.units').not.toBeNull();

    const quoted = match![1].match(/'([^']+)'/g) ?? [];
    const unitsInRules = quoted.map((value) => value.slice(1, -1)).sort();
    expect(unitsInRules).toEqual([...UNITS_PREFERENCES].sort());
  });

  it('keeps the account and legacy-migration default on system', () => {
    expect(DEFAULT_UNITS_PREFERENCE).toBe('system');
    expect(RULES).toMatch(/after\.preferences\.units == 'system'/);

    const repository = readFileSync(
      resolve(__dirname, '../../services/userProfile.ts'),
      'utf8',
    );
    expect(repository.match(/units:\s*DEFAULT_UNITS_PREFERENCE/g)).toHaveLength(2);
  });

  it('lists preferences among the top-level updatable keys', () => {
    expect(RULES).toMatch(
      /affectedKeys\(\)\s*\.hasOnly\(\[\s*'profile'\s*,\s*'preferences'\s*,\s*'metadata'\s*\]\)/,
    );
  });

  it('restricts preferences inner diff to language and units', () => {
    expect(RULES).toMatch(
      /preferences\.diff\(resource\.data\.preferences\)\.affectedKeys\(\)\s*\.hasOnly\(\[\s*'language'\s*,\s*'units'\s*\]\)/,
    );
  });

  it('still requires the full preferences shape (guards against incomplete maps)', () => {
    expect(RULES).toMatch(
      /data\.keys\(\)\.hasAll\(\[\s*'language'\s*,\s*'units'\s*,\s*'theme'\s*\]\)/,
    );
    expect(RULES).toMatch(
      /data\.keys\(\)\.hasOnly\(\[\s*'language'\s*,\s*'units'\s*,\s*'theme'\s*\]\)/,
    );
  });

  it('still restricts profile mutable subkeys to name/birthDate/photoURL/photoVersion', () => {
    expect(RULES).toMatch(
      /profile\.diff\(resource\.data\.profile\)\.affectedKeys\(\)\s*\.hasOnly\(\[\s*'name'\s*,\s*'birthDate'\s*,\s*'photoURL'\s*,\s*'photoVersion'\s*\]\)/,
    );
  });

  it('still restricts metadata mutable subkeys to updatedAt', () => {
    expect(RULES).toMatch(
      /metadata\.diff\(resource\.data\.metadata\)\.affectedKeys\(\)\s*\.hasOnly\(\[\s*'updatedAt'\s*\]\)/,
    );
  });

  it('preserves the legacy migration branch', () => {
    expect(RULES).toMatch(/function legacyMigrationValid\(\)/);
    expect(RULES).toMatch(/legacyMigrationValid\(\)/);
  });
});

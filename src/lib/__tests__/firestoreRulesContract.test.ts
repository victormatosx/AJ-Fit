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
const INDEXES = JSON.parse(
  readFileSync(resolve(__dirname, '../../../firestore.indexes.json'), 'utf8'),
) as {
  indexes: Array<{
    collectionGroup: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }>;
};

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

  it('restricts preferences inner diff to language, units and notification preferences', () => {
    expect(RULES).toMatch(
      /preferences\.diff\(resource\.data\.preferences\)\.affectedKeys\(\)\s*\.hasOnly\(\[\s*'language'\s*,\s*'units'\s*,\s*'notificationPreferences'\s*\]\)/,
    );
  });

  it('still requires the full preferences shape (guards against incomplete maps)', () => {
    expect(RULES).toMatch(
      /data\.keys\(\)\.hasAll\(\[\s*'language'\s*,\s*'units'\s*,\s*'theme'\s*\]\)/,
    );
    expect(RULES).toMatch(
      /data\.keys\(\)\.hasOnly\(\[\s*'language'\s*,\s*'units'\s*,\s*'theme'\s*,\s*'notificationPreferences'\s*\]\)/,
    );
  });

  it('still restricts profile mutable subkeys to name/birthDate/photoURL/photoVersion/height', () => {
    expect(RULES).toMatch(
      /profile\.diff\(resource\.data\.profile\)\.affectedKeys\(\)\s*\.hasOnly\(\[\s*'name'\s*,\s*'birthDate'\s*,\s*'photoURL'\s*,\s*'photoVersion'\s*,\s*'height'\s*\]\)/,
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

  it('accepts provisioned admin documents without allowing client promotion', () => {
    expect(RULES).toMatch(/data\.role in \['user', 'admin'\]/);
    expect(RULES).toMatch(/allow create:[\s\S]*metadata\.role == 'user'/);
    expect(RULES).toMatch(
      /metadata\.diff\(resource\.data\.metadata\)\.affectedKeys\(\)\s*\.hasOnly\(\['updatedAt'\]\)/,
    );
  });

  it('keeps only the nine mergeable support-ticket indexes used by the panel', () => {
    const signatures = INDEXES.indexes
      .filter((index) => index.collectionGroup === 'supportTickets')
      .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','))
      .sort();
    const expected = ['status', 'type', 'priority'].flatMap((filter) => [
      `${filter}:ASCENDING,updatedAt:DESCENDING`,
      `${filter}:ASCENDING,createdAt:DESCENDING`,
      `${filter}:ASCENDING,createdAt:ASCENDING`,
    ]).sort();
    expect(signatures).toEqual(expected);
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});

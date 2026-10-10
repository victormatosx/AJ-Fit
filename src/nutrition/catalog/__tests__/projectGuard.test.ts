import { describe, expect, it } from 'vitest';
import { assertNotProductionProject } from '../projectGuard';

const rc = JSON.stringify({ projects: { production: 'ajfit-2f321' } });

describe('assertNotProductionProject', () => {
  it('throws when the target project matches the .firebaserc production alias', () => {
    expect(() => assertNotProductionProject('ajfit-2f321', rc)).toThrow(/REFUSING_PRODUCTION_PROJECT/);
  });

  it('allows a project id that differs from the production alias', () => {
    expect(() => assertNotProductionProject('ajfit-test-env', rc)).not.toThrow();
  });

  it('allows any project when .firebaserc has no production alias configured', () => {
    expect(() => assertNotProductionProject('anything', JSON.stringify({ projects: {} }))).not.toThrow();
  });

  it('allows the production-aliased project ONLY with the matching explicit override', () => {
    expect(() => assertNotProductionProject('ajfit-2f321', rc, 'ajfit-2f321')).not.toThrow();
  });

  it('rejects the override if it names a different project than --project', () => {
    expect(() => assertNotProductionProject('ajfit-2f321', rc, 'some-other-project')).toThrow(/REFUSING_PRODUCTION_PROJECT/);
  });
});

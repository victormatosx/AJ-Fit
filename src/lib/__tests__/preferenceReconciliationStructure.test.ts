import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

describe('account preference reconciliation', () => {
  it('waits for an existing profile before reading remote preferences', () => {
    const guard =
      'if (initializing || profileLoading || !wasLoading || !user || !profile) return;';
    const guardPosition = app.indexOf(guard);
    const languageReconciliationPosition = app.indexOf('reconcileLanguageOnLoad({');
    const unitsReconciliationPosition = app.indexOf('reconcileUnitsOnLoad({');

    expect(guardPosition).toBeGreaterThan(-1);
    expect(languageReconciliationPosition).toBeGreaterThan(guardPosition);
    expect(unitsReconciliationPosition).toBeGreaterThan(guardPosition);
    expect(app).toContain('remoteLanguage: profile.preferences.language');
    expect(app).toContain('remoteUnits: profile.preferences.units');
  });
});

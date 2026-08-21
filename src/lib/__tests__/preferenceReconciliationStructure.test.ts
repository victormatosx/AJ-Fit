import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

describe('account preference reconciliation', () => {
  it('waits for an existing profile before reading remote preferences, and gates on the synchronous needsPreferencesReconciliation derivation — not a useEffect-lagged useState', () => {
    // Root-cause fix: `preferencesReconciling` must be computed synchronously
    // during render (via `needsPreferencesReconciliation`), not flipped to
    // `true` from inside a `useEffect` — a `useEffect` runs only after the
    // render that already opened the gate has committed/painted, which was
    // the exact mechanism behind the reported `app → unresolved → app`
    // flicker. See `src/lib/preferencesReconciliation.ts`.
    expect(app).toContain('needsPreferencesReconciliation({');
    expect(app).not.toContain('setPreferencesReconciling');

    const guard =
      'if (emailVerificationRequired || !preferencesReconciling || !user || !profile) return;';
    const guardPosition = app.indexOf(guard);
    const languageReconciliationPosition = app.indexOf('reconcileLanguageOnLoad({');
    const unitsReconciliationPosition = app.indexOf('reconcileUnitsOnLoad({');

    expect(guardPosition).toBeGreaterThan(-1);
    expect(languageReconciliationPosition).toBeGreaterThan(guardPosition);
    expect(unitsReconciliationPosition).toBeGreaterThan(guardPosition);
    expect(app).toContain('remoteLanguage: profile.preferences.language');
    expect(app).toContain('remoteUnits: profile.preferences.units');
    expect(app).toContain('[emailVerificationRequired, preferencesReconciling, user, profile]');
  });
});

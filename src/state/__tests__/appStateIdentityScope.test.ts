import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appRoot = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const appState = readFileSync(new URL('../AppState.tsx', import.meta.url), 'utf8');

describe('AppState quiz identity scoping (regression: account A -> account B leak)', () => {
  it('App.tsx binds AppStateProvider to the authenticated uid, not the bare provider', () => {
    expect(appRoot).toContain('<RawAppStateProvider uid={user?.uid ?? null}>');
    expect(appRoot).not.toContain('<AppStateProvider>');
  });

  it('AppStateProvider resets quiz through the pure nextValueForIdentity decision on every uid transition', () => {
    expect(appState).toContain('nextValueForIdentity(lastUidRef.current, uid, quiz, defaultQuiz)');
  });

  it('never gates the reset behind an effect (no async window where a stale quiz can be read)', () => {
    const providerBody = appState.slice(
      appState.indexOf('export function AppStateProvider'),
      appState.indexOf('export function useAppState'),
    );
    expect(providerBody).not.toContain('useEffect');
  });

  it('AppState.tsx stays free of Firebase/AuthContext imports (pure state logic, per vitest.config.mts)', () => {
    expect(appState).not.toContain("from './AuthContext'");
    expect(appState).not.toContain('firebase');
  });
});

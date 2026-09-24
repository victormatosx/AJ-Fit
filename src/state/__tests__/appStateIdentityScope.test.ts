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

  it('(26) preparedWorkoutProgram (Phase 3) resets through the exact same identity-transition mechanism as quiz — logout/login never carries a stale prepared result into the wrong account', () => {
    expect(appState).toContain('nextValueForIdentity(lastUidRef.current, uid, preparedWorkoutProgram, null)');
    expect(appState).toContain('const [preparedWorkoutProgram, setPreparedWorkoutProgram] = useState');
  });

  it('tab resets to home through the exact same identity-transition mechanism as quiz — logout/login never reopens the tab (e.g. profile/settings) the previous identity was on', () => {
    expect(appState).toContain("nextValueForIdentity(lastUidRef.current, uid, tab, 'home')");
    expect(appState).toContain("const [tab, setTab] = useState<TabId>('home')");
  });
});

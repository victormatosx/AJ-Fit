import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filledProgramProgressSegments } from '../../home/programProgress';

const read = (path: string) => readFileSync(path, 'utf8');
const hook = read('src/workoutEvolution/useWorkoutEvolution.ts');
const perf = read('src/lib/perf.ts');
const home = read('src/screens/HomeScreen.tsx');
const strip = read('src/components/home/ProgramProgressStrip.tsx');
const card = read('src/components/evolution/EvolutionCard.tsx');

/**
 * Fase 5.2 — progressive rendering. Mirrors this codebase's existing
 * structural-fallback style (`uxStructure.test.ts`,
 * `useWorkoutEvolutionParallelFetch.test.ts`) for the RN orchestration/UI
 * layer, where a real component-render harness isn't set up. Domain
 * correctness for `SUMMARY_READY` itself is covered by `viewModel.test.ts`
 * and `loadReducer.test.ts` (pure functions, real assertions).
 */
describe('useWorkoutEvolution — provisional SUMMARY_READY commit ordering', () => {
  it('commits the provisional summary only after lifecycle+pending+decision are known, before the events/notice tail', () => {
    const promiseAllIndex = hook.indexOf('const [lifecycle, pendingAfter, decision] = await Promise.all(');
    const provisionalCommitIndex = hook.indexOf('buildProvisionalEvolutionViewModel(');
    const eventsIndex = hook.indexOf('listWorkoutLifecycleEventsForProgramInstance(');
    expect(promiseAllIndex).toBeGreaterThan(-1);
    expect(provisionalCommitIndex).toBeGreaterThan(promiseAllIndex);
    expect(provisionalCommitIndex).toBeLessThan(eventsIndex);
  });

  it('gates the provisional commit behind the same isCurrent() race guard as every other commit', () => {
    expect(hook).toMatch(/if \(isCurrent\(\)\s*&&\s*isInitialLoad\)\s*{\s*commitViewModel\(buildProvisionalEvolutionViewModel\(/);
  });

  it('only reveals the provisional summary on a genuine first load — a background refresh never downgrades an already-resolved view model', () => {
    const isInitialLoadIndex = hook.indexOf('const isInitialLoad = !hasLoadedOnce.current;');
    expect(isInitialLoadIndex).toBeGreaterThan(-1);
    expect(isInitialLoadIndex).toBeLessThan(hook.indexOf('buildProvisionalEvolutionViewModel('));
  });

  it('records evolution_first_useful_content only at the provisional commit, and evolution_authoritative_ready at every terminal commit', () => {
    const provisionalBlock = hook.slice(hook.indexOf('buildProvisionalEvolutionViewModel('), hook.indexOf('buildProvisionalEvolutionViewModel(') + 200);
    expect(provisionalBlock).toContain("recordPerfMark('evolution_first_useful_content')");
    // Only successful authoritative outcomes mark readiness: the early
    // UNAVAILABLE return and the main success path. A catch/error (including
    // offline with cache visible) must never claim authoritative readiness.
    expect(hook.match(/recordPerfMark\('evolution_authoritative_ready'\)/g)?.length).toBe(2);
    // evolution_state_commit must keep firing exactly as before — this mark is additive, not a silent rename (Fase 5.1/5.2 instrumentation rule).
    expect(hook.match(/recordPerfMark\('evolution_state_commit'\)/g)?.length).toBe(3);
  });
});

describe('perf.ts — new Fase 5.2 marks', () => {
  it('declares the three new progressive-rendering marks without touching existing ones', () => {
    for (const mark of ['evolution_shell_visible', 'evolution_first_useful_content', 'evolution_authoritative_ready']) {
      expect(perf).toContain(`'${mark}'`);
    }
    // Every mark from before this phase must still be declared, verbatim.
    for (const preexisting of ['home_evolution_ready', 'evolution_reconcile_ready', 'evolution_state_commit']) {
      expect(perf).toContain(`'${preexisting}'`);
    }
  });
});

describe('HomeScreen — home_evolution_ready keeps its original meaning', () => {
  it('does not fire home_evolution_ready for the new intermediate SUMMARY_READY kind (Passo 10: no silent metric redefinition)', () => {
    expect(home).toContain("evolutionViewModel.kind !== 'LOADING' && evolutionViewModel.kind !== 'SUMMARY_READY'");
    expect(home).toContain("evolutionViewModel.kind !== 'ERROR'");
  });

  it('records evolution_shell_visible once, at Home mount — the Evolution area shell is always in the tree from first paint', () => {
    expect(home).toContain("recordPerfMark('evolution_shell_visible')");
  });
});

describe('ProgramProgressStrip — SUMMARY_READY rendering', () => {
  it('renders (not null) for SUMMARY_READY — only LOADING keeps its own skeleton branch, UNAVAILABLE/ERROR stay hidden', () => {
    expect(strip).not.toMatch(/viewModel\.kind === 'LOADING'\s*\|\|\s*viewModel\.kind === 'UNAVAILABLE'\s*\|\|\s*viewModel\.kind === 'ERROR'\)\s*return null;/);
    expect(strip).toContain("viewModel.kind === 'UNAVAILABLE' || viewModel.kind === 'ERROR') return null;");
  });

  it('never marks SUMMARY_READY as actionable — the CTA/chevron whitelist is unchanged', () => {
    const isActionableLine = strip.slice(strip.indexOf('const isActionable ='), strip.indexOf('const isActionable =') + 200);
    expect(isActionableLine).not.toContain('SUMMARY_READY');
    expect(isActionableLine).toContain("'EVOLUTION_READY'");
    expect(isActionableLine).toContain("'EVOLUTION_DEFERRED'");
    expect(isActionableLine).toContain("'AUTO_ACTIVATION_NOTICE'");
  });

  it('surfaces a distinct, non-fabricated status when the dependent notice check failed (Passo 7)', () => {
    expect(strip).toContain('noticeUnavailable');
    expect(strip).toContain("t('evolution:state.error')");
  });
});

describe('EvolutionCard (Profile) — unaffected by the new Home-only intermediate kind', () => {
  it('treats SUMMARY_READY the same as LOADING, preserving Profile behavior unchanged', () => {
    expect(card).toContain("viewModel.kind === 'SUMMARY_READY'");
    const guardLine = card.slice(card.indexOf("if (viewModel.kind === 'LOADING'"), card.indexOf('return (', card.indexOf("if (viewModel.kind === 'LOADING'")));
    expect(guardLine).toContain("'SUMMARY_READY'");
  });
});

describe('multi-user isolation (Passo 8) — no Evolution fragment can survive a user switch', () => {
  it('AppShell (and therefore the single useWorkoutEvolution instance it owns) is conditionally rendered, not kept mounted across a user switch', () => {
    const app = read('App.tsx');
    expect(app).toContain("resolvedScreen === 'app' && <AppShell />");
    // useWorkoutEvolution's viewModel state (SUMMARY_READY included) is
    // React local state (`useState`) inside a hook instance owned by
    // AppShell. Since AppShell only renders while `resolvedScreen === 'app'`
    // and unmounts otherwise (e.g. on logout, before a new user's screen
    // resolves), the whole hook instance — and every piece of state it
    // holds, including any provisional SUMMARY_READY summary — is torn down
    // with it. A newly logged-in user always gets a brand new instance whose
    // `viewModel` starts fresh at `{ kind: 'LOADING' }`; nothing from the
    // previous account's closure can survive into it.
  });

  it('viewModel always starts fresh at LOADING — no persisted/hydrated initial value that could carry a previous user\'s summary', () => {
    expect(hook).toContain("useState<EvolutionViewModel>({ kind: 'LOADING' })");
  });
});

describe('filledProgramProgressSegments — SUMMARY_READY falls back to the real proximity value, never the actionable max', () => {
  it.each([
    ['BUILDING', 1],
    ['ON_TRACK', 2],
    ['READY', 3],
    [null, 0],
  ] as const)('proximity=%s -> %i segments', (proximity, expected) => {
    expect(filledProgramProgressSegments('SUMMARY_READY', proximity)).toBe(expected);
  });
});

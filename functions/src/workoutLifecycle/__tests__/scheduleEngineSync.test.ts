import { describe, expect, it } from 'vitest';

/**
 * Audit hardening (operational risk — scheduleEngine sync drift): asserts
 * `functions/src/workoutLifecycle/scheduleEngine/*` matches what
 * `scripts/syncScheduleEngineToFunctions.cjs` would generate right now from
 * the single source of truth, `src/scheduleEngine/`.
 *
 * `npm run test` here already runs `pretest` (which re-syncs unconditionally)
 * before Vitest starts, so this test trivially passes in that flow. Its real
 * job is catching the bypass cases `pretest` can't: a direct `vitest`/`tsc`
 * invocation (an IDE test runner, a one-off `npx vitest run <file>`) that
 * skips the npm lifecycle hook, or a hand-edit of a generated file made after
 * the last sync. Reuses the generator's own comparison (`check()`) so this
 * test is never a second, independently maintained copy of the sync rule —
 * see that module's doc comment.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires -- the generator
// lives outside `functions/`'s `rootDir`; a static `import` would pull it into
// the TS program (and its `rootDir` constraints) for no reason — `require` at
// runtime only, exactly like the script's own CLI entry point, sidesteps that.
const sync = require('../../../../scripts/syncScheduleEngineToFunctions.cjs') as {
  check: () => Array<{ file: string; destPath: string; expected: string }>;
  FILES: readonly string[];
};

describe('functions/src/workoutLifecycle/scheduleEngine sync', () => {
  it('matches src/scheduleEngine/ exactly, with no stale or missing generated file', () => {
    const stale = sync.check();
    if (stale.length > 0) {
      const names = stale.map((item) => item.file).join(', ');
      throw new Error(
        `scheduleEngine generated copy is out of sync with src/scheduleEngine/: ${names}. `
        + 'Run `npm run sync:scheduleEngine` (inside functions/) and re-run this suite.',
      );
    }
    expect(stale).toEqual([]);
  });

  it('checks every file the generator is responsible for, never a partial list', () => {
    expect(sync.FILES).toEqual(['calendar.ts', 'resolver.ts', 'types.ts', 'localDate.ts', 'identities.ts']);
  });
});

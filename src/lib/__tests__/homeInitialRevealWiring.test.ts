import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShellSource = readFileSync(
  new URL('../../screens/AppShell.tsx', import.meta.url),
  'utf8',
);

describe('Home cold-start readiness report is gated on authoritative terminal readiness, not the snapshot fast path', () => {
  it('defines homeInitialRevealReady as the authoritative-only signal — never ORed with snapshotVisualReady', () => {
    expect(appShellSource).toContain(
      'const homeInitialRevealReady = homeInitialVisualReady;',
    );
    // Regression guard: a stale/partial cached snapshot alone must never be
    // enough to tell the root splash "Home is ready" — see
    // bootstrapSplashWiring.test.ts for the WordmarkSplash-facing half of
    // this contract.
    expect(appShellSource).not.toMatch(
      /homeInitialRevealReady = homeInitialVisualReady \|\| snapshotVisualReady/,
    );
  });

  it('reports readiness to the parent via onHomeReady exactly when homeInitialRevealReady flips true — not from the snapshot-satisfied homeVisible', () => {
    expect(appShellSource).toMatch(/if \(homeInitialRevealReady\) onHomeReady\?\.\(\);/);
    expect(appShellSource).not.toMatch(/if \(homeVisible\) onHomeReady/);
  });

  it("homeVisible itself is untouched — it still ORs in the snapshot fast path, and still solely governs the Home content tree's own interactivity/accessibility and its loading overlay", () => {
    expect(appShellSource).toContain('const homeVisible = homeInitialVisualReady || snapshotVisualReady;');
    expect(appShellSource).toContain('{!homeVisible ? (');
  });
});

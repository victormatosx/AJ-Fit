import type { TabId } from '../state/AppState';

/**
 * Tabs that use lazy-mount + keep-alive (docs/23_navegacao_e_lifecycle.md):
 * mounted the first time visited, never unmounted afterwards, merely hidden.
 * `workout` is deliberately excluded — see that doc's "Exceções" section for
 * why a session/timer-driven screen isn't a safe default fit.
 */
export const PERSISTENT_TAB_IDS = ['home', 'progress', 'profile', 'nutrition'] as const;
export type PersistentTabId = (typeof PERSISTENT_TAB_IDS)[number];

export function isPersistentTab(tab: TabId): tab is PersistentTabId {
  return (PERSISTENT_TAB_IDS as readonly TabId[]).includes(tab);
}

/**
 * Core lazy-mount + keep-alive decision, used verbatim by
 * `PersistentScreen` (src/components/navigation/PersistentScreen.tsx): a
 * screen mounts the moment it's either `active` (the user opened it) or
 * `prewarm` (scheduled ahead of time — docs/23_navegacao_e_lifecycle.md
 * §14), and — critically — stays mounted forever afterwards, regardless of
 * later `active`/`prewarm` transitions back to false. `prewarm` only ever
 * *mounts* the tree; it must never be confused with `active` — see
 * PersistentScreen, which drives visibility/touch/accessibility solely off
 * `active`, never off this function's result.
 *
 * Pulled out of the component so this specific decision is testable without
 * a React Native rendering environment (see vitest.config.mts — this repo's
 * unit suite is Node-only, no RN runtime).
 */
export function computeShouldMount(
  previouslyMounted: boolean,
  active: boolean,
  prewarm: boolean,
): boolean {
  return previouslyMounted || active || prewarm;
}

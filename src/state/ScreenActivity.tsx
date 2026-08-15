import { createContext, useContext, useEffect } from 'react';

/**
 * Focus/blur equivalent for the AJ Fit custom router (no React Navigation —
 * see docs/23_navegacao_e_lifecycle.md). A screen wrapped in
 * `PersistentScreen` (../components/navigation/PersistentScreen) can stay
 * mounted while hidden, so `useEffect(fn, [])` no longer means "the user
 * just entered this screen" — it only means "this component was created for
 * the first time." Read this context (via the hooks below) for anything
 * that must react to the user actually looking at the screen again.
 *
 * Defaults to `true` so a screen rendered without a `PersistentScreen`
 * ancestor (ephemeral overlays, screens under test, Storybook-style
 * rendering) behaves exactly as if it were always focused — the historical,
 * pre-keep-alive behavior.
 */
const ScreenActivityContext = createContext<boolean>(true);

export function ScreenActivityProvider({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <ScreenActivityContext.Provider value={active}>{children}</ScreenActivityContext.Provider>
  );
}

/** True while this screen is the one currently visible/interactive; false while kept alive but hidden. */
export function useIsScreenActive(): boolean {
  return useContext(ScreenActivityContext);
}

/**
 * Runs `onActivate` every time the screen transitions into being the active
 * one (including its first activation), and its returned cleanup — if any —
 * when the screen stops being active. Use this instead of
 * `useEffect(fn, [])` for anything that must re-run per visit (refresh
 * data, restart a decorative animation, re-focus an input) rather than once
 * per component lifetime.
 */
export function useScreenFocusEffect(onActivate: () => void | (() => void)): void {
  const active = useIsScreenActive();
  useEffect(() => {
    if (!active) return;
    return onActivate();
    // `onActivate` intentionally not in deps — callers pass an inline
    // closure; re-running on identity change would defeat the "once per
    // activation" contract this hook exists to provide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

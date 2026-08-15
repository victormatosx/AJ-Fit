import { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ScreenActivityProvider } from '../../state/ScreenActivity';
import { computeShouldMount } from '../../lib/tabLifecycle';

export type InactiveMode = 'detached' | 'materialized';

/**
 * Lazy-mount + keep-alive wrapper for the AJ Fit custom router — see
 * docs/23_navegacao_e_lifecycle.md for the full policy, the 4 lifecycle
 * states this implements, and which screens qualify for which mode. Mounts
 * `children` the first time `active` OR `prewarm` becomes true, then never
 * unmounts them again: later visits only toggle visibility.
 *
 * `prewarm` (optional, defaults false) mounts the tree ahead of the user
 * requesting it — see `usePrewarm` (./usePrewarm.ts) — without ever
 * treating the screen as visible/interactive: visibility, touch and
 * accessibility below are driven exclusively by `active`, never by
 * `prewarm`. `useIsScreenActive()` reports `false` for a prewarmed screen
 * exactly like it does for a persistent tab the user switched away from —
 * no business-logic `useScreenFocusEffect` fires just because a screen was
 * prewarmed.
 *
 * `activeStyle` defaults to filling the parent (`flex: 1`), the shape every
 * main tab needs. Pass an explicit one for a screen that isn't a plain flex
 * child while active — e.g. an absolutely-positioned overlay stacked over a
 * tab (`position:'absolute', ..., zIndex: N`).
 *
 * ## `inactiveMode`
 *
 * - **`'detached'`** (default): `display:'none'`. Excludes the subtree from
 *   native layout entirely — no `onLayout`, no paint/composition. Cheapest
 *   while hidden, but the screen's very first real appearance after being
 *   newly mounted still pays native layout+paint cost synchronously with
 *   whatever made it visible (mount, or the first `active=true` after a
 *   `prewarm`) — `display:'none'` prevented that cost from happening any
 *   earlier. Fine for a screen the user has already displayed at least once
 *   (a persistent tab's 2nd+ entry): re-attaching known geometry is cheap.
 *   NOT fine for `prewarm`: a prewarmed-but-`detached` screen is only
 *   React-mounted, never actually laid out, so prewarm buys nothing (see
 *   docs/23_navegacao_e_lifecycle.md, "por que a 1ª tentativa de prewarm
 *   falhou").
 * - **`'materialized'`**: keeps the exact geometry of `activeStyle` (same
 *   `position`/bounds/`zIndex` — this component derives it automatically,
 *   the caller never repeats it) with `opacity: 0` layered on top. The
 *   subtree stays in normal layout — measured, painted, composited — while
 *   fully invisible, so by the time the user activates it there is no
 *   remaining native layout/paint cost, only a visibility flip. This is
 *   what makes `prewarm` actually eliminate the first-presentation
 *   artifact; use it whenever `prewarm` is used on a screen.
 *
 * Either way, `pointerEvents="none"` plus the accessibility-hiding props
 * make an inactive screen fully inert — untouchable, invisible to
 * VoiceOver/TalkBack — regardless of mode.
 *
 * Don't reach for this by default on every new screen — it changes
 * lifecycle semantics (see useScreenFocusEffect in ScreenActivity.tsx) and
 * is only correct for screens that have been through the
 * persistent-vs-ephemeral decision documented above.
 */
export function PersistentScreen({
  active,
  prewarm = false,
  activeStyle,
  inactiveMode = 'detached',
  children,
}: {
  active: boolean;
  prewarm?: boolean;
  activeStyle?: StyleProp<ViewStyle>;
  inactiveMode?: InactiveMode;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(() => computeShouldMount(false, active, prewarm));
  useEffect(() => {
    const next = computeShouldMount(mounted, active, prewarm);
    if (next !== mounted) setMounted(next);
  }, [active, prewarm, mounted]);

  if (!mounted) return null;

  const resolvedActiveStyle = activeStyle ?? styles.active;
  const style = active
    ? resolvedActiveStyle
    : inactiveMode === 'materialized'
      ? [resolvedActiveStyle, styles.materializedHidden]
      : styles.detached;

  return (
    <View
      style={style}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <ScreenActivityProvider active={active}>{children}</ScreenActivityProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  active: { flex: 1 },
  detached: { display: 'none' },
  materializedHidden: { opacity: 0 },
});

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for PersistentScreen (docs/23_navegacao_e_
 * lifecycle.md). No component renderer in this Node-only suite (see
 * vitest.config.mts) — the mount-once decision itself is unit-tested in
 * isolation in src/lib/__tests__/tabLifecycle.test.ts; this file locks the
 * visual/accessibility/touch contract around it.
 */

const SOURCE = readFileSync('src/components/navigation/PersistentScreen.tsx', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('PersistentScreen mount decision', () => {
  it('uses the pure computeShouldMount decision instead of a local reimplementation', () => {
    expect(CODE).toContain("import { computeShouldMount } from '../../lib/tabLifecycle'");
    expect(CODE).toContain('computeShouldMount(mounted, active, prewarm)');
  });

  it('does not render children before the screen has ever been mounted (lazy mount)', () => {
    expect(CODE).toContain('if (!mounted) return null');
  });
});

describe('PersistentScreen inactiveMode contract', () => {
  it('defaults inactiveMode to "detached" (display:none — layout+paint excluded)', () => {
    expect(CODE).toContain("inactiveMode = 'detached'");
    expect(CODE).toContain("detached: { display: 'none' }");
  });

  it('derives the "materialized" geometry from activeStyle itself, never a separately-typed prop', () => {
    // §3 / §14: a materialized screen must have the EXACT geometry it will
    // have when active — deriving it from `activeStyle` at render time
    // (instead of accepting a second, independently-authored style prop)
    // makes geometry drift between the hidden and shown states structurally
    // impossible, not just a convention callers have to remember.
    expect(CODE).not.toMatch(/inactiveStyle/);
    expect(CODE).toContain('const resolvedActiveStyle = activeStyle ?? styles.active');
    expect(CODE).toContain(
      "? [resolvedActiveStyle, styles.materializedHidden]\n      : styles.detached",
    );
    expect(CODE).toContain('materializedHidden: { opacity: 0 }');
  });

  it('supports an overlay-shaped active style, defaulting to flex:1 for plain tabs', () => {
    expect(CODE).toContain('activeStyle?: StyleProp<ViewStyle>');
    expect(CODE).toContain('active: { flex: 1 }');
  });
});

describe('PersistentScreen inactive-state touch/accessibility contract', () => {
  it('blocks touch on the inactive subtree, regardless of inactiveMode', () => {
    expect(CODE).toContain("pointerEvents={active ? 'auto' : 'none'}");
  });

  it('removes the inactive subtree from the accessibility tree on both platforms, regardless of inactiveMode', () => {
    expect(CODE).toContain('accessibilityElementsHidden={!active}');
    expect(CODE).toContain("importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}");
  });
});

describe('PersistentScreen prewarm prop', () => {
  it('accepts an optional prewarm prop, defaulting to false, that never drives visibility', () => {
    // §14: prewarm may only ever affect the mount decision (fed into
    // computeShouldMount). The active/inactive `style`, `pointerEvents` and
    // accessibility props above must reference `active` exclusively — a
    // prewarmed-but-inactive screen must render byte-identical to a
    // regular persistent screen the user switched away from.
    expect(CODE).toContain('prewarm?: boolean');
    expect(CODE).toContain('prewarm = false');
    expect(CODE).not.toMatch(/pointerEvents=\{.*prewarm/);
    expect(CODE).not.toMatch(/accessibilityElementsHidden=\{.*prewarm/);
    expect(CODE).not.toMatch(/importantForAccessibility=\{.*prewarm/);
  });
});

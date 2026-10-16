import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screen = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');

/**
 * Regression: Fotos is mounted in a separate branch from Corpo/Cargas (see
 * the "mounted INSTEAD of" doc comment), so `PillTabs` remounts fresh every
 * time the user crosses that boundary. A fresh `Animated.Value(0)` always
 * starts at the leftmost slot (Corpo), so returning from Fotos to Cargas
 * used to visibly slide the indicator through Corpo first, instead of just
 * moving left one slot. The fix: remember which tab was active before this
 * mount and position the indicator there first, then animate to the real
 * current tab — so a fresh mount always starts from the tab the user was
 * actually on, never from a fixed slot.
 */
describe('Evolution tab indicator survives the Fotos remount boundary', () => {
  it('ProgressScreen remembers the tab active before the current one', () => {
    expect(screen).toContain('const previousViewRef = useRef<ProgressView>(view)');
    expect(screen).toContain('previousViewRef.current = view');
    expect(screen).toContain('previousView={previousViewRef.current}');
  });

  it('PillTabs positions the indicator at the previous tab before animating to the current one', () => {
    expect(screen).toContain('previousView: ProgressView');
    expect(screen).toContain('const initialIndex = tabs.findIndex(([key]) => key === previousView)');
    expect(screen).toContain('offset.setValue(initialIndex * slotWidth)');
    expect(screen).toContain('hasPositionedRef.current = true');
  });
});

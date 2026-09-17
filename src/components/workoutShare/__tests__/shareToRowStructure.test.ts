import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../ShareToRow.tsx', import.meta.url), 'utf8');

describe('ShareToRow', () => {
  it('renders every destination from the shared registry — no scattered per-platform conditionals', () => {
    expect(source).toContain('WORKOUT_SHARE_DESTINATIONS.map(');
    expect(source).not.toMatch(/if\s*\(\s*destination\.id\s*===/);
  });

  it('scrolls horizontally and never forces a large vertical footprint', () => {
    expect(source).toContain('horizontal');
    expect(source).toContain('showsHorizontalScrollIndicator={false}');
  });

  it('gives every destination item accessible affordances and a disabled/busy state', () => {
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityLabel={label}');
    expect(source).toContain('accessibilityState={{ disabled, busy }}');
    expect(source).toContain('disabled={disabled}');
    expect(source).toContain('hitSlop={8}');
  });

  it('caps destination labels at two lines and never wraps an item in a large card', () => {
    expect(source).toContain('numberOfLines={2}');
    expect(source).not.toContain('shadowOpacity');
    expect(source).not.toContain('elevation');
  });

  it('uses real brand glyphs (FontAwesome5) for brand destinations, never an emoji', () => {
    expect(source).toContain("from '@expo/vector-icons'");
    expect(source).toContain('FontAwesome5');
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('renders a minimal white silhouette per destination — no circular badge, no brand-color fill, no gradient container', () => {
    expect(source).toContain("const ICON_COLOR = '#FFFFFF'");
    expect(source).not.toContain('borderRadius');
    expect(source).not.toContain('backgroundColor');
    expect(source).not.toContain('BADGE_SIZE');
  });

  it('gives Instagram and Instagram Stories the exact same treatment as every other brand destination', () => {
    expect(source).not.toMatch(/icon\.name === 'instagram'/);
    expect(source).not.toContain('DestinationBadge');
  });
});

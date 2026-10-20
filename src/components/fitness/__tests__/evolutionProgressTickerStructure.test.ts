import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/fitness/EvolutionProgressTicker.tsx', 'utf8');

describe('EvolutionProgressTicker', () => {
  it('renders nothing when there are no items — never an empty bordered band', () => {
    expect(source).toContain('if (items.length === 0) return null');
  });

  it("matches the existing tickers' hairline-border/marquee visual contract", () => {
    expect(source).toContain('borderTopWidth: 1');
    expect(source).toContain('borderBottomWidth: 1');
    expect(source).toContain('theme.colors.settingsGroupBorder');
    expect(source).toContain('LOOP_DURATION_MS = 18000');
    expect(source).toContain('ITEM_GAP = 36');
    expect(source).toContain('useIsScreenActive');
  });
});

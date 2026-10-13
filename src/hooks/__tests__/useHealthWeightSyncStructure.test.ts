import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/useHealthWeightSync.ts'), 'utf8');

describe('useHealthWeightSync lifecycle structure', () => {
  it('guards native work by uid epoch and current enabled intent', () => {
    expect(source).toContain("intent !== 'enabled'");
    expect(source).toContain('epoch.current === requestEpoch && enabled.current');
    expect(source).toContain('subscribeToHealthIntegrationIntent');
  });

  it('single-flights calls and serializes an explicit deletion after active sync', () => {
    expect(source).toContain('if (operation.current) return operation.current');
    expect(source).toContain('if (operation.current) await operation.current');
    expect(source).toContain('if (epoch.current !== requestEpoch) return 0');
  });

  it('syncs on authenticated initialization and foreground without background timers', () => {
    expect(source).toContain("if (intent === 'enabled') void syncNow()");
    expect(source).toContain("next === 'active' && enabled.current");
    expect(source).not.toContain('setInterval');
  });
});

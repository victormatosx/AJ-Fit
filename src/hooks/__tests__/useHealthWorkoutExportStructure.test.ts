import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/useHealthWorkoutExport.ts'), 'utf8');

describe('useHealthWorkoutExport lifecycle structure', () => {
  it('guards native work by uid epoch and current enabled intent', () => {
    expect(source).toContain("intent !== 'enabled'");
    expect(source).toContain('epoch.current === requestEpoch && enabled.current');
    expect(source).toContain('subscribeToHealthIntegrationIntent');
  });

  it('single-flights concurrent requests instead of racing two exports', () => {
    expect(source).toContain('if (operation.current) return operation.current');
  });

  it('runs on authenticated initialization and foreground without background timers', () => {
    expect(source).toContain("if (intent === 'enabled') void run(false)");
    expect(source).toContain("next === 'active' && enabled.current");
    expect(source).not.toContain('setInterval');
  });

  it('never flips state after a stale request resolves — applyResult re-checks epoch and enabled before every setState', () => {
    const applyResultBody = source.slice(
      source.indexOf('const applyResult = useCallback('),
      source.indexOf('}, []);', source.indexOf('const applyResult = useCallback(')),
    );
    expect(applyResultBody).toContain('if (epoch.current !== requestEpoch || !enabled.current) return;');
  });

  it('distinguishes a user-initiated cancellation from a real failure instead of surfacing both as "error"', () => {
    expect(source).toContain('isHealthWorkoutExportCancellation');
    expect(source.match(/isHealthWorkoutExportCancellation\(cause\)/g) ?? []).toHaveLength(2);
  });

  it('the finish-flow fast path (enqueueConfirmed) threads the same epoch/enabled cancellation guard as the background worker', () => {
    const enqueueBody = source.slice(
      source.indexOf('const enqueueConfirmed = useCallback('),
      source.indexOf('}, [applyResult, uid]);', source.indexOf('const enqueueConfirmed = useCallback(')),
    );
    expect(enqueueBody).toContain('epoch.current === requestEpoch && enabled.current');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/hooks/usePendingHealthIntegrationConfirmation.ts'), 'utf8');

describe('usePendingHealthIntegrationConfirmation — never opens the native dialog by itself', () => {
  it('never imports or calls connect()/requestHealthPermissions — it only decides whether to show the sheet', () => {
    expect(source).not.toContain('connect(');
    expect(source).not.toContain('requestHealthPermissions');
    expect(source).not.toContain("from '../hooks/useHealthIntegration'");
  });

  it('skips the check entirely on an unsupported platform', () => {
    expect(source).toContain("getHealthPlatform() === 'unsupported'");
  });

  it('guards the async check against re-kicking on every render while one is already in flight for this uid', () => {
    expect(source).toContain('if (checkedUidRef.current === uid) return;');
  });

  it('resets state when the uid disappears (logout) instead of leaking a stale confirmation', () => {
    const effectBody = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('}, [uid]);'));
    expect(effectBody).toContain('if (!uid) {');
    expect(effectBody).toContain('setVisible(false);');
  });

  it('resolve() always pairs clearing the pending flag with marking the uid fully settled', () => {
    const resolveBody = source.slice(source.indexOf('const resolve = useCallback'), source.indexOf('}, [uid]);', source.indexOf('const resolve = useCallback')));
    expect(resolveBody).toContain('clearHealthIntegrationOnboardingPendingConfirmation(uid)');
    expect(resolveBody).toContain('markHealthIntegrationOnboardingStepSeen(uid)');
  });
});

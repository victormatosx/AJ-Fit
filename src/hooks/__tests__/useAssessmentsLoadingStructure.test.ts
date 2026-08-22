import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CODE = readFileSync('src/hooks/useAssessments.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('useAssessments initial loading vs. background revalidation', () => {
  it('only re-enters the blocking loader when the current uid has never resolved', () => {
    expect(CODE).toContain('const isInitialLoad = resolvedUidRef.current !== uid;');
    expect(CODE).toMatch(/if \(isInitialLoad\) \{[\s\S]*?setLoading\(true\);[\s\S]*?\}/);

    const refreshBody = CODE.slice(
      CODE.indexOf('const refresh = useCallback'),
      CODE.indexOf('useEffect(() =>', CODE.indexOf('const refresh = useCallback')),
    );
    expect(refreshBody.match(/setLoading\(true\)/g)).toHaveLength(1);
  });

  it('treats a uid transition as initializing before effects can run', () => {
    expect(CODE).toContain('const hasResolvedCurrentUid = resolvedUid === uid;');
    expect(CODE).toContain('const visibleAssessments = hasResolvedCurrentUid ? assessments : [];');
    expect(CODE).toContain('const visibleError = hasResolvedCurrentUid ? error : null;');
    expect(CODE).toContain('const effectiveLoading = !hasResolvedCurrentUid || loading;');
    expect(CODE).toContain('assessments: visibleAssessments');
    expect(CODE).toContain('error: visibleError');
    expect(CODE).toContain('loading: effectiveLoading');
  });
});

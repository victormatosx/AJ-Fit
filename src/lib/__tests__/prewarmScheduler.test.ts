import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schedulePrewarm } from '../prewarmScheduler';

describe('schedulePrewarm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not run the task synchronously — defers to requestIdleCallback', () => {
    const calls: string[] = [];
    let idleCallback: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      idleCallback = cb;
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());

    schedulePrewarm(() => calls.push('task'));

    expect(calls).toEqual([]); // not run on the calling stack
    idleCallback?.();
    expect(calls).toEqual(['task']);
  });

  it('returns a cancel function that calls cancelIdleCallback with the scheduled handle', () => {
    const cancelSpy = vi.fn();
    vi.stubGlobal('requestIdleCallback', () => 42);
    vi.stubGlobal('cancelIdleCallback', cancelSpy);

    const cancel = schedulePrewarm(() => {});
    cancel();

    expect(cancelSpy).toHaveBeenCalledWith(42);
  });

  it('uses requestIdleCallback, not the deprecated InteractionManager', () => {
    // node_modules/react-native/index.js marks InteractionManager
    // `@deprecated` in this project's RN version (0.85.3) and its own
    // warning recommends requestIdleCallback — this file's actual code
    // (comments aside, since they document that very fact) must not
    // reference InteractionManager or import 'react-native' at all.
    const source = readFileSync('src/lib/prewarmScheduler.ts', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('InteractionManager');
    expect(code).not.toContain("from 'react-native'");
    expect(code).toContain('requestIdleCallback');
    expect(code).toContain('cancelIdleCallback');
  });
});

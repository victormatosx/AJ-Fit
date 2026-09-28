import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wordmarkSource = readFileSync(
  new URL('../WordmarkSplash.tsx', import.meta.url),
  'utf8',
);

describe('"Fit" no longer clips — line box matches GLYPH_H instead of an undersized value', () => {
  it("fit's lineHeight is tied to GLYPH_H, not the old undersized 37", () => {
    const fitBlock = wordmarkSource.slice(
      wordmarkSource.indexOf('fit: {'),
      wordmarkSource.indexOf('},', wordmarkSource.indexOf('fit: {')),
    );
    expect(fitBlock).toMatch(/lineHeight:\s*GLYPH_H/);
    expect(fitBlock).not.toMatch(/lineHeight:\s*37/);
  });

  it('clip no longer over-extends top/bottom to compensate for the undersized line box', () => {
    const clipBlock = wordmarkSource.slice(
      wordmarkSource.indexOf('clip: {'),
      wordmarkSource.indexOf('},', wordmarkSource.indexOf('clip: {')),
    );
    expect(clipBlock).not.toMatch(/top:\s*-12/);
    expect(clipBlock).not.toMatch(/bottom:\s*-12/);
  });

  it('fitRow no longer needs the compensating paddingTop', () => {
    const fitRowBlock = wordmarkSource.slice(
      wordmarkSource.indexOf('fitRow: {'),
      wordmarkSource.indexOf('},', wordmarkSource.indexOf('fitRow: {')),
    );
    expect(fitRowBlock).not.toMatch(/paddingTop/);
  });
});

describe('intro animation always starts immediately — never gated on ready/timedOut', () => {
  it('the intro-start effect guard no longer waits on ready or timedOut', () => {
    const effectIdx = wordmarkSource.indexOf('if (started.current');
    const guardLine = wordmarkSource.slice(effectIdx, wordmarkSource.indexOf('\n', effectIdx));
    expect(guardLine).not.toContain('ready');
    expect(guardLine).not.toContain('timedOut');
    expect(guardLine).toContain('measured');
    expect(guardLine).toContain('fontsLoaded');
    expect(guardLine).toContain('holdDone');
  });

  it('the intro animates t to T_OUT (not straight to T_END) over T_OUT ms', () => {
    expect(wordmarkSource).toMatch(
      /t\.value = withTiming\(T_OUT, \{ duration: T_OUT/,
    );
  });
});

describe('wait-bounce loop — bounces in place until ready/timedOut, then fades', () => {
  it('imports waitBounce from wordmarkMotion', () => {
    expect(wordmarkSource).toMatch(/import \{[\s\S]*waitBounce[\s\S]*\} from '\.\.\/\.\.\/lib\/wordmarkMotion'/);
  });

  it('declares a waitCycle shared value', () => {
    expect(wordmarkSource).toMatch(/const waitCycle = useSharedValue\(0\)/);
  });

  it('keeps live ready/timedOut refs for the worklet-scheduled settleOrWait to read', () => {
    expect(wordmarkSource).toMatch(/const readyRef = useRef/);
    expect(wordmarkSource).toMatch(/const timedOutRef = useRef/);
  });

  it('settleOrWait starts the fade only once ready or timedOut, otherwise rests before firing one more wait-bounce pulse', () => {
    const idx = wordmarkSource.indexOf('const settleOrWait');
    expect(idx).toBeGreaterThan(-1);
    const block = wordmarkSource.slice(idx, wordmarkSource.indexOf('}, [onDone', idx));
    expect(block).toMatch(/readyRef\.current \|\| timedOutRef\.current/);
    expect(block).toMatch(/withTiming\(T_END, \{ duration: WM\.out/);
    expect(block).toMatch(/setTimeout\(\(\) => \{/);
    expect(block).toMatch(/\}, WM\.waitRestMs\)/);
    expect(block).toMatch(/waitCycle\.value = withTiming\(\s*1,\s*\{ duration: WM\.waitBounceMs/);
  });

  it('dotStyle combines the landed dotTransform with the additive waitBounce pulse', () => {
    const idx = wordmarkSource.indexOf('const dotStyle');
    const block = wordmarkSource.slice(idx, wordmarkSource.indexOf('});', idx));
    expect(block).toContain('dotTransform(t.value, dotD0)');
    expect(block).toContain('waitBounce(waitCycle.value)');
  });
});

describe('"Fit" stays mounted through the wait-bounce loop (Reanimated/Fabric dropped a frozen sibling view)', () => {
  it('clipStyle depends on waitCycle so it keeps re-pushing its (unchanged) width while the dot bounces', () => {
    const idx = wordmarkSource.indexOf('const clipStyle');
    const block = wordmarkSource.slice(idx, wordmarkSource.indexOf('});', idx));
    expect(block).toContain('waitCycle.value');
  });

  it('fitWrapStyle depends on waitCycle so it keeps re-pushing its (unchanged) transform while the dot bounces', () => {
    const idx = wordmarkSource.indexOf('const fitWrapStyle');
    const block = wordmarkSource.slice(idx, wordmarkSource.indexOf('});', idx));
    expect(block).toContain('waitCycle.value');
  });

  it('each Letter receives waitCycle and depends on it the same way', () => {
    expect(wordmarkSource).toMatch(/<Letter key={ch \+ i} ch={ch} index={i} t={t} waitCycle={waitCycle} \/>/);
    const idx = wordmarkSource.indexOf('function Letter');
    const block = wordmarkSource.slice(idx, wordmarkSource.indexOf('}\n', idx));
    expect(block).toContain('waitCycle: SharedValue<number>');
    expect(block).toContain('waitCycle.value');
  });
});

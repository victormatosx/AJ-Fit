import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const summary = readFileSync(new URL('../WorkoutSummaryScreen.tsx', import.meta.url), 'utf8');
const ring = readFileSync(new URL('../FinalizationProgressRing.tsx', import.meta.url), 'utf8');

describe('WorkoutSummaryScreen — header has its final geometry on the first frame', () => {
  it('never uses the native <SafeAreaView> host component, which performs its own per-mount measurement independent of the already-warm root SafeAreaProvider', () => {
    const importLine = summary.split('\n').find((line) => line.includes("from 'react-native-safe-area-context'"));
    expect(importLine).toBeDefined();
    expect(importLine).not.toContain('SafeAreaView');
    expect(importLine).toContain('useSafeAreaInsets');
  });

  it('applies insets as plain padding from the JS `useSafeAreaInsets()` hook, resolved synchronously on the first render', () => {
    expect(summary).toContain('const insets = useSafeAreaInsets();');
    expect(summary).toContain('paddingTop: insets.top');
  });

  it('renders the header (close button + "TREINO CONCLUÍDO" kicker) unconditionally, before the ScrollView — never gated behind data/committed/loading state', () => {
    const headerIndex = summary.indexOf("t('done.kicker')");
    const scrollViewIndex = summary.indexOf('<ScrollView');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(scrollViewIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(scrollViewIndex);

    // The row containing it is not wrapped in a conditional: the nearest
    // preceding JSX-opening brace sequence is the plain header View, not a
    // ternary/&&-gated expression.
    const headerRowStart = summary.lastIndexOf(
      "<View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 }}>",
      headerIndex,
    );
    expect(headerRowStart).toBeGreaterThan(-1);
    const precedingSlice = summary.slice(Math.max(0, headerRowStart - 120), headerRowStart);
    expect(precedingSlice).not.toMatch(/\?\s*\($/);
    expect(precedingSlice).not.toMatch(/&&\s*\($/);
  });
});

describe('WorkoutSummaryScreen — the region above the metric cards has stable geometry', () => {
  it('reserves a fixed-height slot for the message/"X of Y sets" text, unconditionally rendered with an explicit shared line height', () => {
    expect(summary).toContain('const MESSAGE_LINE_HEIGHT');
    expect(summary).toContain('minHeight: MESSAGE_LINE_HEIGHT');
    // Both variants that can occupy the slot use the exact same line height.
    const occurrences = summary.split('lineHeight: MESSAGE_LINE_HEIGHT').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('reserves a fixed-height slot for the EARLY/cardio-skipped badge row, unconditionally rendered — never swapped in/out as a whole block', () => {
    expect(summary).toContain('const BADGE_ROW_LINE_HEIGHT');
    expect(summary).toContain('minHeight: BADGE_ROW_LINE_HEIGHT');
    // Regression guard: the old structure wrapped the ENTIRE badge row in a
    // ternary that rendered `null` (collapsing to zero height) until
    // `finalizedEarly`/`cardioSkipped` became true — exactly what pushed the
    // cards down. That whole-row conditional must not come back.
    expect(summary).not.toContain('{data && (data.finalizedEarly || data.cardioSkipped) ?');
  });

  it('the cards grid is rendered once, in a single unconditional position, after CompletionHero', () => {
    const heroIndex = summary.indexOf('<CompletionHero');
    const gridIndex = summary.indexOf('<SummaryMetricsGrid');
    expect(heroIndex).toBeGreaterThan(-1);
    expect(gridIndex).toBeGreaterThan(heroIndex);
  });
});

describe('FinalizationProgressRing — a single visual source for the percentage, and 100% is sticky', () => {
  it('never uses a native TextInput for the digits — the fragile "animated counter" trick that caused "100" without "%" and the 100%→0% regression', () => {
    expect(ring).not.toContain('TextInput }');
    expect(ring).not.toContain('<TextInput');
    expect(ring).not.toContain('<AnimatedTextInput');
    expect(ring).not.toContain('defaultValue=');
  });

  it('renders the percentage from exactly one plain <Text>, driven by a single piece of state', () => {
    expect(ring).toContain('{displayPercent}%');
    expect(ring.match(/\{displayPercent\}%/g)?.length).toBe(1);
    // Only one state variable backs the visible number.
    expect(ring.match(/useState\(/g)?.length).toBe(1);
  });

  it('delegates the "can this regress to 0%" decision entirely to the pure, separately-tested state machine — no ad-hoc reset logic inline', () => {
    expect(ring).toContain('decideFinalizationRingAction');
    expect(ring).not.toContain('setTimeout');
  });
});

describe('FinalizationProgressRing — every helper called from inside a Reanimated worklet is worklet-safe', () => {
  // Regression test for "[Worklets] Tried to synchronously call a Remote
  // Function" — `clampPercent` was called from inside `useAnimatedReaction`
  // and `useAnimatedProps` (both run on the UI runtime) without itself
  // being tagged `'worklet'`, so the babel plugin left it a JS-thread-only
  // function; the UI runtime crashed trying to call it synchronously.

  /** Balanced-paren extraction of `hookName(...)`'s full argument list, so
   * the worklet body's text is captured precisely regardless of nesting. */
  function extractHookCallBodies(source: string, hookName: string): string[] {
    const bodies: string[] = [];
    let searchFrom = 0;
    while (true) {
      const callStart = source.indexOf(`${hookName}(`, searchFrom);
      if (callStart === -1) break;
      const openParenIndex = callStart + hookName.length;
      let depth = 0;
      let endIndex = -1;
      for (let i = openParenIndex; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            endIndex = i;
            break;
          }
        }
      }
      if (endIndex === -1) break;
      bodies.push(source.slice(openParenIndex, endIndex + 1));
      searchFrom = endIndex + 1;
    }
    return bodies;
  }

  const workletCallSites = [
    ...extractHookCallBodies(ring, 'useAnimatedReaction'),
    ...extractHookCallBodies(ring, 'useAnimatedProps'),
    ...extractHookCallBodies(ring, 'useAnimatedStyle'),
  ];

  // Every locally-declared top-level `function name(...) { ... }` in this
  // file, keyed by name, so we can look up whether a given callee is
  // worklet-tagged.
  const localFunctionBodies = new Map<string, string>();
  for (const match of ring.matchAll(/^function (\w+)\([^)]*\)[^{]*\{/gm)) {
    const name = match[1];
    const bodyStart = match.index! + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < ring.length && depth > 0) {
      if (ring[i] === '{') depth += 1;
      else if (ring[i] === '}') depth -= 1;
      i += 1;
    }
    localFunctionBodies.set(name, ring.slice(bodyStart, i));
  }

  it('found at least one worklet call site and at least one local helper to check against (sanity check for this test itself)', () => {
    expect(workletCallSites.length).toBeGreaterThan(0);
    expect(localFunctionBodies.size).toBeGreaterThan(0);
  });

  it('every locally-declared helper referenced inside a worklet call site declares the \'worklet\' directive', () => {
    const notWorkletSafe: string[] = [];
    for (const [name, body] of localFunctionBodies) {
      const calledFromWorklet = workletCallSites.some((site) => new RegExp(`\\b${name}\\(`).test(site));
      if (calledFromWorklet && !body.includes("'worklet'")) {
        notWorkletSafe.push(name);
      }
    }
    expect(notWorkletSafe).toEqual([]);
  });

  it('clampPercent specifically is worklet-tagged (the exact function the crash pointed at)', () => {
    expect(ring).toMatch(/function clampPercent\([^)]*\)[^{]*\{\s*\n?\s*'worklet';/);
  });
});

describe('FinalizationProgressRing — the displayed number tracks the animation closely, without big jumps', () => {
  // Regression test: a `useAnimatedReaction` + `runOnJS(setDisplayPercent)`
  // pass used to drive the number, firing once per changed integer — on
  // device, bursts of queued `runOnJS` calls landed on the JS thread faster
  // than React could commit them, and automatic batching silently dropped
  // all but the last of each burst (0→30→40→99 instead of a steady climb).

  it('never uses useAnimatedReaction/runOnJS to drive the number — the exact mechanism that dropped most intermediate values on-device', () => {
    const importBlock = ring.match(/import Animated,\s*\{[^}]*\}\s*from\s*'react-native-reanimated';/s)?.[0];
    expect(importBlock).toBeDefined();
    expect(importBlock).not.toContain('useAnimatedReaction');
    expect(importBlock).not.toContain('runOnJS');
  });

  it('polls the shared value from the JS thread with requestAnimationFrame — frame-paced, never a fixed-interval timer', () => {
    expect(ring).toContain('requestAnimationFrame(tick)');
    expect(ring).toContain('cancelAnimationFrame');
    expect(ring).not.toContain('setInterval');
  });

  it('every poll re-reads the live shared value rather than replaying a queued one, so there is nothing to drop in a burst', () => {
    expect(ring).toContain('clampPercent(progress.value)');
  });
});

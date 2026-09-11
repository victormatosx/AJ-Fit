import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

describe('WorkoutScreen — skipping a started exercise', () => {
  it('uses one shared guard for the button, handler, and queue navigation', () => {
    expect(source).toContain('const canSkipCurrentExercise = canSkipExercise(setIdx, order.length);');
    expect(source).toContain('if (!canSkipCurrentExercise) return;');
    expect(source).toContain("if (exDone(i) || (i !== exIdx && !canSkipCurrentExercise)) return;");
    expect(source).toContain('{canSkipCurrentExercise && (');
    expect(source).toContain('disabled={navigationLocked}');
    expect(source).toContain('accessibilityState={{ disabled: navigationLocked }}');
  });

  it('reserves the skip-action slot so the complete-set CTA never moves', () => {
    const ctaBlock = source.slice(
      source.indexOf('{/* CTAs */}'),
      source.indexOf('{/* REST OVERLAY */}'),
    );
    expect(ctaBlock).toContain('<View style={{ height: 54 }}>');
    expect(ctaBlock).toContain('height: 44');
    expect(ctaBlock.indexOf('<View style={{ height: 54 }}>')).toBeLessThan(
      ctaBlock.indexOf('{canSkipCurrentExercise && ('),
    );
  });
});

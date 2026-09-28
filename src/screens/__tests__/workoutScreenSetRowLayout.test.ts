import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression coverage for the per-set row's layout.
//
// History: the row went through several previous-load presentations inline
// (stacked, single-line with a dot, single-line right-aligned...). This
// version removes the previous-load reference from the row entirely — that
// reference now lives exclusively in the "next set" card (index-aligned by
// setIndex, with a last-known-load fallback). A row shows only reps (future/
// current) or reps + what was actually registered this session (completed).
const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

function setListBlock(): string {
  const start = source.indexOf('{/* set list */}');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('{/* CTAs */}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('WorkoutScreen set-row layout', () => {
  it('never shows a previous-load reference in the row again', () => {
    const block = setListBlock();
    expect(block).not.toContain('previousSetLoads[ex.db]');
    expect(block).not.toContain('previousExerciseLastLoad');
    expect(block).not.toContain('width: 82');
  });

  it('keeps the row explicitly single-line', () => {
    const block = setListBlock();
    const rowStart = block.indexOf('flexDirection: \'row\'');
    expect(rowStart).toBeGreaterThan(-1);
    const rowDecl = block.slice(rowStart, block.indexOf('>', rowStart));
    expect(rowDecl).toContain("flexWrap: 'nowrap'");
  });

  it('gives the reps summary the entire remaining width via flex + minWidth: 0, never a fixed width', () => {
    const block = setListBlock();
    const repsTextStart = block.lastIndexOf('<Text', block.indexOf('sets.summaryWeighted'));
    const repsTextEnd = block.indexOf('>', repsTextStart);
    const repsTextProps = block.slice(repsTextStart, repsTextEnd);

    expect(repsTextProps).toContain('flex: 1');
    expect(repsTextProps).toContain('minWidth: 0');
    expect(repsTextProps).toContain('numberOfLines={1}');
  });

  it('shows the actually-registered weight for a completed set, via the existing lastWeight/w mechanism, not a historical reference', () => {
    const block = setListBlock();
    expect(block).toContain('sets.summaryWeighted');
    expect(block).toContain('sets.summaryReps');
    expect(block).toContain('const w = lastWeight(ex, i);');
  });

  it('reserves a fixed-width badge slot so AGORA/REGISTRADO align the same across rows', () => {
    const block = setListBlock();
    const slotStart = block.indexOf("width: 80, alignItems: 'flex-end'");
    expect(slotStart).toBeGreaterThan(-1);
  });

  it('keeps the future-set attenuation intact', () => {
    const block = setListBlock();
    expect(block).toContain('opacity: done ? 0.5 : 1');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression coverage for a letter-by-letter text wrap bug on the
// "next set" card of the workout execution screen.
//
// Root cause: a long reps string (e.g. "8-12/perna" for unilateral exercises
// like Agachamento Búlgaro) was allowed to reserve 110 px while the last-load
// block reserved another 100 px. The flexible "PRÓXIMA SÉRIE" / "SÉRIE N"
// block was left too narrow and its large text painted into the reps block.
const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

function nextSetCard(): string {
  const start = source.indexOf('{/* Next-set card */}');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('{/* set list */}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('WorkoutScreen next-set card layout', () => {
  it('reserves a readable width for the next-series label instead of letting it collapse', () => {
    const card = nextSetCard();
    expect(card).toContain('flexBasis: 112, flexGrow: 0, flexShrink: 1, minWidth: 98');
  });

  it('makes the reps value consume only the space left inside the card', () => {
    const card = nextSetCard();
    const repsBlockStart = card.indexOf('{curReps}');
    expect(repsBlockStart).toBeGreaterThan(-1);
    const repsColumnStart = card.lastIndexOf('<View', repsBlockStart);
    const repsColumn = card.slice(repsColumnStart, repsBlockStart);

    expect(repsColumn).toContain('maxWidth');
    expect(repsColumn).toContain('flex: 1');
    expect(repsColumn).toContain('minWidth: 0');
    // The display font is skewed, so clipping the column also clips the
    // leading edge of the first glyph (visible as a cut-off "8" on iOS).
    expect(repsColumn).not.toContain("overflow: 'hidden'");
  });

  it('constrains the reps text to a single line and shrinks font instead of expanding the box', () => {
    const card = nextSetCard();
    const repsTextStart = card.lastIndexOf('<Text', card.indexOf('{curReps}'));
    const repsTextEnd = card.indexOf('{curReps}');
    const repsTextProps = card.slice(repsTextStart, repsTextEnd);

    expect(repsTextProps).toContain('numberOfLines={1}');
    expect(repsTextProps).toContain('adjustsFontSizeToFit');
    expect(repsTextProps).toContain("width: '100%'");
    expect(repsTextProps).toContain('paddingHorizontal: 4');
  });

  it('keeps the last-load column compact so it cannot starve the other values', () => {
    const card = nextSetCard();
    const lastTimeIdx = card.indexOf("t('sets.lastTime')");
    expect(lastTimeIdx).toBeGreaterThan(-1);
    const dividerIdx = card.indexOf('dividerStrong');
    expect(dividerIdx).toBeGreaterThan(-1);
    const lastColumnStart = card.indexOf('<View', dividerIdx);
    const lastColumn = card.slice(lastColumnStart, lastTimeIdx);

    expect(lastColumn).toContain('width: 72');
    expect(lastColumn).toContain('minWidth: 66');
    expect(lastColumn).toContain('flexShrink: 1');
  });

  it('uses the raw prescription reps string directly (covers long unilateral formats like "8-12/perna")', () => {
    // Guards against a regression where curReps stops being the free-form
    // "r" field (which can be short numbers like "12" or long strings like
    // "8-12/perna" / "8–12/perna" with an en dash) and the layout fix above
    // silently stops being exercised by real data.
    expect(source).toContain('const curReps = ex.sets[setIdx].r;');
  });
});

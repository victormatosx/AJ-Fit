import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');

describe('WorkoutScreen header layout', () => {
  it('keeps the workout name on its own centered, bounded row', () => {
    const headerStart = source.indexOf('{/* header */}');
    const bannerStart = source.indexOf('{/* GIF banner */}', headerStart);
    const header = source.slice(headerStart, bannerStart);

    expect(header).toContain("style={{ flex: 1, minWidth: 0 }}");
    expect(header).toContain('<MonoLabel');
    expect(header).toContain("style={{ marginTop: 7, textAlign: 'center' }}");
    expect(header).not.toContain('{plan.templateId}');
  });

  it('renders elapsed time and set progress below the workout name', () => {
    const headerStart = source.indexOf('{/* header */}');
    const workoutName = source.indexOf('resolveSessionDisplayName(', headerStart);
    const elapsed = source.indexOf('{fmt(elapsed)}', workoutName);
    const progress = source.indexOf("{t('sets.progress'", elapsed);

    expect(workoutName).toBeGreaterThan(-1);
    expect(elapsed).toBeGreaterThan(workoutName);
    expect(progress).toBeGreaterThan(elapsed);
  });
});

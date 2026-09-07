import { describe, expect, it } from 'vitest';
import { filledProgramProgressSegments, PROGRAM_PROGRESS_SEGMENT_COUNT } from '../programProgress';

describe('filledProgramProgressSegments', () => {
  it('maps BUILDING/ON_TRACK/READY to 1/2/3 of 3 segments', () => {
    expect(filledProgramProgressSegments('PROGRESSING', 'BUILDING')).toBe(1);
    expect(filledProgramProgressSegments('PROGRESSING', 'ON_TRACK')).toBe(2);
    expect(filledProgramProgressSegments('PROGRESSING', 'READY')).toBe(3);
  });

  it('returns 0 when proximity is null (evaluation paused/blocked) — never a guessed value', () => {
    expect(filledProgramProgressSegments('PROGRESSING', null)).toBe(0);
  });

  it('treats an earned-but-not-yet-activated evolution as fully filled', () => {
    expect(filledProgramProgressSegments('EVOLUTION_READY', null)).toBe(PROGRAM_PROGRESS_SEGMENT_COUNT);
    expect(filledProgramProgressSegments('EVOLUTION_DEFERRED', 'BUILDING')).toBe(PROGRAM_PROGRESS_SEGMENT_COUNT);
    expect(filledProgramProgressSegments('AUTO_ACTIVATION_NOTICE', null)).toBe(PROGRAM_PROGRESS_SEGMENT_COUNT);
  });

  it('never returns a value outside [0, PROGRAM_PROGRESS_SEGMENT_COUNT]', () => {
    const kinds: Parameters<typeof filledProgramProgressSegments>[0][] = [
      'PROGRESSING', 'EVOLUTION_READY', 'EVOLUTION_DEFERRED', 'AUTO_ACTIVATION_NOTICE',
    ];
    const proximities: Parameters<typeof filledProgramProgressSegments>[1][] = [
      null, 'BUILDING', 'ON_TRACK', 'READY',
    ];
    for (const kind of kinds) {
      for (const proximity of proximities) {
        const value = filledProgramProgressSegments(kind, proximity);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(PROGRAM_PROGRESS_SEGMENT_COUNT);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  FINALIZATION_MESSAGE_SCHEDULE,
  FINALIZATION_VISUAL_PROGRESS_CONFIG,
  finalizationMessageKeyAtElapsedMs,
  finalizationMessageScheduleDelaysMs,
} from '../finalizationVisualProgress';

const TEST_CONFIG = {
  rampDurationMs: 1000,
  ceilingPercent: 99,
  completionRampMs: 300,
};

describe('finalization message schedule', () => {
  it('starts on the first message at t=0', () => {
    expect(finalizationMessageKeyAtElapsedMs(0, TEST_CONFIG)).toBe(FINALIZATION_MESSAGE_SCHEDULE[0].key);
  });

  it('advances through every message in order as elapsed time grows, never skipping backward', () => {
    const seen = FINALIZATION_MESSAGE_SCHEDULE.map((entry) =>
      finalizationMessageKeyAtElapsedMs(entry.atFraction * TEST_CONFIG.rampDurationMs, TEST_CONFIG));
    expect(seen).toEqual(FINALIZATION_MESSAGE_SCHEDULE.map((entry) => entry.key));
  });

  it('stays on the last message for any elapsed time at or beyond the ramp duration', () => {
    const last = FINALIZATION_MESSAGE_SCHEDULE[FINALIZATION_MESSAGE_SCHEDULE.length - 1].key;
    expect(finalizationMessageKeyAtElapsedMs(TEST_CONFIG.rampDurationMs, TEST_CONFIG)).toBe(last);
    expect(finalizationMessageKeyAtElapsedMs(TEST_CONFIG.rampDurationMs * 10, TEST_CONFIG)).toBe(last);
  });

  it('never regresses to an earlier message as elapsed time only grows', () => {
    const samples = Array.from({ length: 21 }, (_, i) => (i / 20) * TEST_CONFIG.rampDurationMs * 1.5);
    const indices = samples.map((elapsedMs) =>
      FINALIZATION_MESSAGE_SCHEDULE.findIndex(
        (entry) => entry.key === finalizationMessageKeyAtElapsedMs(elapsedMs, TEST_CONFIG),
      ));
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it('produces one scheduled delay per message after the first, strictly increasing', () => {
    const delays = finalizationMessageScheduleDelaysMs(TEST_CONFIG);
    expect(delays).toHaveLength(FINALIZATION_MESSAGE_SCHEDULE.length - 1);
    expect(delays.map((d) => d.key)).toEqual(FINALIZATION_MESSAGE_SCHEDULE.slice(1).map((e) => e.key));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i].delayMs).toBeGreaterThan(delays[i - 1].delayMs);
    }
    expect(delays[delays.length - 1].delayMs).toBeLessThan(TEST_CONFIG.rampDurationMs);
  });

  it('ships with a sane default config: a real ceiling below 100 and positive durations', () => {
    expect(FINALIZATION_VISUAL_PROGRESS_CONFIG.ceilingPercent).toBeGreaterThan(0);
    expect(FINALIZATION_VISUAL_PROGRESS_CONFIG.ceilingPercent).toBeLessThan(100);
    expect(FINALIZATION_VISUAL_PROGRESS_CONFIG.rampDurationMs).toBeGreaterThan(0);
    expect(FINALIZATION_VISUAL_PROGRESS_CONFIG.completionRampMs).toBeGreaterThan(0);
  });

  it('every schedule fraction is within [0, 1), strictly increasing, starting at 0', () => {
    expect(FINALIZATION_MESSAGE_SCHEDULE[0].atFraction).toBe(0);
    for (const entry of FINALIZATION_MESSAGE_SCHEDULE) {
      expect(entry.atFraction).toBeGreaterThanOrEqual(0);
      expect(entry.atFraction).toBeLessThan(1);
    }
    for (let i = 1; i < FINALIZATION_MESSAGE_SCHEDULE.length; i += 1) {
      expect(FINALIZATION_MESSAGE_SCHEDULE[i].atFraction).toBeGreaterThan(FINALIZATION_MESSAGE_SCHEDULE[i - 1].atFraction);
    }
  });
});

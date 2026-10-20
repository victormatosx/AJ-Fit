import { describe, expect, it } from 'vitest';
import {
  AJ_BOT_BLINK,
  AJ_BOT_CHANNELS,
  AJ_BOT_ENTER,
  AJ_BOT_ENTER_TRACKS,
  AJ_BOT_EXIT,
  AJ_BOT_HOP_TRACKS,
  AJ_BOT_FLOAT,
  AJ_BOT_HOP,
  AJ_BOT_LOOK_NEUTRAL,
  AJ_BOT_NOD,
  AJ_BOT_TALK,
  AJ_BOT_VIEW_BOX,
  ajBotChannelTrack,
  ajBotLookAt,
  type AjBotPhaseSpec,
} from '../ajBotMotion';

/**
 * The mascot's motion is the one part of the AJ assistant that is pure data,
 * so it is the one part this Node-only suite can check directly (no React
 * Native renderer exists here — see `WorkoutSessionRecoveryModal.test.ts`).
 * These lock the curves/durations taken from the design prototype, and the
 * keyframe->interpolation translation that `AjBot` feeds to Reanimated.
 */

const PHASES: [string, AjBotPhaseSpec][] = [
  ['enter', AJ_BOT_ENTER],
  ['exit', AJ_BOT_EXIT],
  ['hop', AJ_BOT_HOP],
  ['nod', AJ_BOT_NOD],
];

describe('AjBot keyframe specs', () => {
  for (const [name, spec] of PHASES) {
    it(`${name}: stops are ascending and span the full phase`, () => {
      const stops = spec.keyframes.map((frame) => frame.progress);
      expect(stops[0]).toBe(0);
      expect(stops[stops.length - 1]).toBe(1);
      for (let i = 1; i < stops.length; i += 1) {
        expect(stops[i]).toBeGreaterThan(stops[i - 1]);
      }
    });
  }

  it('matches the prototype durations exactly', () => {
    expect(AJ_BOT_ENTER.durationMs).toBe(1050);
    expect(AJ_BOT_EXIT.durationMs).toBe(620);
    expect(AJ_BOT_HOP.durationMs).toBe(550);
    expect(AJ_BOT_NOD.durationMs).toBe(550);
    expect(AJ_BOT_FLOAT.durationMs).toBe(3400);
    expect(AJ_BOT_BLINK.durationMs).toBe(4600);
    expect(AJ_BOT_TALK.durationMs).toBe(160);
  });

  it('enters from off-screen bottom-right, overshoots, then settles at rest', () => {
    const first = AJ_BOT_ENTER.keyframes[0];
    expect(first.opacity).toBe(0);
    expect(first.translateX).toBeGreaterThan(0);
    expect(first.translateY).toBeGreaterThan(0);
    // The 62% stop is the overshoot — past the resting scale, on the far side
    // of centre — which is what makes the arrival read as a landing.
    const overshoot = AJ_BOT_ENTER.keyframes.find((frame) => frame.progress === 0.62);
    expect(overshoot?.scaleX).toBeGreaterThan(1);
    expect(overshoot?.translateX).toBeLessThan(0);
    const last = AJ_BOT_ENTER.keyframes[AJ_BOT_ENTER.keyframes.length - 1];
    expect(last).toMatchObject({ translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 });
  });

  it('exits to off-screen bottom-left and fades out', () => {
    const last = AJ_BOT_EXIT.keyframes[AJ_BOT_EXIT.keyframes.length - 1];
    expect(last.opacity).toBe(0);
    expect(last.translateX).toBeLessThan(0);
    expect(last.translateY).toBeGreaterThan(0);
  });

  it('hop and nod both squash/stretch and return to rest without moving sideways', () => {
    for (const spec of [AJ_BOT_HOP, AJ_BOT_NOD]) {
      expect(spec.keyframes.some((frame) => (frame.scaleX ?? 1) > 1 && (frame.scaleY ?? 1) < 1)).toBe(true);
      expect(spec.keyframes.every((frame) => frame.translateX === undefined)).toBe(true);
      const last = spec.keyframes[spec.keyframes.length - 1];
      expect(last).toMatchObject({ translateY: 0, scaleX: 1, scaleY: 1 });
    }
  });

  it('hop overshoots upward; nod dips downward first', () => {
    expect(Math.min(...AJ_BOT_HOP.keyframes.map((f) => f.translateY ?? 0))).toBe(-16);
    expect(AJ_BOT_NOD.keyframes.find((f) => f.progress === 0.3)?.translateY).toBe(5);
  });
});

describe('ajBotChannelTrack', () => {
  it('exposes one interpolation track per animated channel, spanning the whole phase', () => {
    expect(AJ_BOT_CHANNELS).toEqual(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
    for (const channel of AJ_BOT_CHANNELS) {
      const track = AJ_BOT_ENTER_TRACKS[channel];
      expect(track.input).toHaveLength(track.output.length);
      expect(track.input[0]).toBe(0);
      expect(track.input[track.input.length - 1]).toBeCloseTo(1);
      // Strictly ascending, or `interpolate` reads garbage.
      for (let i = 1; i < track.input.length; i += 1) {
        expect(track.input[i]).toBeGreaterThan(track.input[i - 1]);
      }
      // Sub-sampled: the easing is baked in per keyframe interval, so there
      // are many more stops than there are keyframes.
      expect(track.input.length).toBeGreaterThan(AJ_BOT_ENTER.keyframes.length);
    }
  });

  it('bakes the timing function into each keyframe INTERVAL, the way CSS does', () => {
    // The bug this pins: handing the bezier to a single global `withTiming`
    // front-loads `cubic-bezier(.25,.8,.3,1)` so hard that AJ is home in the
    // first ~300ms of a 1050ms arc and then micro-settles — a pop, not a
    // flight. Per-interval easing keeps him genuinely in transit.
    const y = AJ_BOT_ENTER_TRACKS.translateY;
    const at = (progress: number) => {
      for (let i = 1; i < y.input.length; i += 1) {
        if (progress <= y.input[i]) {
          const span = y.input[i] - y.input[i - 1];
          const f = span === 0 ? 0 : (progress - y.input[i - 1]) / span;
          return y.output[i - 1] + (y.output[i] - y.output[i - 1]) * f;
        }
      }
      return y.output[y.output.length - 1];
    };
    // 150ms in (14%) he must still be well below the resting pose.
    expect(at(150 / AJ_BOT_ENTER.durationMs)).toBeGreaterThan(200);
    // Still visibly above it past the halfway mark.
    expect(at(600 / AJ_BOT_ENTER.durationMs)).toBeLessThan(-20);
    // And the apex lands in the middle of the phase, not at its very start.
    let apexProgress = 0;
    let apex = Infinity;
    for (let i = 0; i < y.output.length; i += 1) {
      if (y.output[i] < apex) {
        apex = y.output[i];
        apexProgress = y.input[i];
      }
    }
    expect(apexProgress).toBeGreaterThan(0.3);
    expect(apexProgress).toBeLessThan(0.7);
  });

  it('keeps every interval monotonic in time even where the easing overshoots in value', () => {
    // `hop`'s cubic-bezier(.3, 1.6, .5, 1) has y2 > 1; that must produce
    // value overshoot, never a non-monotonic time axis.
    const track = AJ_BOT_HOP_TRACKS.scaleX;
    for (let i = 1; i < track.input.length; i += 1) {
      expect(track.input[i]).toBeGreaterThan(track.input[i - 1]);
    }
    expect(Math.max(...track.output)).toBeGreaterThan(1.08);
  });

  it('holds the previous value through stops that omit the channel, like CSS keyframes', () => {
    // enter's 12% stop only sets opacity, so translateX must still read 170
    // there rather than snapping to the rest value.
    const track = ajBotChannelTrack(AJ_BOT_ENTER, 'translateX');
    expect(track.input[1]).toBe(0.12);
    expect(track.output[1]).toBe(170);
  });

  it('falls back to the rest value when the very first stop omits the channel', () => {
    const track = ajBotChannelTrack(AJ_BOT_HOP, 'rotate');
    expect(track.output.every((value) => value === 0)).toBe(true);
  });
});

describe('ajBotLookAt', () => {
  it('leans toward the focused answer and always glances down at the list', () => {
    const [firstX, firstY] = ajBotLookAt(0, 2);
    const [secondX] = ajBotLookAt(1, 2);
    expect(firstX).toBeLessThan(0);
    expect(secondX).toBeGreaterThan(0);
    expect(firstX).toBeCloseTo(-secondX);
    expect(firstY).toBeGreaterThan(0);
  });

  it('keeps a single answer centred', () => {
    expect(ajBotLookAt(0, 1)[0]).toBeCloseTo(0);
  });

  it('stays within the viewBox-unit budget the prototype uses (±1.5)', () => {
    for (const count of [1, 2, 3, 4]) {
      for (let i = 0; i < count; i += 1) {
        expect(Math.abs(ajBotLookAt(i, count)[0])).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('degrades to the neutral look rather than dividing by zero', () => {
    expect(ajBotLookAt(0, 0)).toBe(AJ_BOT_LOOK_NEUTRAL);
  });
});

describe('AjBot drawing contract', () => {
  it('keeps the AJ mark coordinate space the paths were authored in', () => {
    expect(AJ_BOT_VIEW_BOX).toEqual({ x: 17, y: 17, width: 66, height: 66 });
  });
});

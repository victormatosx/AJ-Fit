import { describe, expect, it } from 'vitest';
import {
  circularProgressGeometry,
  circularProgressTip,
  measuredCircularProgressTip,
  interpolateMascotArrival,
} from '../circularProgressGeometry';

describe('ring mascot position', () => {
  it.each([184, 224])('stays centered on the arc endpoint at size %i', (size) => {
    const { center, radius } = circularProgressGeometry(size);
    for (const [progress, dx, dy] of [[0, 0, -1], [25, 1, 0], [50, 0, 1], [75, -1, 0], [100, 0, -1]]) {
      const tip = circularProgressTip(size, progress, 44);
      expect(tip.x + 22).toBeCloseTo(center + radius * dx);
      expect(tip.y + 22).toBeCloseTo(center + radius * dy);
    }
  });

  it('ends in the same pose where it started, ready for the plan transition', () => {
    const start = circularProgressTip(224, 0, 44);
    const end = circularProgressTip(224, 100, 44);
    expect(end.x).toBeCloseTo(start.x);
    expect(end.y).toBeCloseTo(start.y);
    expect(end.size).toBe(44);
  });

  it('supports sub-percent movement without snapping to whole percentages', () => {
    const before = circularProgressTip(224, 25, 44);
    const between = circularProgressTip(224, 25.5, 44);
    const after = circularProgressTip(224, 26, 44);
    expect(between.y).toBeGreaterThan(before.y);
    expect(between.y).toBeLessThan(after.y);
    const { center, radius } = circularProgressGeometry(224);
    expect(Math.hypot(between.x + 22 - center, between.y + 22 - center)).toBeCloseTo(radius);
  });
});

describe('measured ring arrival', () => {
  const stage = { pageX: 12, pageY: 32, width: 390 };
  const ringAtRest = { pageX: 95, pageY: 100, width: 224 };

  it('converts both measured page positions into the same stage coordinate system', () => {
    const tip = measuredCircularProgressTip(ringAtRest, stage, 0, 44);
    const local = circularProgressTip(224, 0, 44);
    expect(tip.x).toBeCloseTo(95 - 12 + local.x);
    expect(tip.y).toBeCloseTo(100 - 32 + local.y);
  });

  it('follows the screen entrance instead of caching its initial 28px offset', () => {
    const enteringRing = { ...ringAtRest, pageY: ringAtRest.pageY + 28 };
    const firstTarget = measuredCircularProgressTip(enteringRing, stage, 0, 44);
    const settledTarget = measuredCircularProgressTip(ringAtRest, stage, 0, 44);
    expect(firstTarget.y - settledTarget.y).toBeCloseTo(28);
    const from = { x: 150, y: 250, size: 104, rotate: 8 };
    expect(interpolateMascotArrival(from, firstTarget, 0)).toEqual(from);
    const arrived = interpolateMascotArrival(from, settledTarget, 1);
    expect(arrived.x).toBeCloseTo(settledTarget.x);
    expect(arrived.y).toBeCloseTo(settledTarget.y);
  });

  it('lands at the live endpoint even when the ring changes size during arrival', () => {
    const target = measuredCircularProgressTip({ ...ringAtRest, width: 184 }, stage, 0, 44);
    const arrived = interpolateMascotArrival({ x: 50, y: 300, size: 104 }, target, 1);
    expect(arrived).toEqual(target);
    expect(arrived.size).toBe(44);
    expect(arrived.rotate).toBe(0);
  });

  it('moves smoothly from the arrival endpoint into the first fractional orbit step', () => {
    const arrived = measuredCircularProgressTip(ringAtRest, stage, 0, 44);
    const next = measuredCircularProgressTip(ringAtRest, stage, 0.05, 44);
    expect(Math.hypot(next.x - arrived.x, next.y - arrived.y)).toBeLessThan(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AJ_W,
  LOGO_PX,
  T_END,
  T_OUT,
  WM,
  clamp01,
  clipWidth,
  deriveOffsets,
  dotTransform,
  easeInOutCubic,
  easeOutCubic,
  letterStyle,
  lerp,
  rowOpacity,
  shiftOffset,
  waitBounce,
  type WordmarkMetrics,
} from '../wordmarkMotion';

describe('timing constants', () => {
  it('matches the spec\'s stated composition-hold and fade-out milestones', () => {
    expect(T_OUT).toBe(2240);
    expect(T_END).toBe(2620);
  });
});

describe('logo crop geometry', () => {
  it('matches the spec\'s stated LOGO_PX/AJ_W values', () => {
    expect(LOGO_PX).toBeCloseTo(116.7, 1);
    expect(AJ_W).toBeCloseTo(84.6, 1);
  });
});

describe('easing primitives', () => {
  it('clamp01 clamps to [0, 1]', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(5)).toBe(1);
  });

  it('lerp interpolates linearly, including negative ranges', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(-20, 0, 0.25)).toBe(-15);
  });

  it('easeOutCubic starts at 0, ends at 1, monotonically increasing', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.25)).toBeLessThan(easeOutCubic(0.75));
  });

  it('easeInOutCubic starts at 0, ends at 1, symmetric around 0.5', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('deriveOffsets — centers "AJ." alone at t=0 from a measurement of the final "AJ Fit." layout', () => {
  const metrics: WordmarkMetrics = { aL: 100, fitL: 200, fitW: 60, dF: 270 };

  it('computes shift0/dotD0 from the documented formula', () => {
    // g = fitL - (aL + AJ_W) = 200 - (100 + 93.94...) = 6.06...
    // gd = dF - (fitL + fitW) = 270 - 260 = 10
    // shift0 = (g + fitW) / 2 = (6.06 + 60) / 2 = 33.03
    // dotD0 = aL + shift0 + AJ_W + gd - dF = 100 + 33.03 + 93.94 + 10 - 270 = -33.03
    const { shift0, dotD0 } = deriveOffsets(metrics);
    const g = metrics.fitL - (metrics.aL + AJ_W);
    const gd = metrics.dF - (metrics.fitL + metrics.fitW);
    expect(shift0).toBeCloseTo((g + metrics.fitW) / 2, 5);
    expect(dotD0).toBeCloseTo(metrics.aL + shift0 + AJ_W + gd - metrics.dF, 5);
    expect(dotD0).toBeLessThan(0);
  });
});

describe('shiftOffset — AJ/Fit slide from centered "AJ." to the final composed position', () => {
  const shift0 = 40;

  it('is fully shifted (shift0) at t=0', () => {
    expect(shiftOffset(0, shift0)).toBeCloseTo(shift0, 5);
  });

  it('settles to 0 by t=WM.shift (800ms)', () => {
    expect(shiftOffset(WM.shift, shift0)).toBeCloseTo(0, 5);
  });

  it('never overshoots past the destination or the start', () => {
    for (let t = 0; t <= WM.shift; t += 50) {
      const v = shiftOffset(t, shift0);
      expect(v).toBeLessThanOrEqual(shift0 + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('holds at 0 forever after t=WM.shift (clamped, never reverses)', () => {
    expect(shiftOffset(WM.shift + 500, shift0)).toBeCloseTo(0, 5);
  });
});

describe('clipWidth — "Fit" reveal wipe', () => {
  const fitW = 60;

  it('is 0 before the reveal starts (t <= WM.revealAt)', () => {
    expect(clipWidth(0, fitW)).toBe(0);
    expect(clipWidth(WM.revealAt, fitW)).toBe(0);
  });

  it('is fully revealed (fitW + 10, covering skew overflow) by revealAt + reveal (1200ms)', () => {
    expect(clipWidth(WM.revealAt + WM.reveal, fitW)).toBeCloseTo(fitW + 10, 5);
  });

  it('is monotonically non-decreasing through the reveal window', () => {
    let previous = -1;
    for (let t = WM.revealAt; t <= WM.revealAt + WM.reveal; t += 50) {
      const w = clipWidth(t, fitW);
      expect(w).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = w;
    }
  });
});

describe('letterStyle — per-letter stagger (F, i, t at indices 0, 1, 2)', () => {
  it('the first letter (index 0) is invisible before the reveal starts and fully in place by +460ms', () => {
    expect(letterStyle(WM.revealAt, 0).opacity).toBe(0);
    expect(letterStyle(WM.revealAt, 0).translateY).toBe(16);
    const settled = letterStyle(WM.revealAt + 460, 0);
    expect(settled.opacity).toBeCloseTo(1, 5);
    expect(settled.translateY).toBeCloseTo(0, 5);
  });

  it('each later letter starts 110ms after the previous one', () => {
    const mid = WM.revealAt + 110;
    expect(letterStyle(mid, 0).opacity).toBeGreaterThan(0);
    expect(letterStyle(mid, 1).opacity).toBe(0);
    expect(letterStyle(mid + 110, 1).opacity).toBeGreaterThan(0);
    expect(letterStyle(mid + 110, 2).opacity).toBe(0);
  });

  it('translateY only ever decreases toward 0 as opacity rises (never negative, never overshoots 16)', () => {
    for (let t = WM.revealAt; t <= WM.revealAt + 2 * 110 + 460; t += 20) {
      const { translateY } = letterStyle(t, 2);
      expect(translateY).toBeGreaterThanOrEqual(-1e-6);
      expect(translateY).toBeLessThanOrEqual(16 + 1e-6);
    }
  });
});

describe('dotTransform — the U-with-a-bounce', () => {
  const dotD0 = -30;

  it('starts at the derived offset, resting on the baseline (t <= revealAt)', () => {
    const start = dotTransform(WM.revealAt, dotD0);
    expect(start.translateX).toBeCloseTo(dotD0, 5);
    expect(start.translateY).toBeCloseTo(0, 5);
    expect(start.scaleX).toBeCloseTo(1, 5);
    expect(start.scaleY).toBeCloseTo(1, 5);
  });

  it('dips DOWN (positive translateY) mid-phase-A, peaking near the DIP amount', () => {
    // a = 0.5 of phase A (u = 0.3) is where sin(pi * easeInOut(0.5)) peaks at 1.
    const mid = dotTransform(WM.revealAt + 0.3 * WM.hop, dotD0);
    expect(mid.translateY).toBeCloseTo(WM.dip, 0);
    expect(mid.translateY).toBeGreaterThan(0);
  });

  it('phase A ends back on the baseline, fully converged to translateX=0 (u=0.6)', () => {
    const end = dotTransform(WM.revealAt + 0.6 * WM.hop, dotD0);
    expect(end.translateX).toBeCloseTo(0, 5);
    expect(end.translateY).toBeCloseTo(0, 5);
  });

  it('overshoots ABOVE the baseline (negative translateY) during phase B, peaking near -OVER at u=0.78', () => {
    const peak = dotTransform(WM.revealAt + 0.78 * WM.hop, dotD0);
    expect(peak.translateY).toBeCloseTo(-WM.over, 1);
  });

  it('falls back to the baseline by u=1 (t = revealAt + hop = 1200ms)', () => {
    const landed = dotTransform(WM.revealAt + WM.hop, dotD0);
    expect(landed.translateY).toBeCloseTo(0, 5);
    expect(landed.translateX).toBeCloseTo(0, 5);
  });

  it('squashes on impact right after landing, then returns to scale 1 by +180ms', () => {
    const impactPeak = dotTransform(WM.revealAt + WM.hop + WM.land / 2, dotD0);
    expect(impactPeak.scaleX).toBeGreaterThan(1);
    expect(impactPeak.scaleY).toBeLessThan(1);

    const settled = dotTransform(WM.revealAt + WM.hop + WM.land, dotD0);
    expect(settled.scaleX).toBeCloseTo(1, 5);
    expect(settled.scaleY).toBeCloseTo(1, 5);
  });

  it('never moves once the whole hop + landing window has fully elapsed', () => {
    const farLater = dotTransform(WM.revealAt + WM.hop + WM.land + 1000, dotD0);
    expect(farLater.translateX).toBeCloseTo(0, 5);
    expect(farLater.translateY).toBeCloseTo(0, 5);
    expect(farLater.scaleX).toBeCloseTo(1, 5);
    expect(farLater.scaleY).toBeCloseTo(1, 5);
  });
});

describe('waitBounce — idle "still waiting" pulse, additive on top of the landed dot', () => {
  it('is the identity transform at both u=0 and u=1 (always starts and ends exactly at rest)', () => {
    for (const u of [0, 1]) {
      const { translateX, translateY, scaleX, scaleY } = waitBounce(u);
      expect(translateX).toBe(0);
      expect(translateY).toBeCloseTo(0, 5);
      expect(scaleX).toBeCloseTo(1, 5);
      expect(scaleY).toBeCloseTo(1, 5);
    }
  });

  it('bounces up (negative translateY) to the same height as the hop\'s first bounce (WM.over), and squashes at the midpoint (u=0.5)', () => {
    const mid = waitBounce(0.5);
    expect(mid.translateY).toBeCloseTo(-WM.over, 5);
    expect(mid.scaleX).toBeGreaterThan(1);
    expect(mid.scaleY).toBeLessThan(1);
  });

  it('is symmetric around the midpoint (u=0.25 and u=0.75 match)', () => {
    const a = waitBounce(0.25);
    const b = waitBounce(0.75);
    expect(a.translateY).toBeCloseTo(b.translateY, 5);
    expect(a.scaleX).toBeCloseTo(b.scaleX, 5);
    expect(a.scaleY).toBeCloseTo(b.scaleY, 5);
  });

  it('clamps out-of-range u to [0, 1] (never negative dip, never past the far end)', () => {
    expect(waitBounce(-0.5)).toEqual(waitBounce(0));
    expect(waitBounce(1.5)).toEqual(waitBounce(1));
  });
});

describe('rowOpacity — final fade-out to the destination screen', () => {
  it('stays fully opaque until T_OUT', () => {
    expect(rowOpacity(0)).toBe(1);
    expect(rowOpacity(T_OUT)).toBe(1);
  });

  it('reaches 0 exactly at T_END', () => {
    expect(rowOpacity(T_END)).toBeCloseTo(0, 5);
  });

  it('is monotonically non-increasing across the fade window', () => {
    let previous = 2;
    for (let t = T_OUT; t <= T_END; t += 20) {
      const o = rowOpacity(t);
      expect(o).toBeLessThanOrEqual(previous + 1e-9);
      previous = o;
    }
  });
});

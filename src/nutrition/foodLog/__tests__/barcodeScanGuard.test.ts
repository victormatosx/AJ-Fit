import { describe, expect, it } from 'vitest';
import {
  beginBarcodeScan, endBarcodeScan, initialBarcodeScanGuardState, shouldAcceptBarcodeScan,
} from '../barcodeScanGuard';

describe('barcodeScanGuard', () => {
  it('accepts the first scan of a fresh session', () => {
    const state = initialBarcodeScanGuardState();
    expect(shouldAcceptBarcodeScan(state, '7891000100103', 1000)).toBe(true);
  });

  it('rejects an empty code', () => {
    const state = initialBarcodeScanGuardState();
    expect(shouldAcceptBarcodeScan(state, '', 1000)).toBe(false);
  });

  it('ignores every subsequent frame (even a DIFFERENT code) while a resolution is busy', () => {
    let state = initialBarcodeScanGuardState();
    state = beginBarcodeScan(state, '7891000100103');
    expect(shouldAcceptBarcodeScan(state, '7891000100103', 1000)).toBe(false);
    expect(shouldAcceptBarcodeScan(state, '0000000000001', 1000)).toBe(false);
  });

  it('rejects an immediate re-scan of the SAME code right after it resolves (cooldown)', () => {
    let state = initialBarcodeScanGuardState();
    state = beginBarcodeScan(state, '7891000100103');
    state = endBarcodeScan(state, 1000);
    expect(shouldAcceptBarcodeScan(state, '7891000100103', 1500)).toBe(false);
  });

  it('accepts a DIFFERENT code immediately after the previous one resolves — cooldown is per-code, not a global lock', () => {
    let state = initialBarcodeScanGuardState();
    state = beginBarcodeScan(state, '7891000100103');
    state = endBarcodeScan(state, 1000);
    expect(shouldAcceptBarcodeScan(state, '0000000000001', 1001)).toBe(true);
  });

  it('accepts the SAME code again once the cooldown window has fully elapsed', () => {
    let state = initialBarcodeScanGuardState();
    state = beginBarcodeScan(state, '7891000100103');
    state = endBarcodeScan(state, 1000);
    expect(shouldAcceptBarcodeScan(state, '7891000100103', 1000 + 2000)).toBe(true);
  });
});

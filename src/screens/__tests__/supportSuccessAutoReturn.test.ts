import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * SupportSuccessScreen's 3s auto-return (docs/23_navegacao_e_lifecycle.md
 * §14, "Suporte"). No component renderer in this Node-only suite (see
 * vitest.config.mts) — these lock the *pattern*, not runtime timing (that's
 * the manual/E2E pass).
 */

function code(path: string): string {
  const source = readFileSync(path, 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const CODE = code('src/screens/SupportSuccessScreen.tsx');

describe('SupportSuccessScreen — auto-return timer', () => {
  it('schedules onBack via useScreenFocusEffect, not a plain useEffect(fn, [])', () => {
    // This screen is prewarmed+materialized and stays mounted across every
    // support flow, so a bare `useEffect(fn, [])` would only ever fire once
    // per component lifetime instead of once per visit (e.g. report -> success
    // -> back -> suggestion -> success again).
    expect(CODE).toContain("import { useScreenFocusEffect } from '../state/ScreenActivity'");
    expect(CODE).toMatch(/useScreenFocusEffect\(\(\) => \{\s*const timer = setTimeout\(onBack, AUTO_RETURN_MS\);/);
  });

  it('uses a ~3000ms delay', () => {
    expect(CODE).toMatch(/AUTO_RETURN_MS\s*=\s*3000/);
  });

  it('clears the timer in the effect cleanup, so deactivating before it fires cannot navigate later', () => {
    const block = CODE.slice(
      CODE.indexOf('useScreenFocusEffect(() => {'),
      CODE.indexOf('});', CODE.indexOf('useScreenFocusEffect(() => {')) + 3,
    );
    expect(block).toContain('return () => clearTimeout(timer);');
  });

  it('reuses the existing onBack callback rather than a new hardcoded navigation', () => {
    expect(CODE).not.toMatch(/navigate\(/);
    expect(CODE.match(/setTimeout\(onBack, AUTO_RETURN_MS\)/g)?.length).toBe(1);
  });

  it('keeps a secondary, low-emphasis manual return affordance (not a dominant CTA competing with the timer)', () => {
    expect(CODE).not.toContain('CtaButton');
    expect(CODE).toContain('onPress={onBack}');
  });
});

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the Nutrition tab's wiring into the custom
 * router (mirrors `appShellNavigationStructure.test.ts`'s approach — no
 * component renderer in this Node-only suite, see vitest.config.mts).
 *
 * Covers the round brief's §3 requirement: the tab must respect
 * `nutritionEnabled` on the CLIENT (not just trust the backend), never show
 * a broken/disabled flow behind a visible icon, and never break existing
 * navigation when the flag is off.
 */
const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const APP_SHELL_CODE = APP_SHELL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppShell nutrition tab wiring', () => {
  it('gates the tab item itself on the resolved flag, not just its content', () => {
    expect(APP_SHELL_CODE).toContain('useNutritionEnabled(user?.uid ?? null)');
    expect(APP_SHELL_CODE).toContain("nutritionVisible={nutritionEnabled === true}");
  });

  it('mounts NutritionShell inside PersistentScreen, gated on the same flag', () => {
    const idx = APP_SHELL_CODE.indexOf("active={tab === 'nutrition' && nutritionEnabled === true}");
    expect(idx, 'nutrition PersistentScreen block not found').toBeGreaterThan(-1);
    const block = APP_SHELL_CODE.slice(idx, APP_SHELL_CODE.indexOf('</PersistentScreen>', idx));
    expect(block).toContain('<NutritionShell');
    expect(block).toContain('activeStyle={FULL_BLEED.tab}');
    expect(block).toContain('inactiveMode="materialized"');
  });

  it('bounces off the nutrition tab if the flag resolves false while it is active', () => {
    expect(APP_SHELL_CODE).toContain("if (tab === 'nutrition' && nutritionEnabled === false) setTab('home')");
  });

  it('never shows the tab while the flag is unresolved (null), only once it resolves true', () => {
    const fnIdx = APP_SHELL_CODE.indexOf('function TabBar(');
    const fnBody = APP_SHELL_CODE.slice(fnIdx, APP_SHELL_CODE.indexOf('\nfunction ', fnIdx + 1));
    expect(fnBody).toContain('...(nutritionVisible ?');
  });

  it('keeps the existing four tabs (home/workout/progress/profile) present regardless of the flag', () => {
    for (const tab of ["{ id: 'home'", "{ id: 'workout'", "{ id: 'progress'", "{ id: 'profile'"]) {
      expect(APP_SHELL_CODE).toContain(tab);
    }
  });

  it('forwards a typed notification destination into the mounted NutritionShell', () => {
    expect(APP_SHELL_CODE).toContain('setNutritionNavigationRequest');
    expect(APP_SHELL_CODE).toContain('destination: pendingIntent.destination');
    expect(APP_SHELL_CODE).toContain('navigationRequest={nutritionNavigationRequest}');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * This project has no React Native component-render test infrastructure
 * (vitest runs with `environment: 'node'` — see `vitest.config.mts`), so
 * these are source-text structural guards in the codebase's existing style
 * (e.g. `analyzingScreenHooksOrder.test.ts`).
 *
 * Covers the redesigned Plan screen: a single continuous scroll (no staged
 * reveal) switching between Workout and Diet via the shared `AqSegmented`
 * tab control, with Jotinha (`JotinhaPlanDropdown`) reduced to a silent
 * mascot anchored in the header — no speech bubble, no typed narration, no
 * tap-to-open panel — so he never gates the plan or the CTA beneath it. He
 * hides on scroll like the rest of the header, instead of floating over the
 * content below it.
 */
const planReady = readFileSync(new URL('../PlanReadyScreen.tsx', import.meta.url), 'utf8');
const dropdown = readFileSync(new URL('../../components/plan/JotinhaPlanDropdown.tsx', import.meta.url), 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(planReady);
const dropdownCode = stripComments(dropdown);

describe('Plan — one continuous scroll, with a Workout/Diet tab switcher', () => {
  it('renders Workout and Diet in exactly one vertical ScrollView, not one per panel', () => {
    // The Workout tab's own session carousel is a second `<ScrollView>` —
    // `horizontal`, paging sideways through sibling sessions within a single
    // mount — not a second competing vertical scroll per panel.
    const total = (code.match(/<ScrollView[\s>]/g) ?? []).length;
    const horizontalCount = (code.match(/<ScrollView\s+horizontal/g) ?? []).length;
    expect(total - horizontalCount).toBe(1);
  });

  it('switches the visible panel with the shared AqSegmented tab control', () => {
    expect(code).toContain('<AqSegmented');
    expect(code).toContain("useState<'workout' | 'diet'>('workout')");
    expect(code).toContain("activeTab === 'workout'");
    expect(code).toContain("activeTab === 'diet'");
  });

  it('never reintroduces the staged narration/reveal machine the old layout needed', () => {
    expect(code).not.toContain('PresentationStage');
    expect(code).not.toContain('canRevealWorkoutBody');
    expect(code).not.toContain('workoutBodyVisible');
    expect(code).not.toContain('weekRowVisible');
  });
});

describe('Plan — the CTA is never gated behind the narration', () => {
  it('the primary button is always mounted at full opacity, with no `ctaReady`/`stage` conditional around it', () => {
    expect(code).not.toContain('ctaReady');
    expect(code).toContain('<AqPrimaryButton');
    expect(code).toContain('onPress={handleContinue}');
  });

  it('still fires onContinue exactly once, however fast the CTA is tapped', () => {
    expect(code).toContain('if (continuedRef.current) return;');
    expect(code).toContain('continuedRef.current = true;');
  });

  it('the commercial continuation boundary (flushDraft → onAuthRequested) is untouched by this screen', () => {
    // This screen only ever calls the `onContinue` callback it was given —
    // the funnel (`OnboardingFunnelScreen.handlePlanContinue`) still owns
    // what that callback actually does.
    expect((code.match(/\bonContinue\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Plan — Jotinha is a silent, fixed presence, never narration', () => {
  it('the screen mounts the dropdown once, outside the scroll, passing it the director, the Reduce Motion flag, and a scroll-derived visibility flag', () => {
    expect(code).toContain('<JotinhaPlanDropdown aj={aj} reduceMotion={reduceMotion} visible={jotinhaVisible} />');
    // It is a sibling of the SafeAreaView/ScrollView tree, not nested inside
    // the scroll — it must never affect scroll content.
    const safeAreaEnd = code.indexOf('</SafeAreaView>');
    const dropdownAt = code.indexOf('<JotinhaPlanDropdown');
    expect(safeAreaEnd).toBeGreaterThan(0);
    expect(dropdownAt).toBeGreaterThan(safeAreaEnd);
  });

  it('hides Jotinha once the scroll leaves the top, and only shows him again near the top', () => {
    expect(code).toContain('onScroll={handleScroll}');
    expect(code).toContain('setJotinhaVisible');
  });

  it('never reintroduces narration lines, a speech component, or a dropdown "entries" prop', () => {
    expect(code).not.toContain('AjSpeechText');
    expect(code).not.toContain('narrationLines');
    expect(code).not.toContain('narrationEntries');
    expect(code).not.toMatch(/<JotinhaPlanDropdown[^>]*entries=/);
  });
});

describe('JotinhaPlanDropdown — presentation only, no speech', () => {
  it('never renders a speech bubble, typed text, or a tap-to-open affordance', () => {
    expect(dropdownCode).not.toContain('AjSpeechText');
    expect(dropdownCode).not.toContain('resolveNarrationTap');
    expect(dropdownCode).not.toContain('handleTap');
    expect(dropdownCode).not.toContain('handleOpen');
    expect(dropdownCode).not.toContain('Pressable');
  });

  it('plays exactly one arrival hop, once on mount, never retriggered by prop changes', () => {
    expect(dropdownCode).toContain('animation.start(() => aj.play(\'hop\'));');
    // Empty dependency array — the effect that starts it runs once per mount.
    expect(dropdownCode).toMatch(/animation\.start\(\(\) => aj\.play\('hop'\)\);[\s\S]*?\n\s*\}, \[\]\);/);
  });

  it('reserves an empty slot and measures it in the window, exactly like the previous layout did', () => {
    expect(dropdownCode).toContain('slotRef.current?.measureInWindow((x, y, width, height) => {');
    expect(dropdownCode).toContain('aj.direct({ x, y, size: Math.min(width, height), rotate: 0 });');
    expect(dropdownCode).not.toMatch(/top:\s*Math\.max\(insets\.top/);
  });

  it('hides the shared mascot under Reduce Motion or once scrolled out of the header, never leaving him unpositioned on screen', () => {
    expect(dropdownCode).toContain('aj.setVisible(!reduceMotion && visible);');
    expect(dropdownCode).toContain('if (reduceMotion) return null;');
  });

  it('the only call to aj.setVisible combines Reduce Motion with the header-scroll visibility flag', () => {
    const setVisibleCalls = dropdownCode.match(/aj\.setVisible\(/g) ?? [];
    expect(setVisibleCalls).toHaveLength(1);
  });
});

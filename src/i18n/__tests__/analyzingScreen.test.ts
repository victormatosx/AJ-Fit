import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/onboarding.json';
import es from '../resources/es/onboarding.json';
import ptBR from '../resources/pt-BR/onboarding.json';

const screen = readFileSync(new URL('../../screens/AnalyzingScreen.tsx', import.meta.url), 'utf8');

describe('Analyzing screen i18n', () => {
  it('ships title, progress, accessibility and all five steps in every language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.analyzing.compiling).toBeTruthy();
      expect(resource.analyzing.titleLine1).toBeTruthy();
      expect(resource.analyzing.titleLine2).toBeTruthy();
      expect(Object.values(resource.analyzing.steps)).toHaveLength(5);
      expect(Object.values(resource.analyzing.steps).every(Boolean)).toBe(true);
      expect(resource.analyzing.accessibility.progress).toContain('{{progress}}');
    }
  });

  it('ships one spoken line per step plus the completion line, in every language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.analyzing.completed).toBeTruthy();
      for (const key of Object.keys(resource.analyzing.steps)) {
        expect(resource.analyzing.speech[key as keyof typeof resource.analyzing.speech]).toBeTruthy();
      }
      expect(resource.analyzing.speech.done).toBeTruthy();
      for (const state of ['stepDone', 'stepActive', 'stepPending'] as const) {
        expect(resource.analyzing.accessibility[state]).toContain('{{label}}');
      }
    }
  });

  it('uses onboarding translation keys without former visible hardcodes', () => {
    for (const key of [
      'analyzing.compiling',
      'analyzing.completed',
      'analyzing.titleLine1',
      'analyzing.titleLine2',
      // Step labels and the line AJ says about each one are both addressed
      // through `STEP_KEYS`, so the literal prefixes are what the screen holds.
      'analyzing.steps.',
      'analyzing.speech.',
      'analyzing.speech.done',
      'analyzing.accessibility.progress',
      'analyzing.accessibility.stepDone',
      'analyzing.accessibility.stepActive',
      'analyzing.accessibility.stepPending',
      'analyzing.error.reviewAnswers',
    ]) expect(screen).toContain(key);

    for (const key of ['profile', 'volume', 'exercises', 'periodization', 'plan']) {
      expect(screen).toContain(`'${key}'`);
    }

    for (const hardcode of [
      'Lendo seu perfil físico',
      'Calculando volume e intensidade',
      'Selecionando exercícios ideais',
      'Periodizando suas semanas',
      'Montando seu plano premium',
      '>COMPILANDO<',
      "MONTANDO{'\\n'}SEU PLANO",
    ]) expect(screen).not.toContain(hardcode);
  });

  it('preserves timing, progress and completion behavior', () => {
    expect(screen).toContain('return p + 1');
    expect(screen).toContain('}, 52)');
    expect(screen).toContain('setTimeout(onDone, 700)');
    expect(screen).toContain('duration: 900');
    expect(screen).toContain('useNativeDriver: true');
  });

  it('presents the ring with AJ inside it and keeps the answer-review escape hatch', () => {
    expect(screen).toContain('<AnalysisAjRing');
    // The celebration occupies the 700ms that already existed; completion is
    // never declared on the timer alone.
    expect(screen).toContain("const completed = progress >= 100 && computeStatus === 'success'");
    expect(screen).toContain('onPress={onReviewAnswers}');
    expect(screen).toContain('accessibilityLiveRegion="polite"');
    // No fabricated per-step readouts: the prototype's invented values stay
    // out of what is rendered (the comment explaining why they're absent is
    // allowed to name them).
    const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/IMC|kcal|exercícios/);
  });
});

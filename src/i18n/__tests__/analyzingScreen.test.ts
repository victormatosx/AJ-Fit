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

  it('uses onboarding translation keys without former visible hardcodes', () => {
    for (const key of [
      'analyzing.compiling',
      'analyzing.titleLine1',
      'analyzing.titleLine2',
      'analyzing.steps.profile',
      'analyzing.steps.volume',
      'analyzing.steps.exercises',
      'analyzing.steps.periodization',
      'analyzing.steps.plan',
      'analyzing.accessibility.progress',
    ]) expect(screen).toContain(key);

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
    expect(screen).toContain('<CircularProgressRing');
    expect(screen).toContain('pulseGlow');
    expect(screen).toContain('duration: 900');
    expect(screen).toContain('useNativeDriver: true');
  });
});

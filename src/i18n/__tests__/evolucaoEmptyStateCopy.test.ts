import { describe, expect, it } from 'vitest';
import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

describe('Evolução locked-preview copy', () => {
  it('matches the required pt-BR copy exactly', () => {
    expect(ptBR.progress.body.empty.title).toBe('Desbloqueie sua evolução corporal');
    expect(ptBR.progress.body.empty.description).toBe(
      'Faça sua primeira avaliação física para acompanhar suas mudanças ao longo do tempo.',
    );
    expect(ptBR.progress.body.empty.cta).toBe('Fazer avaliação');
    expect(ptBR.progress.loads.empty.title).toBe('Sua evolução começa aqui');
    expect(ptBR.progress.loads.empty.description).toBe(
      'Registre as cargas dos seus exercícios para acompanhar sua força e seus recordes pessoais.',
    );
    expect(ptBR.progress.loads.empty.cta).toBe('Iniciar treino');
  });

  it('removes the now-orphaned loads.empty.hint key everywhere', () => {
    expect((ptBR.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
    expect((en.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
    expect((es.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
  });

  it('keeps all three locales structurally parallel for the touched keys', () => {
    [en, es, ptBR].forEach((locale) => {
      expect(typeof locale.progress.body.empty.title).toBe('string');
      expect(typeof locale.progress.body.empty.description).toBe('string');
      expect(typeof locale.progress.body.empty.cta).toBe('string');
      expect(typeof locale.progress.loads.empty.title).toBe('string');
      expect(typeof locale.progress.loads.empty.description).toBe('string');
      expect(typeof locale.progress.loads.empty.cta).toBe('string');
    });
  });
});

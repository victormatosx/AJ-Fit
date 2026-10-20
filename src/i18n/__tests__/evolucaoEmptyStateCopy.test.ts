import { describe, expect, it } from 'vitest';
import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

describe('Evolução empty-state copy', () => {
  it('matches the required pt-BR copy exactly', () => {
    // Corpo's `empty.title/description/cta` still belong to the locked
    // preview — the sub-section lock that covers composition when health
    // weight is synced but no assessment exists. The full empty panel has
    // its own headline/body/action below.
    expect(ptBR.progress.body.empty.title).toBe('Desbloqueie sua evolução corporal');
    expect(ptBR.progress.body.empty.description).toBe(
      'Faça sua primeira avaliação física para acompanhar suas mudanças ao longo do tempo.',
    );
    expect(ptBR.progress.body.empty.cta).toBe('Fazer avaliação');

    expect(ptBR.progress.body.empty.headline).toBe('Registre sua primeira avaliação');
    expect(ptBR.progress.body.empty.body).toBe(
      'Peso, medidas e composição corporal. A cada nova avaliação, você vê o quanto mudou.',
    );
    expect(ptBR.progress.body.empty.action).toBe('Registrar avaliação');
    expect(ptBR.progress.body.empty.chartNote).toBe('O gráfico aparece a partir da 2ª avaliação');

    expect(ptBR.progress.loads.empty.eyebrow).toBe('Mapa de força');
    expect(ptBR.progress.loads.empty.title).toBe('Seu mapa começa no primeiro treino');
    expect(ptBR.progress.loads.empty.description).toBe(
      'Registre as cargas durante o treino e o mapa mostra quais músculos estão ficando mais fortes.',
    );
    expect(ptBR.progress.loads.empty.cta).toBe('Iniciar treino');
    expect(ptBR.progress.loads.empty.howItWorks).toBe('Como funciona');
    expect(Object.values(ptBR.progress.loads.empty.steps)).toEqual([
      'Inicie um treino da sua sequência',
      'Registre carga e repetições em cada série',
      'Ao repetir um exercício, a evolução aparece aqui',
    ]);
  });

  it('removes the now-orphaned loads.empty.hint key everywhere', () => {
    expect((ptBR.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
    expect((en.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
    expect((es.progress.loads.empty as Record<string, unknown>).hint).toBeUndefined();
  });

  it('keeps all three locales structurally parallel for the touched keys', () => {
    [en, es, ptBR].forEach((locale) => {
      expect(typeof locale.progress.noRecord).toBe('string');

      expect(typeof locale.progress.body.empty.title).toBe('string');
      expect(typeof locale.progress.body.empty.description).toBe('string');
      expect(typeof locale.progress.body.empty.cta).toBe('string');
      expect(typeof locale.progress.body.empty.headline).toBe('string');
      expect(typeof locale.progress.body.empty.body).toBe('string');
      expect(typeof locale.progress.body.empty.action).toBe('string');
      expect(typeof locale.progress.body.empty.weightSection).toBe('string');
      expect(typeof locale.progress.body.empty.chartNote).toBe('string');
      expect(typeof locale.progress.body.empty.noRecords).toBe('string');

      expect(typeof locale.progress.loads.empty.title).toBe('string');
      expect(typeof locale.progress.loads.empty.description).toBe('string');
      expect(typeof locale.progress.loads.empty.cta).toBe('string');
      expect(typeof locale.progress.loads.empty.eyebrow).toBe('string');
      expect(typeof locale.progress.loads.empty.howItWorks).toBe('string');
      expect(typeof locale.progress.loads.empty.noRecords).toBe('string');
      expect(Object.values(locale.progress.loads.empty.steps)).toHaveLength(3);
      expect(locale.progress.loads.empty.accessibility.step).toContain('{{number}}');
      expect(locale.progress.loads.empty.accessibility.step).toContain('{{text}}');
    });
  });
});

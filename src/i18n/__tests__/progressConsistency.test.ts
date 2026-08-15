import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const progress = read('screens/ProgressScreen.tsx');
const consistency = read('screens/ConsistencyScreen.tsx');

const body = read('components/fitness/BodyEvolutionView.tsx');

describe('Progress and monthly consistency i18n', () => {
  it('ships complete copy in every supported language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(Object.values(resource.progress.tabs).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.body.metrics).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.body.empty).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.loads.empty).every(Boolean)).toBe(true);
      expect(resource.progress.body.measuredAt).toContain('{{date}}');
      expect(Object.values(resource.monthlyConsistency.legend).every(Boolean)).toBe(true);
      expect(resource.monthlyConsistency.progress).toContain('{{done}}');
      expect(resource.monthlyConsistency.monthYear).toContain('{{year}}');
    }
  });

  it('uses semantic translation keys instead of the former visible hardcodes', () => {
    for (const key of [
      'progress.header.title',
      'progress.tabs.body',
      'progress.tabs.loads',
      'progress.tabs.photos',
      'progress.loads.empty.title',
      'progress.accessibility.selectTab',
    ]) expect(progress).toContain(key);

    for (const key of [
      'progress.body.currentWeight',
      'progress.body.composition',
      'progress.body.measuredAt',
      'progress.body.metrics.bodyFat',
      'progress.body.empty.title',
      'progress.body.openAssessment',
    ]) expect(body).toContain(key);

    for (const hardcode of [
      'EVOLUÇÃO · ÚLTIMOS 90 DIAS',
      'CALENDÁRIO DE CONSISTÊNCIA',
      'RECORDES RECENTES',
      'SUPINO RETO · CARGA MÁX',
      'ARRASTE SUAS FOTOS DE PROGRESSO PARA OS QUADROS',
    ]) expect(progress).not.toContain(hardcode);
  });

  it('localizes month, plurals, progress sentence, legend and back accessibility', () => {
    for (const key of [
      'monthlyConsistency.title',
      'monthlyConsistency.monthYear',
      'monthlyConsistency.daysRemaining',
      'monthlyConsistency.pendingWorkouts',
      'monthlyConsistency.progress',
      'monthlyConsistency.legend.done',
      'monthlyConsistency.accessibility.back',
    ]) expect(consistency).toContain(key);

    for (const hardcode of [
      'CONSISTÊNCIA MENSAL',
      'FALTA PARA FECHAR O MÊS',
      'Treino feito',
      'A fazer',
    ]) expect(consistency).not.toContain(hardcode);
  });

  it('derives the body panel from real assessments instead of fixed samples', () => {
    // The screen used to ship hardcoded sample series. It now reads the same
    // hook the assessment area uses, so every number belongs to the user.
    expect(progress).toContain("from '../hooks/useAssessments'");
    expect(progress).toContain('useAssessments(user?.uid ?? null)');
    expect(progress).not.toMatch(/const pointsKg = \[/);
    expect(body).not.toMatch(/const pointsKg = \[/);

    // Weights are converted through the shared unit helpers, never printed raw.
    expect(body).toContain('formatWeightFromKg(latest.weight, resolvedUnits)');
    expect(body).toContain('weightFromKg(entry.weight, resolvedUnits)');
  });

  it('keeps the photos panel mounted exclusively, so leaving it locks the vault', () => {
    // `ProgressPhotosScreen` locks the vault on unmount. Rendering it beside
    // the other panels instead of instead of them would leave the vault open.
    expect(progress).toContain("view === 'photos' ? (");
    expect(progress).toContain('<ProgressPhotosScreen pageHeader={pageHeader} />');
  });

  it('preserves calendar data mechanics', () => {
    expect(consistency).toContain('const DAYS = 31');
    expect(consistency).toContain('const FIRST_WD = 2');
    expect(consistency).toContain('const TODAY = 16');
    expect(consistency).toContain('const MISSED = [9]');
  });
});

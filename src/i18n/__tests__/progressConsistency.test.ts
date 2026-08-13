import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const progress = read('screens/ProgressScreen.tsx');
const consistency = read('screens/ConsistencyScreen.tsx');

describe('Progress and monthly consistency i18n', () => {
  it('ships complete copy in every supported language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(Object.values(resource.progress.tabs).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.charts).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.records).every(Boolean)).toBe(true);
      expect(Object.values(resource.monthlyConsistency.legend).every(Boolean)).toBe(true);
      expect(resource.monthlyConsistency.progress).toContain('{{done}}');
      expect(resource.monthlyConsistency.monthYear).toContain('{{year}}');
    }
  });

  it('uses semantic translation keys instead of the former visible hardcodes', () => {
    for (const key of [
      'progress.header.period',
      'progress.tabs.loads',
      'progress.charts.loadTitle',
      'progress.heatmap.title',
      'progress.records.title',
      'progress.photos.hint',
      'progress.accessibility.selectTab',
    ]) expect(progress).toContain(key);

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

  it('preserves chart and calendar data mechanics', () => {
    expect(progress).toContain('const pointsKg = [40, 45, 42, 50, 55, 53, 60, 65, 63, 70, 75, 82]');
    expect(progress).toContain('const pointsKg = [82, 81.6, 81.2, 80.8, 80.3, 79.9, 79.5, 79.0, 78.6, 78.2, 78.0, 77.6]');
    expect(progress).toContain('pointsKg.map((value) => weightFromKg(value, resolvedUnits))');
    expect(consistency).toContain('const DAYS = 31');
    expect(consistency).toContain('const FIRST_WD = 2');
    expect(consistency).toContain('const TODAY = 16');
    expect(consistency).toContain('const MISSED = [9]');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/home.json';
import es from '../resources/es/home.json';
import ptBR from '../resources/pt-BR/home.json';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const progress = read('screens/ProgressScreen.tsx');
const appShell = read('screens/AppShell.tsx');
const home = read('screens/HomeScreen.tsx');

const body = read('components/fitness/BodyEvolutionView.tsx');
const loads = read('components/fitness/LoadsEvolutionView.tsx');

describe('Progress truthfulness and retired consistency preview', () => {
  it('ships complete copy in every supported language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(Object.values(resource.progress.tabs).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.body.metrics).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.body.empty).every(Boolean)).toBe(true);
      expect(Object.values(resource.progress.loads.empty).every(Boolean)).toBe(true);
      expect(resource.progress.body.measuredAt).toContain('{{date}}');
    }
  });

  it('uses semantic translation keys instead of the former visible hardcodes', () => {
    for (const key of [
      'progress.header.title',
      'progress.tabs.body',
      'progress.tabs.loads',
      'progress.tabs.photos',
      'progress.accessibility.selectTab',
    ]) expect(progress).toContain(key);

    for (const key of [
      'progress.loads.empty.title',
      'progress.loads.records90Title',
      'progress.loads.searchPlaceholder',
      'progress.loads.seeAllRecords',
    ]) expect(loads).toContain(key);

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

  it('does not expose the fixed monthly calendar or fake upcoming list in production navigation', () => {
    expect(appShell).not.toContain("from './ConsistencyScreen'");
    expect(appShell).not.toContain('showCal');
    expect(home).not.toContain('onOpenConsistency');
    expect(home).not.toContain('UPCOMING_KEYS');
  });

  it('derives the body panel from real assessments and imported health weights instead of fixed samples', () => {
    // The screen used to ship hardcoded sample series. It now reads the same
    // hook the assessment area uses, so every number belongs to the user.
    expect(progress).toContain("from '../hooks/useAssessments'");
    expect(progress).toContain('useAssessments(user?.uid ?? null)');
    expect(progress).toContain("from '../hooks/useHealthWeightSamples'");
    expect(progress).not.toMatch(/const pointsKg = \[/);
    expect(body).not.toMatch(/const pointsKg = \[/);

    // Weights are converted through the shared unit helpers, never printed raw.
    expect(body).toContain('formatWeightFromKg(latestWeight.weightKg, resolvedUnits)');
    expect(body).toContain('weightFromKg(entry.weightKg, resolvedUnits)');
  });

  it('shows real imported health weight even without an assessment, but locks composition separately', () => {
    // Weight and composition lock independently: imported health weight
    // alone unlocks the weight section, while composition (assessment-only
    // data) stays demo-and-blurred until a real assessment exists.
    expect(body).toContain('hasRealAssessment');
    expect(body).toContain('hasAnyRealWeight');
    expect(body).toContain('hasImportedWeights');
    expect(body).toContain('fillHeight={false}');
  });

  it('derives the loads panel from persisted workout executions instead of previews', () => {
    expect(progress).toContain("from '../loadProgress/LoadProgressContext'");
    expect(progress).toContain('useLoadProgressState()');
    expect(progress).not.toContain('PROGRESS_LOADS_PREVIEW');
  });

  it('keeps the photos panel mounted exclusively, so leaving it locks the vault', () => {
    // `ProgressPhotosScreen` locks the vault on unmount. Rendering it beside
    // the other panels instead of instead of them would leave the vault open.
    expect(progress).toContain("view === 'photos' ? (");
    // Photos shares the exact same blue pill selector as Corpo/Cargas —
    // no separate header implementation for it anymore.
    expect(progress).toContain('<ProgressPhotosScreen pageHeader={panelHeader} />');
  });

});

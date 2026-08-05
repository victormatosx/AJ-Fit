import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/assessment.json';
import es from '../resources/es/assessment.json';
import ptBR from '../resources/pt-BR/assessment.json';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const screen = read('screens/AssessmentScreen.tsx');
const structuralScreen = screen.slice(0, screen.indexOf('function MeasureField'));
const action = read('components/fitness/AssessmentActionCard.tsx');
const summary = read('components/fitness/PhysicalAssessmentSummaryCard.tsx');
const evolution = read('components/fitness/AssessmentEvolutionCard.tsx');
const history = read('components/fitness/AssessmentHistoryCard.tsx');
const chart = read('components/fitness/EvolutionLineChart.tsx');

describe('Assessment structure resources and consumers', () => {
  it('ships principal, action, summary, evolution, history, metric and state copy', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.header.title).toBeTruthy();
      expect(resource.actions.guided.title).toBeTruthy();
      expect(resource.actions.import.title).toBeTruthy();
      expect(resource.summary.lastAssessmentLabel).toContain('{{date}}');
      expect(resource.evolution.viewHistoryCta).toBeTruthy();
      expect(resource.history.empty.title).toBeTruthy();
      expect(Object.values(resource.metrics).every(Boolean)).toBe(true);
      expect(resource.loading.title).toBeTruthy();
      expect(resource.errors.loadFailedTitle).toBeTruthy();
      expect(Object.values(resource.accessibility).every(Boolean)).toBe(true);
    }
  });

  it('uses translations for every structural screen section and visible state', () => {
    for (const key of [
      'header.title', 'sections.evolution', 'sections.basicInfo', 'sections.skinfolds',
      'sections.add', 'sections.history', 'summary.emptyCta', 'loading.title',
      'errors.loadFailedTitle', 'history.empty.title',
    ]) expect(screen).toContain(key);

    for (const hardcode of [
      'title="EVOLUÇÃO"', 'title="INFORMAÇÕES BÁSICAS"', 'title="DOBRAS CUTÂNEAS"',
      'title="ADICIONAR AVALIAÇÃO"', 'title="HISTÓRICO"', 'label="PESO"', 'label="ALTURA"',
      'Nenhuma avaliação registrada', 'TENTAR NOVAMENTE',
    ]) expect(structuralScreen).not.toContain(hardcode);
  });

  it('connects cards and chart accessibility to assessment keys without raw-key UI', () => {
    expect(action).toContain("t('actions.guided.title')");
    expect(action).toContain("t('accessibility.openGuided')");
    expect(summary).toContain("t('summary.lastAssessmentLabel'");
    expect(evolution).toContain("t('accessibility.evolutionCard')");
    expect(history).toContain("t('accessibility.openAssessment'");
    expect(chart).toContain("t('accessibility.chart'");
    for (const source of [screen, action, summary, evolution, history, chart]) {
      expect(source).not.toMatch(/>\s*assessment:[\w.]+\s*</);
    }
  });
});

describe('Assessment permanent structure regression guard', () => {
  it('preserves query, ordering, callback values and persistence calls', () => {
    expect(screen).toContain('useAssessments(user?.uid ?? null)');
    expect(screen).toContain('const chronological = [...assessments].reverse()');
    expect(screen).toContain('showFullHistory ? historyRows : historyRows.slice(0, 3)');
    expect(screen).toContain('onSave={saveGuided}');
    expect(screen).toContain('onSave={saveImported}');
    expect(screen.match(/await onSave\(\{/g)).toHaveLength(2);
  });

  it('keeps formulas and protocol mechanics while 8C uses visual mappings', () => {
    for (const token of [
      'computeBmi', 'computeFatMass', 'computeGuidedBodyFat', 'computeLeanMass',
      'SKINFOLD_PROTOCOLS', 'isValidAge', 'isFutureDate',
      'SITE_TRANSLATION_KEYS', 'PROTOCOL_TRANSLATION_KEYS', 'classifications.bmi',
    ]) expect(screen).toContain(token);
  });
});

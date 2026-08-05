import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/assessment.json';
import es from '../resources/es/assessment.json';
import ptBR from '../resources/pt-BR/assessment.json';
import {
  SITE_LABELS,
  SKINFOLD_PROTOCOLS,
  bodyDensityJP3,
  bodyDensityJP7,
  computeBmi,
  computeFatMass,
  computeLeanMass,
  siriBodyFat,
  type SiteKey,
} from '../../lib/skinfoldCalculator';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const screen = read('screens/AssessmentScreen.tsx');
const history = read('components/fitness/AssessmentHistoryCard.tsx');
const evolution = read('components/fitness/AssessmentEvolutionCard.tsx');
const chart = read('components/fitness/EvolutionLineChart.tsx');
const service = read('services/assessments.ts');
const hook = read('hooks/useAssessments.ts');
const calculator = read('lib/skinfoldCalculator.ts');

describe('Assessment domain presentation resources', () => {
  it('ships every real protocol, skinfold, result, classification, history and chart label', () => {
    for (const resource of [ptBR, en, es]) {
      expect(Object.keys(resource.protocols)).toEqual(['jp3', 'jp7']);
      expect(Object.keys(resource.skinfolds)).toEqual([
        'chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh',
      ]);
      expect(Object.values(resource.protocols).every(Boolean)).toBe(true);
      expect(Object.values(resource.skinfolds).every(Boolean)).toBe(true);
      expect(Object.values(resource.results).every(Boolean)).toBe(true);
      expect(Object.values(resource.classifications.bmi).every(Boolean)).toBe(true);
      expect(Object.values(resource.history.details).every(Boolean)).toBe(true);
      expect(Object.values(resource.charts).every(Boolean)).toBe(true);
    }
  });

  it('maps stable site and protocol ids to visual translations only', () => {
    expect(screen).toContain('SITE_TRANSLATION_KEYS: Record<SiteKey');
    expect(screen).toContain('PROTOCOL_TRANSLATION_KEYS: Record<SkinfoldProtocolId');
    expect(screen).not.toMatch(/SITE_LABELS\[[^\]]+\]/);
    expect(screen).not.toMatch(/resolveProtocolLabel|proto\.label|>\{p\.label\}</);
    for (const id of ['jp3', 'jp7']) expect(screen).toContain(`${id}: 'protocols.${id}'`);
  });

  it('translates calculated-result labels and existing BMI classifications', () => {
    for (const key of [
      'results.automaticBmi', 'results.title', 'metrics.bodyFat', 'metrics.leanMass',
      'metrics.fatMass', 'metrics.bmi', 'classifications.bmi.',
    ]) expect(screen).toContain(key);
    expect(screen).not.toMatch(/IMC AUTOMÁTICO|label="% GORDURA"|label="MASSA MAGRA"|label="MASSA GORDA"/);
    expect(screen).toContain("{ max: 18.5, classification: 'underweight'");
    expect(screen).toContain("{ max: 25, classification: 'normal'");
    expect(screen).toContain("{ max: 30, classification: 'overweight'");
    expect(screen).toContain("{ max: Infinity, classification: 'obesity'");
  });

  it('uses complete translated history-detail sentences without translation concatenation', () => {
    expect(history).toContain('history.details.availableProtocolImported');
    expect(history).toContain('history.details.unavailableProtocolImported');
    expect(history).not.toContain('history.expanded.');
    expect(history).not.toMatch(/t\([^\n]+\)\s*\+/);
  });

  it('keeps chart labels, empty states, dates and accessibility localized', () => {
    expect(evolution).toContain("t('charts.weightEmpty')");
    expect(evolution).toContain("t('charts.bodyFatEmpty')");
    expect(chart).toContain("t('accessibility.chart'");
    expect(screen).toContain('formatAssessmentShortDateForLocale(a.measuredAt.toDate(), i18n.language)');
    expect(screen).toContain('formatAssessmentDate(a.measuredAt, todayLabel, i18n.language)');
  });
});

describe('Assessment immutable domain guard', () => {
  it('keeps SITE_LABELS keys, protocol ids and site order exactly unchanged', () => {
    expect(Object.keys(SITE_LABELS)).toEqual([
      'chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh',
    ] satisfies SiteKey[]);
    expect(SKINFOLD_PROTOCOLS.map((p) => ({ id: p.id, m: p.sitesFor('m'), f: p.sitesFor('f') }))).toEqual([
      { id: 'jp7', m: ['chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh'], f: ['chest', 'axilla', 'tricep', 'subscap', 'abdom', 'supra', 'thigh'] },
      { id: 'jp3', m: ['chest', 'abdom', 'thigh'], f: ['tricep', 'supra', 'thigh'] },
    ]);
  });

  it('keeps formula outputs identical for fixed inputs', () => {
    expect(bodyDensityJP3(60, 27, 'f')).toBeCloseTo(1.0444397, 7);
    expect(bodyDensityJP7(87, 27, 'm')).toBeCloseTo(1.0705358, 7);
    expect(siriBodyFat(1.05)).toBeCloseTo(21.4285714, 6);
    expect(computeBmi(60, 165)).toBeCloseTo(22.0385675, 6);
    expect(computeLeanMass(60, 20)).toBe(48);
    expect(computeFatMass(60, 20)).toBe(12);
  });

  it('keeps payload, writers, queries and services free of translated labels', () => {
    expect(service).not.toMatch(/useTranslation|i18n|protocols\.|skinfolds\./);
    expect(hook).not.toMatch(/useTranslation|i18n/);
    for (const token of [
      "source: 'guided'", "source: 'imported'", 'protocol: input.protocol',
      'folds,', 'bodyFat: input.bodyFat', 'Timestamp.fromDate(measuredAt)',
      "orderBy('measuredAt', 'desc')", "orderBy('createdAt', 'desc')",
    ]) expect(service).toContain(token);
    expect(calculator).toContain('495 / density - 450');
  });

  it('does not render raw assessment keys', () => {
    for (const source of [screen, history, evolution, chart]) {
      expect(source).not.toMatch(/>\s*assessment:[\w.]+\s*</);
    }
  });
});

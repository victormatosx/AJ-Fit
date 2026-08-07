import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/assessment.json';
import es from '../resources/es/assessment.json';
import ptBR from '../resources/pt-BR/assessment.json';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const screen = read('screens/AssessmentScreen.tsx');
const guided = screen.slice(screen.indexOf('function GuidedAssessmentModal'), screen.indexOf('function ImportAssessmentModal'));
const imported = screen.slice(screen.indexOf('function ImportAssessmentModal'));
const dateFields = read('components/ui/DateFieldsInput.tsx');
const service = read('services/assessments.ts');
const calculator = read('lib/skinfoldCalculator.ts');

describe('Assessment form resources', () => {
  it('has labels, placeholders, units, validation, actions, feedback and accessibility in every language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(resource.guided.title).toBeTruthy();
      expect(resource.import.title).toBeTruthy();
      expect(resource.fields.measurementDate.label).toBeTruthy();
      expect(resource.fields.notes.placeholder).toBeTruthy();
      expect(Object.values(resource.units).every(Boolean)).toBe(true);
      expect(resource.result).toBe('{{value}} {{unit}}');
      expect(resource.validation.guidedRequired).toBeTruthy();
      expect(resource.validation.importRequired).toBeTruthy();
      expect(resource.actions.saveGuided).toBeTruthy();
      expect(resource.actions.registerImported).toBeTruthy();
      expect(resource.success.refreshMessage).toBeTruthy();
      expect(resource.errors.saveFailedMessage).toBeTruthy();
      expect(resource.accessibility.saveGuided).toBeTruthy();
      expect(resource.accessibility.saveImported).toBeTruthy();
    }
  });

  it('keeps mass units interpolated instead of embedding kg in result copy', () => {
    for (const resource of [ptBR, en, es]) {
      const details = Object.values(resource.history.details).join(' ');
      expect(details).not.toMatch(/\bkg\b/);
      expect(details).not.toContain('{{unit}}');
    }
  });

  it('migrates the guided form copy without changing protocol mechanics', () => {
    for (const key of [
      'guided.title', 'guided.basicInfoSection', 'fields.measurementDate.label',
      'fields.weight.label', 'fields.height.label', 'fields.ageAtAssessment.label',
      'guided.sexLabel', 'guided.protocolLabel', 'guided.selectSexHint',
      'validation.guidedRequired', 'actions.saveGuided', 'guided.saving',
      'success.guidedTitle', 'errors.saveFailedTitle', 'accessibility.saveGuided',
    ]) expect(screen).toContain(key);
    expect(guided).toContain('SKINFOLD_PROTOCOLS.map');
    expect(guided).toContain('SITE_TRANSLATION_KEYS[s]');
    expect(guided).toContain('PROTOCOL_TRANSLATION_KEYS[p.id]');
  });

  it('migrates every imported form label, placeholder, unit and controlled message', () => {
    for (const key of [
      'import.title', 'import.description', 'import.resultsSection',
      'fields.measurementDate.label', 'fields.weight.label', 'fields.height.label',
      'fields.bodyFat.label', 'fields.bodyWater.label', 'fields.basalMetabolism.label',
      'fields.visceralFat.label', 'fields.notes.label', 'fields.notes.placeholder',
      'massUnit', 'units.cm', 'units.percent', 'units.kcal',
      'validation.importRequired', 'actions.registerImported', 'import.saving',
      'success.importedTitle', 'errors.saveFailedMessage', 'accessibility.saveImported',
    ]) expect(imported).toContain(key);
    expect(imported).not.toMatch(/Avaliação importada com sucesso|Falha ao salvar|OBSERVAÇÕES \(OPCIONAL\)|Registrar Avaliação/);
  });

  it('uses translated date labels and consumer-provided placeholders', () => {
    expect(dateFields).toContain("useTranslation('common')");
    expect(dateFields).toContain('accessibilityLabel={dayLabel}');
    expect(dateFields).toContain('placeholder={placeholder}');
    expect(guided).toContain("placeholder={t('form.numericPlaceholder')}");
    expect(imported).toContain("placeholder={t('form.numericPlaceholder')}");
  });
});

describe('Assessment permanent form contract guard', () => {
  it('preserves callbacks, payload keys, parsing, dates and double-tap guards', () => {
    expect(screen.match(/if \(saving\) return/g)).toHaveLength(2);
    expect(screen.match(/await onSave\(\{/g)).toHaveLength(2);
    for (const token of [
      'measuredAt: measuredAtFields.date', 'weight: weightKg', 'bodyFat,',
      'protocol: protocolId', 'sex,', 'age: a', 'folds: numericFolds',
      'bodyFat: parsePositive(bodyFat) ?? null', 'bodyWater: parsePositive(bodyWater)',
      'basalMetabolism: parsePositive(basalMetabolism)',
      'visceralFat: parsePositive(visceralFat)', "notes: notes.trim() || undefined",
    ]) expect(screen).toContain(token);
    expect(screen).toContain('closeTimer.current = setTimeout(() => onBack(), 1100)');
  });

  it('does not persist translated labels and keeps the repository contract unchanged', () => {
    expect(service).not.toMatch(/useTranslation|\.t\(|i18n/);
    for (const token of [
      "source: 'guided'", "source: 'imported'", 'Timestamp.fromDate(measuredAt)',
      'createdAt: serverTimestamp()', 'calculatorVersion: 1',
      "orderBy('measuredAt', 'desc')", "orderBy('createdAt', 'desc')",
    ]) expect(service).toContain(token);
  });

  it('keeps validators, formulas and protocol ids intact', () => {
    for (const token of [
      "id: 'jp3'", "id: 'jp7'", 'v > 0', 'age > 0',
      '1.0994921 - 0.0009929 * sumMm', '1.112 - 0.00043499 * sumMm',
      '495 / density - 450', 'heightCm / 100',
    ]) expect(calculator).toContain(token);
  });

  it('does not render raw assessment keys', () => {
    expect(screen).not.toMatch(/>\s*assessment:[\w.]+\s*</);
  });
});

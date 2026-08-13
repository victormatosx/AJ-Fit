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
const nativeDatePicker = read('components/ui/NativeDatePickerField.tsx');
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
      expect(resource.validation.profileRequired).toBeTruthy();
      expect(resource.validation.importRequired).toBeTruthy();
      expect(resource.validation.heightRequired).toBeTruthy();
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
      'fields.weight.label', 'guided.protocolLabel',
      'validation.guidedRequired', 'actions.saveGuided', 'guided.saving',
      'success.guidedTitle', 'errors.saveFailedTitle', 'accessibility.saveGuided',
    ]) expect(screen).toContain(key);
    expect(guided).toContain('<NativeDatePickerField');
    expect(guided).not.toContain('manualAge');
    expect(guided).not.toContain('setSex');
    expect(guided).not.toContain('fields.ageAtAssessment.label');
    expect(guided).not.toContain('fields.height.label');
    expect(guided).not.toContain('ImperialHeightInput');
    expect(guided).toContain('const heightCm = defaultHeight ?? NaN');
    expect(guided).toContain('SKINFOLD_PROTOCOLS.map');
    expect(guided).toContain('SITE_TRANSLATION_KEYS[s]');
    expect(guided).toContain('PROTOCOL_TRANSLATION_KEYS[p.id]');
  });

  it('migrates every imported form label, placeholder, unit and controlled message', () => {
    for (const key of [
      'import.title', 'import.description', 'import.basicInfoSection', 'import.resultsSection',
      'fields.measurementDate.label', 'fields.weight.label',
      'fields.bodyFat.label', 'fields.bodyWater.label', 'fields.basalMetabolism.label',
      'fields.visceralFat.label', 'fields.notes.label', 'fields.notes.placeholder',
      'massUnit', 'units.percent', 'units.kcal',
      'validation.importRequired', 'actions.registerImported', 'import.saving',
      'success.importedTitle', 'errors.saveFailedMessage', 'accessibility.saveImported',
    ]) expect(imported).toContain(key);
    expect(imported).toContain('<NativeDatePickerField');
    expect(imported).not.toContain('fields.height.label');
    expect(imported).not.toContain('ImperialHeightInput');
    expect(imported).not.toContain('<DateFieldsInput');
    expect(imported).toContain('const heightCm = defaultHeight ?? NaN');
    expect(imported).not.toMatch(/Avaliação importada com sucesso|Falha ao salvar|OBSERVAÇÕES \(OPCIONAL\)|Registrar Avaliação/);
  });

  it('uses translated date labels and consumer-provided placeholders', () => {
    expect(dateFields).toContain("useTranslation('common')");
    expect(dateFields).toContain('accessibilityLabel={dayLabel}');
    expect(dateFields).toContain('placeholder={placeholder}');
    expect(guided).toContain("placeholder={t('form.numericPlaceholder')}");
    expect(imported).toContain("placeholder={t('form.numericPlaceholder')}");
  });

  it('uses the native date picker on iOS and Android with future dates blocked', () => {
    expect(nativeDatePicker).toContain("Platform.OS === 'android'");
    expect(nativeDatePicker).toContain('DateTimePickerAndroid.open');
    expect(nativeDatePicker).toContain("Platform.OS === 'ios'");
    expect(nativeDatePicker).toContain('<DateTimePicker');
    expect(nativeDatePicker).toContain('maximumDate={maximumDate}');
    expect(guided).toContain('onChange={measuredAtFields.setDate}');
    expect(imported).toContain('onChange={measuredAtFields.setDate}');
  });
});

describe('Assessment permanent form contract guard', () => {
  it('preserves callbacks, payload keys, parsing, dates and double-tap guards', () => {
    expect(screen.match(/if \(saving\) return/g)).toHaveLength(2);
    expect(screen.match(/await onSave\(\{/g)).toHaveLength(2);
    for (const token of [
      'measuredAt: measuredAtFields.date', 'weight: weightKg', 'height: heightCm', 'bodyFat,',
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

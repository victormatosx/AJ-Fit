import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ptBR from '../resources/pt-BR/settings.json';
import en from '../resources/en/settings.json';
import es from '../resources/es/settings.json';
import { getUnitsSummaryKey } from '../../units/unitsPresentation';

const SETTINGS_SOURCE = readFileSync(
  resolve(__dirname, '../../screens/SettingsScreen.tsx'),
  'utf8',
);

describe('settings units — presentation', () => {
  it.each([
    ['system', 'metric', 'settings:units.summary.systemMetric'],
    ['system', 'imperial', 'settings:units.summary.systemImperial'],
    ['metric', 'metric', 'settings:units.summary.metric'],
    ['imperial', 'imperial', 'settings:units.summary.imperial'],
  ] as const)('maps %s resolved as %s to %s', (preference, resolved, key) => {
    expect(getUnitsSummaryKey(preference, resolved)).toBe(key);
  });

  it.each([
    ['pt-BR', ptBR, ['Automático', 'Métrico', 'Imperial']],
    ['en', en, ['Automatic', 'Metric', 'Imperial']],
    ['es', es, ['Automático', 'Métrico', 'Imperial']],
  ] as const)('ships all selector options in %s', (_locale, resource, labels) => {
    expect([
      resource.units.options.system.label,
      resource.units.options.metric.label,
      resource.units.options.imperial.label,
    ]).toEqual(labels);
    expect(resource.units.options.system.description.length).toBeGreaterThan(10);
    expect(resource.units.options.metric.description).toBe('kg • cm');
    expect(resource.units.options.imperial.description).toBe('lb • ft/in');
    expect(resource.units.errors.changeFailed.length).toBeGreaterThan(10);
  });

  it('connects the Units item to local and authenticated persistence flows', () => {
    expect(SETTINGS_SOURCE).toContain('setUnitsPickerOpen(true)');
    expect(SETTINGS_SOURCE).toContain('changeUnitsForUser({ uid: user.uid, next })');
    expect(SETTINGS_SOURCE).toContain('writeStoredUnitsPreference(next)');
    expect(SETTINGS_SOURCE).not.toMatch(
      /label: t\('settings:units\.title'\)[\s\S]{0,120}onPress: \(\) => \{\}/,
    );
  });
});

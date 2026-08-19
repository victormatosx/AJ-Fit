import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import ptBR from '../resources/pt-BR/settings.json';
import en from '../resources/en/settings.json';
import es from '../resources/es/settings.json';

const SETTINGS_SOURCE = readFileSync(
  resolve(__dirname, '../../screens/SettingsScreen.tsx'),
  'utf8',
);

describe('Settings theme preference', () => {
  it.each([
    ['pt-BR', ptBR, ['Escuro', 'Claro']],
    ['en', en, ['Dark', 'Light']],
    ['es', es, ['Oscuro', 'Claro']],
  ] as const)('ships only Dark and Light in %s', (_locale, resource, expected) => {
    expect(Object.keys(resource.theme.options)).toEqual(['dark', 'light']);
    expect(Object.values(resource.theme.options)).toEqual(expected);
    expect(JSON.stringify(resource.theme)).not.toMatch(/system|automatic|autom[aá]tico/i);
  });

  it('shows the current local runtime mode and opens the shared-style sheet', () => {
    expect(SETTINGS_SOURCE).toContain('mode: currentTheme');
    expect(SETTINGS_SOURCE).toContain('const themeLabel = themeOptions[currentTheme];');
    expect(SETTINGS_SOURCE).toContain('setThemePickerOpen(true)');
    expect(SETTINGS_SOURCE).toContain('<ThemePickerSheet');
    expect(SETTINGS_SOURCE).toContain('THEME_MODES.map((mode) =>');
  });

  it('changes the runtime immediately through ThemeProvider, never the remote profile', () => {
    const themeHandler = SETTINGS_SOURCE.slice(
      SETTINGS_SOURCE.indexOf('const handleSelectTheme'),
      SETTINGS_SOURCE.indexOf('const handleSelectUnits'),
    );

    expect(themeHandler).toContain('void setTheme(next);');
    expect(SETTINGS_SOURCE).not.toContain('profile?.preferences.theme');
    expect(themeHandler).not.toMatch(/Firestore|updateDoc|userProfile|uid|useAuth/);
  });

  it('exposes accessible, selected radio options for both modes', () => {
    expect(SETTINGS_SOURCE).toContain('accessibilityRole="radio"');
    expect(SETTINGS_SOURCE).toContain('accessibilityState={{ selected: active }}');
    expect(SETTINGS_SOURCE).toContain('testID={`theme-option-${mode}`}');
  });
});

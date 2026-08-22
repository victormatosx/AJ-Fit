import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const SCREEN = read('screens/AssessmentScreen.tsx');
const MODAL = read('components/fitness/AssessmentHistoryModal.tsx');

describe('Assessment full history', () => {
  it('opens the dedicated history from both full-history actions', () => {
    expect(SCREEN.match(/setShowHistoryModal\(true\)/g)).toHaveLength(2);
    expect(SCREEN).toContain('const visibleHistoryRows = historyRows.slice(0, 3)');
    expect(SCREEN).toContain('visible={showHistoryModal}');
    expect(SCREEN).toContain('entries={historyRows}');
  });

  it('renders every entry in a dismissible full-screen native modal', () => {
    expect(MODAL).toContain('presentationStyle="fullScreen"');
    expect(MODAL).toContain('onRequestClose={onClose}');
    expect(MODAL).toContain('entries={entries}');
    expect(MODAL).toContain("t('history.full.title')");
    expect(MODAL).toContain("t('accessibility.closeHistory')");
  });
});

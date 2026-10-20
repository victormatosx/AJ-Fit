import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  AGENDA_MAX_DAYS,
  AGENDA_MIN_DAYS,
  agendaNextWorkoutTarget,
  agendaSelectionChanged,
  agendaSheetWeek,
  agendaSummaryKind,
  sessionLetter,
  sessionSequenceLabel,
} from '../treinoAgendaPresentation';
import { AVAILABLE_FREQUENCIES } from '../../onboarding/weeklyScheduleSelection';
import type { TreinoWeekStripDayViewModel } from '../../home/treinoWeekStrip';
import type { Weekday } from '../../state/AppState';

function stripDay(
  localDate: string,
  weekday: Weekday,
  overrides: Partial<TreinoWeekStripDayViewModel> = {},
): TreinoWeekStripDayViewModel {
  return {
    localDate,
    weekday,
    isToday: false,
    dayNumber: localDate.slice(8, 10),
    isTrainingDay: false,
    glyph: null,
    sessionIndex: null,
    isNextSession: false,
    ...overrides,
  };
}

describe('Agenda sheet presentation', () => {
  it('states the day limits the selection helpers already enforce', () => {
    expect(AGENDA_MIN_DAYS).toBe(Math.min(...AVAILABLE_FREQUENCIES));
    expect(AGENDA_MAX_DAYS).toBe(Math.max(...AVAILABLE_FREQUENCIES));
  });

  it('names sessions with the same A/B/C identity the rest of Treino shows', () => {
    expect(sessionLetter(0)).toBe('A');
    expect(sessionLetter(4)).toBe('E');
    expect(sessionSequenceLabel(4)).toBe('A · B · C · D');
  });

  describe('week grid', () => {
    const stripDays = [
      stripDay('2026-10-05', 'MON', { isToday: true, sessionIndex: 0, isTrainingDay: true }),
      stripDay('2026-10-06', 'TUE'),
      stripDay('2026-10-07', 'WED', { sessionIndex: 1, isTrainingDay: true }),
      stripDay('2026-10-08', 'THU'),
      stripDay('2026-10-09', 'FRI', { sessionIndex: 2, isTrainingDay: true }),
      stripDay('2026-10-10', 'SAT', { sessionIndex: 3, isTrainingDay: true }),
      stripDay('2026-10-11', 'SUN'),
    ];

    it('renders the week strip dates and letters while the selection matches what is saved', () => {
      const days = agendaSheetWeek({ stripDays, todayLocalDate: '2026-10-05', lettersVisible: true });

      expect(days.map((day) => day.dayNumber)).toEqual(['05', '06', '07', '08', '09', '10', '11']);
      expect(days.map((day) => day.letter)).toEqual(['A', null, 'B', null, 'C', 'D', null]);
      expect(days.filter((day) => day.isToday).map((day) => day.weekday)).toEqual(['MON']);
    });

    it('keeps the dates but drops every letter once the selection diverges', () => {
      const days = agendaSheetWeek({ stripDays, todayLocalDate: '2026-10-05', lettersVisible: false });

      expect(days.map((day) => day.dayNumber)).toEqual(['05', '06', '07', '08', '09', '10', '11']);
      expect(days.every((day) => day.letter === null)).toBe(true);
    });

    it('falls back to the real Monday-first week when the overview has not loaded', () => {
      const days = agendaSheetWeek({ stripDays: [], todayLocalDate: '2026-10-07', lettersVisible: true });

      expect(days.map((day) => day.weekday)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      expect(days.map((day) => day.dayNumber)).toEqual(['05', '06', '07', '08', '09', '10', '11']);
      expect(days.filter((day) => day.isToday).map((day) => day.localDate)).toEqual(['2026-10-07']);
      expect(days.every((day) => day.letter === null)).toBe(true);
    });
  });

  describe('selection changed', () => {
    const savedFixed = { scheduleMode: 'fixed' as const, trainingDays: ['MON', 'WED', 'FRI', 'SAT'] as Weekday[], frequency: 4 };
    const savedFlexible = { scheduleMode: 'flexible' as const, trainingDays: [] as Weekday[], frequency: 4 };

    it('reports no change for the very selection it opened with', () => {
      expect(agendaSelectionChanged(
        { scheduleMode: 'fixed', days: 4, trainingDays: ['MON', 'WED', 'FRI', 'SAT'] },
        savedFixed,
      )).toBe(false);
    });

    it('ignores the order the days were tapped in', () => {
      expect(agendaSelectionChanged(
        { scheduleMode: 'fixed', days: 4, trainingDays: ['SAT', 'MON', 'FRI', 'WED'] },
        savedFixed,
      )).toBe(false);
    });

    it('reports a change for the same count on other days', () => {
      expect(agendaSelectionChanged(
        { scheduleMode: 'fixed', days: 4, trainingDays: ['MON', 'WED', 'FRI', 'SUN'] },
        savedFixed,
      )).toBe(true);
    });

    it('reports a change when the day count changes', () => {
      expect(agendaSelectionChanged(
        { scheduleMode: 'fixed', days: 5, trainingDays: ['MON', 'TUE', 'WED', 'FRI', 'SAT'] },
        savedFixed,
      )).toBe(true);
    });

    it('reports a change when the mode itself changes', () => {
      expect(agendaSelectionChanged(
        { scheduleMode: 'flexible', days: 4, trainingDays: null },
        savedFixed,
      )).toBe(true);
      expect(agendaSelectionChanged(
        { scheduleMode: 'fixed', days: 4, trainingDays: ['MON', 'WED', 'FRI', 'SAT'] },
        savedFlexible,
      )).toBe(true);
    });

    it('keeps the flexible mode unchanged unless its frequency moves', () => {
      expect(agendaSelectionChanged(
        { scheduleMode: 'flexible', days: 4, trainingDays: null },
        savedFlexible,
      )).toBe(false);
      expect(agendaSelectionChanged(
        { scheduleMode: 'flexible', days: 5, trainingDays: null },
        savedFlexible,
      )).toBe(true);
    });
  });

  describe('summary kind', () => {
    it('names the limits whenever the selection is not a valid schedule yet', () => {
      expect(agendaSummaryKind({ flexible: false, complete: false, frequencyChanged: true }))
        .toBe('INVALID');
      expect(agendaSummaryKind({ flexible: true, complete: false, frequencyChanged: false }))
        .toBe('INVALID');
    });

    it('describes the flexible mode before anything else', () => {
      expect(agendaSummaryKind({ flexible: true, complete: true, frequencyChanged: false }))
        .toBe('FLEXIBLE');
    });

    it('announces the rebuild only when the frequency really changes', () => {
      expect(agendaSummaryKind({ flexible: false, complete: true, frequencyChanged: true }))
        .toBe('FREQUENCY_CHANGE');
      expect(agendaSummaryKind({ flexible: false, complete: true, frequencyChanged: false }))
        .toBe('DAYS');
    });
  });

  describe('next workout target', () => {
    it("uses today while today's own session is still pending", () => {
      expect(agendaNextWorkoutTarget({ status: 'SESSION_READY', sessionIndex: 2 }))
        .toEqual({ kind: 'TODAY' });
      expect(agendaNextWorkoutTarget({
        status: 'MISSED_SESSION_DECISION_REQUIRED',
        missedSessionIndex: 1,
        calendarSessionIndex: 1,
        missedScheduledDate: '2026-10-16',
      })).toEqual({ kind: 'TODAY' });
    });

    it("uses the engine's own next date on rest, recovery and completed days", () => {
      expect(agendaNextWorkoutTarget({
        status: 'REST_DAY', nextWorkoutDate: '2026-10-19', nextSessionIndex: 0,
      })).toEqual({ kind: 'DATE', localDate: '2026-10-19' });
      expect(agendaNextWorkoutTarget({
        status: 'TODAY_COMPLETED', nextWorkoutDate: '2026-10-20', nextSessionIndex: 1,
      })).toEqual({ kind: 'DATE', localDate: '2026-10-20' });
    });

    it('has nothing to name without a program or a configured schedule', () => {
      expect(agendaNextWorkoutTarget(null)).toBeNull();
      expect(agendaNextWorkoutTarget({ status: 'PROGRAM_NOT_AVAILABLE' })).toBeNull();
      expect(agendaNextWorkoutTarget({ status: 'SCHEDULE_SETUP_REQUIRED' })).toBeNull();
    });
  });
});

describe('Agenda sheet surface', () => {
  const sheet = readFileSync('src/screens/TreinoAgendaSheet.tsx', 'utf8');

  it('keeps every visible string in i18n', () => {
    // Every `<Text>` renders an expression, never bare copy. (`npm run
    // i18n:audit` is the project-wide guard; this keeps the sheet honest on
    // its own.)
    const textChildren = [...sheet.matchAll(/<Text[^>]*>\s*([^<]*)/g)].map(([, child]) => child.trim());
    expect(textChildren.length).toBeGreaterThan(0);
    for (const child of textChildren) {
      expect(child, `literal <Text> copy: ${child}`).toMatch(/^\{/);
    }
  });

  it('keeps the colours theme-aware instead of hardcoding the Dark palette', () => {
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('labels the primary button by what the next tap actually does', () => {
    expect(sheet).toContain("frequencyChanged ? t('agenda.continueAction') : t('agenda.saveShort')");
    expect(sheet).toContain('disabled={!canSubmit}');
  });

  it('shows the division letters only while the selection matches the saved schedule', () => {
    expect(sheet).toContain('const lettersVisible = !flexible && !selectionChanged;');
  });

  it('returns from "Nova divisão" to the sheet with the selection intact', () => {
    // `backToEdit` only flips the step: the selected days live in `value`,
    // which it never touches.
    expect(sheet).toMatch(/const backToEdit = \(\) => \{\s*setError\(false\);\s*setStep\('edit'\);\s*\};/);
    expect(sheet).toContain("onRequestClose={submitting ? undefined : step === 'edit' ? onClose : backToEdit}");
  });

  it('drives the confirmation spinner from the real submitting state', () => {
    expect(sheet).toContain("{submitting ? t('agenda.newSplitGenerating') : t('agenda.newSplitConfirm')}");
    expect(sheet).not.toContain('setTimeout');
  });
});

describe('Agenda copy', () => {
  const languages = ['pt-BR', 'en', 'es'] as const;
  const keys = [
    'sheetHeading', 'sheetInstruction', 'liveInvalidRange', 'liveSameFrequencyNext', 'liveFlexible',
    'freeModeLink', 'fixedModeLink', 'saveShort', 'continueAction', 'dayAccessibilityLabel',
    'newSplitTitle', 'newSplitBackAccessibility', 'frequencyLabel', 'perWeek', 'newSplitConfirm',
    'newSplitBack', 'newSplitGenerating', 'keepsTitle', 'keepsHistory', 'keepsCycle',
    'changesTitle', 'changesExercises', 'changesDays',
  ];

  it.each(languages)('%s carries every agenda key the sheet renders', (language) => {
    const agenda = JSON.parse(
      readFileSync(`src/i18n/resources/${language}/treino.json`, 'utf8'),
    ).agenda as Record<string, string>;

    for (const key of keys) {
      expect(agenda[key], `${language}:agenda.${key}`).toBeTruthy();
    }
  });

  it('keeps the interpolations the sheet passes', () => {
    for (const language of languages) {
      const agenda = JSON.parse(
        readFileSync(`src/i18n/resources/${language}/treino.json`, 'utf8'),
      ).agenda as Record<string, string>;

      expect(agenda.liveInvalidRange).toContain('{{min}}');
      expect(agenda.liveInvalidRange).toContain('{{max}}');
      expect(agenda.liveSameFrequencyNext).toContain('{{count}}');
      expect(agenda.liveSameFrequencyNext).toContain('{{when}}');
      expect(agenda.liveFlexible).toContain('{{sequence}}');
      expect(agenda.dayAccessibilityLabel).toContain('{{weekday}}');
      expect(agenda.dayAccessibilityLabel).toContain('{{day}}');
    }
  });
});

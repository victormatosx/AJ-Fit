import { describe, expect, it } from 'vitest';

import { scheduleEventDocumentId, workoutExecutionDocumentId } from '../identities';

describe('workoutExecutionDocumentId', () => {
  it('reproduces the original id byte-for-byte when occurrence is omitted', () => {
    expect(workoutExecutionDocumentId('wpi_1', 0, '2026-10-03'))
      .toBe('exec_wpi_1_0_2026-10-03');
  });

  it('reproduces the original id byte-for-byte when occurrence is explicitly 1', () => {
    expect(workoutExecutionDocumentId('wpi_1', 0, '2026-10-03', 1))
      .toBe('exec_wpi_1_0_2026-10-03');
  });

  it('appends a distinguishing suffix for occurrence >= 2', () => {
    expect(workoutExecutionDocumentId('wpi_1', 0, '2026-10-03', 2))
      .toBe('exec_wpi_1_0_2026-10-03_o2');
    expect(workoutExecutionDocumentId('wpi_1', 0, '2026-10-03', 3))
      .toBe('exec_wpi_1_0_2026-10-03_o3');
  });

  it('produces distinct ids for every occurrence of an A/B/A/B same-day sequence', () => {
    const date = '2026-10-03';
    const ids = [
      workoutExecutionDocumentId('wpi_1', 0, date, 1), // A occurrence 1
      workoutExecutionDocumentId('wpi_1', 1, date, 1), // B occurrence 1
      workoutExecutionDocumentId('wpi_1', 0, date, 2), // A occurrence 2
      workoutExecutionDocumentId('wpi_1', 1, date, 2), // B occurrence 2
    ];
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([
      'exec_wpi_1_0_2026-10-03',
      'exec_wpi_1_1_2026-10-03',
      'exec_wpi_1_0_2026-10-03_o2',
      'exec_wpi_1_1_2026-10-03_o2',
    ]);
  });
});

describe('scheduleEventDocumentId — untouched by the occurrence fix (MISS_RESOLVED is never tied to a created execution)', () => {
  it('still has no occurrence parameter and keeps its historical id shape', () => {
    expect(scheduleEventDocumentId({
      type: 'MISS_RESOLVED', sessionIndex: 0, scheduledDate: '2026-10-03', programInstanceId: 'wpi_1',
    })).toBe('wpi_1_miss_resolved_0_2026-10-03');
  });
});

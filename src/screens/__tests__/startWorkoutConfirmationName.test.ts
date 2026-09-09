import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

describe('StartWorkoutConfirmation workout name', () => {
  it('uses the scheduled session and the same friendly-name resolver as Home', () => {
    const start = source.indexOf('function StartWorkoutConfirmation({');
    const end = source.indexOf('function TabBar(', start);
    const modal = source.slice(start, end);

    expect(source).toContain("sessionIndex={schedule.resolution.status === 'SESSION_READY'");
    expect(modal).toContain('prescription.plan.sessions[sessionIndex]');
    expect(modal).toContain('resolveSessionDisplayName(');
    expect(modal).not.toContain('`${prescription.plan.templateId} · ${prescription.plan.split}`');
  });
});

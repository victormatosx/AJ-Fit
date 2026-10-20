import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

describe('StartWorkoutConfirmation workout name', () => {
  it('uses the scheduled session and the same friendly-name resolver as Home', () => {
    const start = source.indexOf('function StartWorkoutConfirmation({');
    const end = source.indexOf('function TabBar(', start);
    const modal = source.slice(start, end);

    // Still the Schedule Engine resolution, with exactly one other source:
    // the explicit target used when recovering a missed session, whose
    // rotation pointer has already advanced past the session being trained.
    expect(source).toContain("sessionIndex={startSessionOverride ?? (schedule.resolution.status === 'SESSION_READY'");
    expect(source).toContain('const [startSessionOverride, setStartSessionOverride] = useState<number | null>(null);');
    expect(modal).toContain('prescription.plan.sessions[sessionIndex]');
    expect(modal).toContain('resolveSessionDisplayName(');
    expect(modal).not.toContain('`${prescription.plan.templateId} · ${prescription.plan.split}`');
  });
});

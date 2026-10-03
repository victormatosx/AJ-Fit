import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function RestOverlay({');
const body = source.slice(start, source.indexOf('function PROverlay({', start));

describe('RestOverlay — presentation-only input registration action', () => {
  it('starts clean and resets the presentation state for each set', () => {
    expect(body).toContain('const [hasUnregisteredInput, setHasUnregisteredInput] = useState(false)');
    expect(body).toContain('setHasUnregisteredInput(false);\n  }, [setNumber])');
  });

  it('marks every load/reps input path as needing registration', () => {
    expect(body.match(/setHasUnregisteredInput\(true\)/g)).toHaveLength(6);
    expect(body).toContain('if (regWeight > 0) setHasUnregisteredInput(true)');
    expect(body).toContain('if (regReps != null) setHasUnregisteredInput(true)');
  });

  it('temporarily replaces the timer actions with one REGISTRAR action', () => {
    expect(body).toContain('{hasUnregisteredInput ? (');
    expect(body).toContain("accessibilityLabel={t('rest.registerAccessibility')}");
    expect(body).toContain("{t('rest.register')}");
    expect(body).toContain("accessibilityLabel={t('rest.addSecondsAccessibility', { seconds: 15 })}");
    expect(body).toContain("? t('rest.continueToCardio')");
    expect(body).toContain(": t('rest.nextSet')");
  });

  it('REGISTRAR only acknowledges the local UI and never advances or persists', () => {
    const registerStart = body.indexOf("accessibilityLabel={t('rest.registerAccessibility')}");
    const registerEnd = body.indexOf('</Pressable>', registerStart);
    const register = body.slice(registerStart, registerEnd);
    expect(register).toContain('Keyboard.dismiss()');
    expect(register).toContain('setHasUnregisteredInput(false)');
    expect(register).not.toContain('onSkip');
    expect(register).not.toContain('onSetLogged');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/resources/en/evolution.json';
import es from '../../i18n/resources/es/evolution.json';
import ptBR from '../../i18n/resources/pt-BR/evolution.json';

const read = (path: string) => readFileSync(path, 'utf8');
const card = read('src/components/evolution/EvolutionCard.tsx');
const unlock = read('src/screens/EvolutionUnlockScreen.tsx');
const shell = read('src/screens/AppShell.tsx');
const hook = read('src/workoutEvolution/useWorkoutEvolution.ts');
const home = read('src/screens/HomeScreen.tsx');

describe('Evolution UX component contracts (Node structural fallback)', () => {
  it('shows separate real dimensions and no synthetic progress bar/percentage', () => {
    expect(card).toContain('summary.activeDays');
    expect(card).toContain('summary.sessionsCompleted');
    expect(card).toContain('summary.adherenceQuality');
    expect(card).not.toContain('SegBar');
    expect(card).not.toContain('displayProgress');
    expect(card).not.toContain('consistencyPercent');
  });

  it('keeps Start available for deferred while only Defer is READY-gated', () => {
    expect(unlock).toContain("viewModel.kind === 'EVOLUTION_DEFERRED'");
    const startIndex = unlock.indexOf('onPress={onStart}');
    const deferGateIndex = unlock.indexOf('{isReady ? (', startIndex);
    expect(startIndex).toBeGreaterThan(-1);
    expect(deferGateIndex).toBeGreaterThan(startIndex);
  });

  it('does not close or reload on failed Start/Defer', () => {
    expect(shell).toContain('if (!activated) return;');
    expect(shell).toContain('if (deferred) setShowEvolutionUnlock(false)');
    expect(hook).toContain('if (!user || actionInFlight.current) return false');
  });

  it('persists/reconciles auto explanation and waits for a safe surface', () => {
    expect(hook).toContain('loadUnacknowledgedAutoActivationNotice');
    expect(hook).toContain('acknowledgeAutoActivationNotice');
    expect(hook).toContain('onSnapshot(');
    expect(shell).toContain("tab !== 'workout'");
    expect(shell).toContain('!overlayOpen');
    expect(shell).toContain('!showWorkoutConfirmation');
  });

  it('uses a neutral unavailable state for rollout-off legacy accounts', () => {
    expect(hook).toContain("setViewModel({ kind: 'UNAVAILABLE' })");
    expect(card).toContain("viewModel.kind === 'UNAVAILABLE'");
  });

  it('provides modal/button semantics and reduced-motion behavior', () => {
    expect(unlock).toContain('accessibilityViewIsModal');
    expect(unlock).toContain('accessibilityRole="button"');
    expect(unlock).toContain('accessibilityState={{ busy: actionPending }}');
    expect(shell).toContain("animationType={reduceMotion ? 'none' : 'slide'}");
  });

  it('keeps production Home free of historical fake surfaces', () => {
    for (const marker of ['onOpenConsistency', 'UPCOMING_KEYS', 'weekVolume', 'benchPr', 'nextLevelValue', 'CONSISTENCY_MOCK', 'MOCK_DATE']) {
      expect(home).not.toContain(marker);
    }
  });

  it('keeps UI components free of direct lifecycle persistence calls', () => {
    for (const source of [card, unlock]) {
      expect(source).not.toContain('firebase/firestore');
      expect(source).not.toContain('updateDoc(');
      expect(source).not.toContain('setDoc(');
      expect(source).not.toContain('deleteDoc(');
    }
  });
});

describe('Evolution copy parity and semantic boundaries', () => {
  it('has identical key trees for pt-BR, en and es', () => {
    const leaves = (value: unknown, prefix = ''): string[] => value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];
    expect(leaves(en).sort()).toEqual(leaves(ptBR).sort());
    expect(leaves(es).sort()).toEqual(leaves(ptBR).sort());
  });

  it('keeps renewal neutral and free of achievement/XP promises in every language', () => {
    for (const renewal of [ptBR.motivationalRenewal, en.motivationalRenewal, es.motivationalRenewal]) {
      const copy = JSON.stringify(renewal).toLowerCase();
      for (const forbidden of ['xp', '+250', 'desbloqueado', 'unlocked', 'ganaste', 'conquistou', 'completed cycle', 'ciclo concluído']) {
        expect(copy).not.toContain(forbidden);
      }
    }
  });

  it('contains no physiological percentage, guaranteed result, or future XP copy', () => {
    for (const resource of [ptBR, en, es]) {
      const copy = JSON.stringify(resource).toLowerCase();
      for (const forbidden of ['seu corpo', 'your body', 'tu cuerpo', '+250 xp', 'garantido', 'guaranteed', 'garantizado']) {
        expect(copy).not.toContain(forbidden);
      }
    }
  });
});

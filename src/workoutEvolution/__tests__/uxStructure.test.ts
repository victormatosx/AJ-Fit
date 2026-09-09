import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/resources/en/evolution.json';
import es from '../../i18n/resources/es/evolution.json';
import ptBR from '../../i18n/resources/pt-BR/evolution.json';

const read = (path: string) => readFileSync(path, 'utf8');
const card = read('src/components/evolution/EvolutionCard.tsx');
const ticker = read('src/components/evolution/EvolutionTicker.tsx');
const tickerItems = read('src/workoutEvolution/tickerItems.ts');
const unlock = read('src/screens/EvolutionUnlockScreen.tsx');
const shell = read('src/screens/AppShell.tsx');
const hook = read('src/workoutEvolution/useWorkoutEvolution.ts');
const home = read('src/screens/HomeScreen.tsx');
const profile = read('src/screens/ProfileScreen.tsx');

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
    // `overlayOpen` now folds in the whole start-workout flow (miss decision
    // + confirmation) — see missedWorkoutDecisionFlow.test.ts — so a
    // separate `!showWorkoutConfirmation` guard here would be redundant.
    const overlayOpenIdx = shell.indexOf('const overlayOpen =');
    expect(shell.slice(overlayOpenIdx, overlayOpenIdx + 400)).toContain("startWorkoutFlow !== 'idle'");
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
    for (const marker of ['onOpenConsistency', 'UPCOMING_KEYS', 'weekVolume', 'benchPr', 'nextLevelValue', 'CONSISTENCY_MOCK', 'MOCK_DATE', 'TICKER_KEYS']) {
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

describe('EvolutionTicker replaces EvolutionCard on Home only', () => {
  it('Home renders EvolutionTicker, not EvolutionCard', () => {
    expect(home).toContain('<EvolutionTicker');
    expect(home).not.toContain('EvolutionCard');
  });

  it('EvolutionCard keeps working unchanged on Profile', () => {
    expect(profile).toContain('<EvolutionCard');
    expect(profile).toContain('onOpenEvolution');
  });

  it('never recomputes domain logic — no Firestore, no eligibility math', () => {
    for (const source of [ticker, tickerItems]) {
      expect(source).not.toContain('firebase/firestore');
      expect(source).not.toContain('evaluateProgressionV2ForUser');
      expect(source).not.toContain('reconcileWorkoutLifecycle');
    }
  });

  it('never surfaces cycleNumber in the Home marquee', () => {
    expect(tickerItems).not.toContain('cycleNumber');
  });

  it('does not reintroduce the historical mock ticker data', () => {
    for (const marker of ['TICKER_KEYS', "'streak'", "'weekVolume'", "'benchPr'", "'nextLevel'"]) {
      expect(ticker).not.toContain(marker);
      expect(tickerItems).not.toContain(marker);
    }
  });

  it('pauses the marquee loop when Home is inactive and cleans it up on unmount', () => {
    expect(ticker).toContain('useIsScreenActive');
    expect(ticker).toContain('if (width === 0 || !isActive) return;');
    expect(ticker).toContain('return () => loop.stop();');
    expect(ticker).toContain('useNativeDriver: true');
  });

  it('only the ACTION surface is an accessible button — the marquee stays plain text', () => {
    expect(ticker).toContain("accessibilityRole=\"button\"");
    expect(ticker).toContain('accessibilityLabel={content.accessibilityLabel}');
    // The marquee/static branches never render a Pressable of their own —
    // TickerAction is the sole Pressable in the file.
    expect(ticker.match(/<Pressable/g)?.length).toBe(1);
  });

  it('ACTION mode never mixes a CTA into the running marquee — modes are mutually exclusive', () => {
    expect(ticker).toContain("content.mode === 'MARQUEE'");
    expect(ticker).toContain("content.mode === 'ACTION'");
  });

  it('routes the ACTION press through the same onOpenEvolution/EvolutionUnlockScreen flow', () => {
    expect(shell).toContain('onOpenEvolution={() => setShowEvolutionUnlock(true)}');
    expect(home).toContain('<EvolutionTicker viewModel={evolutionViewModel} onPress={onOpenEvolution} />');
  });

  it('marquee items keep the historical label(faint)/value(accent) split — every value is accented, not just "good" ones', () => {
    expect(tickerItems).toContain('label: string');
    expect(tickerItems).toContain('value: string');
    // The nested value <Text> is unconditionally colored `primaryEmphasis` —
    // no ternary/condition gates it on adherence/proximity quality (docs
    // audit "visual refinement" §historical parity: d24319b colored every
    // ticker value, never just the positive ones).
    expect(ticker).toMatch(/color:\s*theme\.colors\.primaryEmphasis,\s*fontFamily:\s*theme\.fonts\.monoBold/);
    expect(ticker).not.toContain('emphasis ?');
  });

  it('ACTION CTA and chevron share the same accent color as the marquee values', () => {
    const actionBlock = ticker.slice(ticker.indexOf('function TickerAction'));
    expect(actionBlock).toContain('theme.colors.primaryEmphasis');
    expect(actionBlock.match(/theme\.colors\.primaryEmphasis/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const cardioContent = readFileSync(new URL('../../components/workout/CardioSessionContent.tsx', import.meta.url), 'utf8');

describe('WorkoutScreen cardio finisher structure', () => {
  it('renders a post-strength prescription only when cardioFinisher exists', () => {
    expect(source).toContain('if (showCardioFinisher && cardioFinisher)');
    expect(source).toContain('<CardioSessionContent');
    expect(source).toContain('resolveCardioFinisherPresentation');
  });

  it('plays the final exercise completion transition before revealing cardio', () => {
    const advanceStart = source.indexOf('const advanceAfterRest = (');
    const advanceBody = source.slice(advanceStart, source.indexOf('useEffect(() => {', advanceStart));
    const transitionRender = source.indexOf('if (exComplete?.continuesToCardio)');
    const cardioRender = source.indexOf('if (showCardioFinisher && cardioFinisher)');

    expect(advanceBody).toContain("nextName: t('cardioFinisher.title')");
    expect(advanceBody).toContain('continuesToCardio: true');
    expect(advanceBody).toContain('setExComplete(null);');
    expect(advanceBody).toContain('setShowCardioFinisher(true);');
    expect(transitionRender).toBeGreaterThan(-1);
    expect(transitionRender).toBeLessThan(cardioRender);
  });

  it('keeps the cardio completion animation mounted while workout finalization runs', () => {
    const finalizeStart = source.indexOf('const finalizeNow = async () => {');
    const finalizeBody = source.slice(finalizeStart, source.indexOf('const [confirmSheet', finalizeStart));
    const finalizingRender = source.indexOf("if (finishState === 'finalizing')");

    expect(finalizeBody).toContain("setFinishState('finalizing')");
    expect(finalizeBody).toContain('Promise.all([persistence, completionAnimation])');
    expect(finalizeBody).not.toContain("setFinishState('persisting')");
    expect(finalizingRender).toBeGreaterThan(-1);
    expect(source).toContain("completedLabel={t('cardioSession.completed')}");
    expect(source).toContain("nextName={t('done.finishing')}");
  });

  it('does not add pace, distance, heart-rate or calorie tracking', () => {
    expect(source).not.toContain('cardioDistance');
    expect(source).not.toContain('heartRate');
    expect(source).not.toContain('cardioCalories');
  });

  it('treats the cardio X like every other workout exercise', () => {
    const cardioBranch = source.slice(
      source.indexOf('if (showCardioFinisher && cardioFinisher)'),
      source.indexOf('// Only computed once', source.indexOf('if (showCardioFinisher && cardioFinisher)')),
    );
    const closeHandler = source.slice(
      source.indexOf('const handleHeaderClose = () => {'),
      source.indexOf('const doneClock', source.indexOf('const handleHeaderClose = () => {')),
    );

    expect(cardioBranch).toContain('<CardioScreen');
    expect(cardioBranch).toContain('onFinish=');
    expect(source).toContain("setConfirmSheet('exit')");
    expect(source).toContain("cardioSession.exitConfirmTitle");
    expect(closeHandler).not.toContain('finalizeNow();');
    expect(source).toContain('onSkip={() => void finalizeNow()}');
    expect(cardioContent).toContain('onPress={ready ? onSkip : onExtend}');
  });

  it('uses the rest-overlay visual hierarchy for cardio', () => {
    expect(cardioContent).toContain("import { SegBar } from '../ui/SegBar';");
    expect(cardioContent).toContain('fontSize: 104');
    expect(cardioContent).toContain("transform: [{ skewX: '-8deg' }]");
    expect(cardioContent).toContain('<SegBar value={progress} segs={14} />');
    expect(cardioContent).toContain('styles.header');
    expect(cardioContent).toContain('styles.footer');
    expect(cardioContent).toContain('styles.secondary');
    expect(cardioContent).toContain('styles.primary');
    expect(cardioContent).not.toContain('adjustsFontSizeToFit');
    expect(cardioContent).not.toContain('<Card');
    expect(cardioContent).not.toContain('<LinearGradient');
  });

  it('keeps the cardio header minimal and shows mode/duration/intensity there instead of a body card', () => {
    expect(cardioContent).not.toContain("t('cardioFinisher.kicker')");
    expect(cardioContent).not.toContain("t('cardioFinisher.title')");
    expect(cardioContent).not.toContain('styles.headerCopy');
    expect(cardioContent).not.toContain('name="heart"');
    expect(cardioContent).not.toContain('styles.prescription');
    expect(cardioContent).toContain('cardio.mode');
    expect(cardioContent).toContain('cardio.duration');
    expect(cardioContent).toContain('cardio.intensity');
  });

  it('keeps the same surface stable and only starts the clock when entering the running state', () => {
    expect(cardioContent).toContain('styles.secondary');
    expect(cardioContent).toContain("onPress={ready ? onSkip : onExtend}");
    expect(cardioContent).toContain("t(ready ? 'cardioSession.skip' : 'cardioSession.extend')");
    expect(cardioContent).toContain('<View style={styles.timer}>');
    expect(cardioContent).not.toContain('runningReveal');
    expect(cardioContent).not.toContain('translateY');
    expect(cardioContent).not.toContain('styles.skipSlot');
  });

  it('shows the cardio timer as a countdown after starting', () => {
    expect(cardioContent).toContain('const clock = ready ? targetClock : remainingClock;');
    expect(cardioContent).toContain("'cardioSession.remainingLabel'");
    expect(cardioContent).not.toContain('doneClock: string;');
  });
});

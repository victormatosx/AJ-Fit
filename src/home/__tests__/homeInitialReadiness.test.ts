import { describe, expect, it } from 'vitest';

import {
  INITIAL_HOME_BOOTSTRAP_STATE,
  deriveHomeInitialReadiness,
  reduceHomeBootstrapState,
  type HomeBootstrapEvent,
  type HomeInitialReadinessInput,
} from '../homeInitialReadiness';

const settledInput: HomeInitialReadinessInput = {
  prescriptionLoading: false,
  generatingWorkout: false,
  prescriptionStatus: 'SUCCESS',
  scheduleLoading: false,
  scheduleStatus: 'SESSION_READY',
  scheduleRefreshFailed: false,
  evolutionKind: 'PROGRESSING',
  evolutionNoticeUnavailable: false,
  activityStatus: 'SUCCESS',
  weekOverviewAvailable: true,
  frequencyStatus: 'SUCCESS',
  frequencyWindowAvailable: true,
  frequencyLoading: false,
  supportInboxStatus: 'SUCCESS',
};

describe('Home initial data readiness', () => {
  it('keeps a required component from releasing readiness until its final content exists', () => {
    const pending = deriveHomeInitialReadiness({
      ...settledInput,
      frequencyWindowAvailable: false,
    });
    expect(pending.frequency).toBe('PENDING');
    expect(pending.allRequiredDataSettled).toBe(false);
  });

  it('treats terminal error and not-applicable presentations as settled', () => {
    const terminal = deriveHomeInitialReadiness({
      ...settledInput,
      scheduleRefreshFailed: true,
      evolutionKind: 'ERROR',
      activityStatus: 'ERROR',
      frequencyStatus: 'ERROR',
      supportInboxStatus: 'NOT_APPLICABLE',
    });
    expect(terminal.today).toBe('ERROR');
    expect(terminal.evolution).toBe('ERROR');
    expect(terminal.allRequiredDataSettled).toBe(true);
  });

  it('settles a cached Evolution summary whose authoritative tail failed', () => {
    const terminal = deriveHomeInitialReadiness({
      ...settledInput,
      evolutionKind: 'SUMMARY_READY',
      evolutionNoticeUnavailable: true,
    });
    expect(terminal.evolution).toBe('ERROR');
    expect(terminal.allRequiredDataSettled).toBe(true);
  });

  it('stays unsettled while the current session is still resolving — the "Buscando a sessão atual" state', () => {
    const buscandoSessaoAtual = deriveHomeInitialReadiness({
      ...settledInput,
      prescriptionLoading: true,
    });
    expect(buscandoSessaoAtual.today).toBe('PENDING');
    expect(buscandoSessaoAtual.allRequiredDataSettled).toBe(false);

    expect(
      deriveHomeInitialReadiness({ ...settledInput, generatingWorkout: true }).allRequiredDataSettled,
    ).toBe(false);
    expect(
      deriveHomeInitialReadiness({ ...settledInput, scheduleLoading: true }).allRequiredDataSettled,
    ).toBe(false);
  });

  it('stays unsettled while Evolution only has a summary and hasn\'t reached its full view yet — the "Atualizando" state', () => {
    const atualizando = deriveHomeInitialReadiness({
      ...settledInput,
      evolutionKind: 'SUMMARY_READY',
      evolutionNoticeUnavailable: false,
    });
    expect(atualizando.evolution).toBe('PENDING');
    expect(atualizando.allRequiredDataSettled).toBe(false);
  });

  it('stays unsettled while Frequency is still loading, even if a value is already available (refresh-in-flight)', () => {
    const refreshing = deriveHomeInitialReadiness({
      ...settledInput,
      frequencyLoading: true,
    });
    expect(refreshing.frequency).toBe('PENDING');
    expect(refreshing.allRequiredDataSettled).toBe(false);
  });
});

describe('Home initial visual readiness', () => {
  it('does not remove the overlay when data settles; layout and a paintable frame are both required', () => {
    const afterData = reduceHomeBootstrapState(INITIAL_HOME_BOOTSTRAP_STATE, 'DATA_SETTLED');
    expect(afterData).toEqual({ dataSettled: true, layoutCommitted: false, visualReady: false });

    const afterLayout = reduceHomeBootstrapState(afterData, 'LAYOUT_COMMITTED');
    expect(afterLayout).toEqual({ dataSettled: true, layoutCommitted: true, visualReady: false });

    const afterFrame = reduceHomeBootstrapState(afterLayout, 'FRAME_PAINTABLE');
    expect(afterFrame.visualReady).toBe(true);
  });

  it('renders a terminal error state behind the overlay before releasing it', () => {
    const terminalError = deriveHomeInitialReadiness({
      ...settledInput,
      evolutionKind: 'ERROR',
    });
    expect(terminalError.evolution).toBe('ERROR');
    expect(terminalError.allRequiredDataSettled).toBe(true);

    const renderedBehindOverlay = reduceHomeBootstrapState(
      INITIAL_HOME_BOOTSTRAP_STATE,
      'DATA_SETTLED',
    );
    expect(renderedBehindOverlay.visualReady).toBe(false);

    const laidOut = reduceHomeBootstrapState(renderedBehindOverlay, 'LAYOUT_COMMITTED');
    expect(laidOut.visualReady).toBe(false);
    expect(reduceHomeBootstrapState(laidOut, 'FRAME_PAINTABLE').visualReady).toBe(true);
  });

  it('cannot accept a layout or frame before required data is settled', () => {
    const prematureLayout = reduceHomeBootstrapState(INITIAL_HOME_BOOTSTRAP_STATE, 'LAYOUT_COMMITTED');
    const prematureFrame = reduceHomeBootstrapState(prematureLayout, 'FRAME_PAINTABLE');
    expect(prematureFrame).toEqual(INITIAL_HOME_BOOTSTRAP_STATE);
  });

  it('re-arms if data becomes pending before the visual commit', () => {
    const afterData = reduceHomeBootstrapState(INITIAL_HOME_BOOTSTRAP_STATE, 'DATA_SETTLED');
    const afterLayout = reduceHomeBootstrapState(afterData, 'LAYOUT_COMMITTED');
    expect(reduceHomeBootstrapState(afterLayout, 'DATA_PENDING')).toEqual(
      INITIAL_HOME_BOOTSTRAP_STATE,
    );
  });

  it('latches only after bootstrap and a fresh AppShell identity starts armed again', () => {
    const events: HomeBootstrapEvent[] = ['DATA_SETTLED', 'LAYOUT_COMMITTED', 'FRAME_PAINTABLE'];
    const ready = events.reduce(
      reduceHomeBootstrapState,
      INITIAL_HOME_BOOTSTRAP_STATE,
    );
    expect(reduceHomeBootstrapState(ready, 'DATA_PENDING')).toBe(ready);
    expect(INITIAL_HOME_BOOTSTRAP_STATE.visualReady).toBe(false);
  });
});

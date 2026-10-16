import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Home's "Treino de hoje" card must never block on
 * MISSED_SESSION_DECISION_REQUIRED the way REST_DAY/TODAY_COMPLETED/etc.
 * do — it stays fully actionable (CTA still starts a workout, which then
 * routes through AppShell's requestStartWorkout) and only adds a discreet,
 * non-blocking notice. Source-inspection only — see
 * appShellNavigationStructure.test.ts for why this repo tests
 * AppShell/HomeScreen structurally instead of with a full RN renderer.
 */

const HOME_SCREEN = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
const HOME_SCREEN_CODE = HOME_SCREEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('HomeScreen — missed-session pending notice', () => {
  it('does not fold MISSED_SESSION_DECISION_REQUIRED into scheduleOverrideKey (CTA must stay actionable)', () => {
    const start = HOME_SCREEN_CODE.indexOf('const scheduleOverrideKey =');
    const end = HOME_SCREEN_CODE.indexOf('const isBlockedToday =', start);
    const block = HOME_SCREEN_CODE.slice(start, end);
    expect(block).not.toContain('MISSED_SESSION_DECISION_REQUIRED');
  });

  it('does not swap the CTA for the next-workout chip on a pending miss decision (isBlockedToday excludes it)', () => {
    const start = HOME_SCREEN_CODE.indexOf('const isBlockedToday =');
    const end = HOME_SCREEN_CODE.indexOf('const sessionExerciseIds', start);
    const block = HOME_SCREEN_CODE.slice(start, end);
    expect(block).not.toContain('MISSED_SESSION_DECISION_REQUIRED');
  });

  it('previews the actually-pending session instead of a hardcoded index 0', () => {
    const start = HOME_SCREEN_CODE.indexOf('const scheduledSessionIndex =');
    const end = HOME_SCREEN_CODE.indexOf('const firstSession =', start);
    const block = HOME_SCREEN_CODE.slice(start, end);
    expect(block).toContain("scheduleResolution?.status === 'MISSED_SESSION_DECISION_REQUIRED'");
    expect(block).toContain('scheduleResolution.missedSessionIndex');
  });

  it('renders a discreet, icon-only, tappable notice only for a pending miss decision', () => {
    expect(HOME_SCREEN_CODE).toContain(
      "const showMissedPendingNotice = todayActionsReady && !workoutInProgress\n    && scheduleResolution?.status === 'MISSED_SESSION_DECISION_REQUIRED';",
    );
    const badgeIdx = HOME_SCREEN_CODE.indexOf('{showMissedPendingNotice && (');
    expect(badgeIdx).toBeGreaterThan(-1);
    const badgeEndIdx = HOME_SCREEN_CODE.indexOf('\n            )}', badgeIdx);
    expect(badgeEndIdx).toBeGreaterThan(badgeIdx);
    const badgeBlock = HOME_SCREEN_CODE.slice(badgeIdx, badgeEndIdx);
    // The icon only measures its own position and opens the info popover —
    // it never starts a workout directly.
    expect(badgeBlock).toContain('setMissedInfoAnchor');
    expect(badgeBlock).toContain('setShowMissedPendingInfo(true)');
    expect(badgeBlock).not.toContain('onPress={onStart}');
  });

  it('shows the popover in a full-screen Modal that closes on an outside tap', () => {
    const modalIdx = HOME_SCREEN_CODE.indexOf('<Modal\n        visible={showMissedPendingInfo}');
    expect(modalIdx).toBeGreaterThan(-1);
    const modalEndIdx = HOME_SCREEN_CODE.indexOf('</Modal>', modalIdx);
    expect(modalEndIdx).toBeGreaterThan(modalIdx);
    const modalBlock = HOME_SCREEN_CODE.slice(modalIdx, modalEndIdx);
    // Backdrop closes the popover on any outside tap.
    expect(modalBlock).toContain('onPress={() => setShowMissedPendingInfo(false)}');
    // The popover content stops that tap from bubbling to the backdrop, and
    // tapping it still routes through the same guarded entry point as the
    // main CTA.
    expect(modalBlock).toContain('event.stopPropagation()');
    expect(modalBlock).toContain('onStart()');
    expect(modalBlock).toContain("t('home:schedule.missedPending.badge.title')");
    expect(modalBlock).toContain("t('home:schedule.missedPending.badge.body')");
  });

  it('never opens the missed-decision Modal directly from HomeScreen — that decision is AppShell-owned', () => {
    expect(HOME_SCREEN_CODE).not.toContain('MissedSessionDecisionModal');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Optional actual-reps registration alongside the existing load registration
// flow. `actualReps` is already the authoritative field end to end
// (recordSetExecution/hydration) — this only wires the UI capture that was
// missing, through the exact same completeSet/advanceAfterRest transition
// weight already goes through. See workoutScreenPlan.test.ts and
// hydration.test.ts for the pure-logic (sanitizeActualReps/
// resolveDisplayedReps/deriveWorkoutHydration) coverage.
const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

function block(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('WorkoutScreen — actual reps capture', () => {
  it('prefills regReps from another already-logged set of the same exercise, mirroring regWeight', () => {
    const completeSetBlock = block('const completeSet = () => {', 'const skipRest = () => {');
    expect(completeSetBlock).toContain('lastEnteredForExercise(ex, setIdx).reps');
    expect(completeSetBlock).toContain('setRegReps(prefilledReps);');
    // Never pulled from the prescription itself — only from logged data.
    expect(completeSetBlock).not.toContain('ex.sets[setIdx].r');
  });

  it('sanitizes and gates reps by doseKind before persisting, never overwriting the prescription', () => {
    const advanceBlock = block('const advanceAfterRest = (', 'const finishedSet = setIdx + 1;');
    expect(advanceBlock).toContain("exercises[transitionPending.exIdx].doseKind === 'reps'");
    expect(advanceBlock).toContain('sanitizeActualReps(transitionReps)');
    expect(advanceBlock).toContain('setLoggedReps((current) => (');
    expect(advanceBlock).not.toContain('.sets[transitionPending.setIdx].r'); // never touches the prescribed field
  });

  it('threads actualReps through onSetLogged, same transition as weight', () => {
    const advanceBlock = block('const advanceAfterRest = (', 'const finishedSet = setIdx + 1;');
    expect(advanceBlock).toContain('onSetLogged?.(transitionPending.exIdx, transitionPending.setIdx, finalWeight, finalReps);');
  });

  it('resets regReps alongside regWeight when a transition completes', () => {
    const advanceBlock = block('const advanceAfterRest = (', 'if (finishedSet >= ex.sets.length)');
    const weightResetIdx = advanceBlock.indexOf('setRegWeight(0);');
    const repsResetIdx = advanceBlock.indexOf('setRegReps(null);', weightResetIdx);
    expect(weightResetIdx).toBeGreaterThan(-1);
    expect(repsResetIdx).toBeGreaterThan(weightResetIdx);
  });

  it('AppShell forwards actualReps straight to execution.recordSet — the already-authoritative field, no parallel persistence', () => {
    expect(appShell).toContain('onSetLogged={(exerciseIndex, setIndex, weightKg, actualReps) =>');
    expect(appShell).toContain('execution.recordSet(exerciseIndex, setIndex, weightKg, actualReps ?? null)');
  });
});

describe('WorkoutScreen — set row displays actual reps over the prescription', () => {
  function setListBlock(): string {
    return block('{/* set list */}', '{/* CTAs */}');
  }

  it('resolves displayed reps via loggedReps, gated to doseKind === "reps"', () => {
    const setList = setListBlock();
    expect(setList).toContain("ex.doseKind === 'reps'");
    expect(setList).toContain("resolveDisplayedReps(loggedReps[`${ex.id}-${i}`], s0.r)");
  });

  it('a duration/distance/cycles exercise keeps rendering its own prescribed dose, untouched by displayReps', () => {
    const setList = setListBlock();
    const nonRepsBranch = setList.slice(
      setList.indexOf("ex.doseKind !== 'reps'"),
      setList.indexOf('t(`prescription.${ex.doseKind}`)') + 40,
    );
    expect(nonRepsBranch).toContain('s0.r'); // the raw prescription, not displayReps
    expect(nonRepsBranch).not.toContain('displayReps');
  });

  it('feeds the resolved reps into both the weighted and bodyweight summary templates', () => {
    const setList = setListBlock();
    expect(setList).toContain('count: pluralCountForReps(displayReps)');
    expect(setList).toContain('reps: displayReps,');
    expect(setList).toContain('t(\'sets.summaryReps\', { count: pluralCountForReps(displayReps), reps: displayReps }');
  });
});

describe('WorkoutScreen — RestOverlay reps input (merged into the load card, symmetric)', () => {
  function overlayBody(): string {
    return block('function RestOverlay({', 'function PROverlay({');
  }

  it('only renders the reps row for reps-doseKind exercises', () => {
    const body = overlayBody();
    expect(body).toContain("{doseKind === 'reps' && (");
  });

  it('parses digits-only input, treats an empty field as "not informed" (null), never a forced zero', () => {
    const body = overlayBody();
    expect(body).toContain("txt.replace(/[^0-9]/g, '')");
    expect(body).toContain("setRegReps(digits === '' ? null : parseInt(digits, 10));");
  });

  it('shows the prescribed range only as a placeholder — never a separate hint line, never substituted into regReps', () => {
    const body = overlayBody();
    expect(body).toContain('placeholder={prescribedReps}');
    expect(body).not.toContain('rest.prescribedReps');
  });

  it('labels the reps row with the same set number and "optional" tag as the load row', () => {
    const body = overlayBody();
    const repsRowStart = body.indexOf("{doseKind === 'reps' && (");
    const repsRow = body.slice(repsRowStart);
    expect(repsRow).toContain("t('rest.repsLabel', { setNumber }).toUpperCase()");
    expect(repsRow).toContain("t('rest.optional')");
  });

  it('passes doseKind/prescribedReps/regReps/previousLoadKg from the current pending set, mirroring how regWeight is resolved', () => {
    const callSiteStart = source.indexOf('{/* REST OVERLAY */}');
    const callSiteEnd = source.indexOf('/>', source.indexOf('<RestOverlay', callSiteStart));
    const callSite = source.slice(callSiteStart, callSiteEnd);
    expect(callSite).toContain('regReps={regReps}');
    expect(callSite).toContain('setRegReps={setRegReps}');
    expect(callSite).toContain('doseKind={ex.doseKind}');
    expect(callSite).toContain('prescribedReps={ex.sets[pending ? pending.setIdx : setIdx].r}');
    // The user's own last-registered load for this exact exercise/set — same
    // source `previousSetLoads[ex.db]` the "next set" card already reads,
    // index-aligned by the same pending-or-current setIndex.
    expect(callSite).toContain('previousLoadKg={previousSetLoads[ex.db]?.[pending ? pending.setIdx : setIdx] ?? undefined}');
  });
});

describe('WorkoutScreen — RestOverlay layout: symmetric load/reps rows, one merged card, one shared hint', () => {
  function overlayBody(): string {
    return block('function RestOverlay({', 'function PROverlay({');
  }

  it('uses the previous load only as the weight field placeholder — never a separate text line, never pre-filling regWeight', () => {
    const body = overlayBody();
    expect(body).toContain("placeholder={previousLoadKg != null ? formatWorkoutLoadFromKg(previousLoadKg, resolvedUnits) : '—'}");
    // No standalone "Carga anterior: X" copy anywhere — that text/key is gone.
    expect(body).not.toContain('rest.previousLoad');
    // regWeight itself must never be seeded from the previous load; only the
    // placeholder reads it.
    expect(body).not.toContain('setRegWeight(previousLoadKg');
  });

  it('renders exactly one bordered logging card containing both load and reps, not two', () => {
    const body = overlayBody();
    const cardOpenings = body.match(/backgroundColor: theme\.colors\.inputBackgroundSubtle,/g) ?? [];
    expect(cardOpenings.length).toBe(1);
    const cardStart = body.indexOf('backgroundColor: theme.colors.inputBackgroundSubtle,');
    const cardEnd = body.indexOf('<View style={{ flexDirection: \'row\', gap: 10, marginTop: 28 }}>', cardStart);
    const card = body.slice(cardStart, cardEnd);
    expect(card).toContain("t('rest.logLoad'");
    expect(card).toContain("doseKind === 'reps'");
    expect(card).toContain("t('rest.repsLabel'");
  });

  it('shares one button style, one row-header style and one central-value style between load and reps — no per-row overrides', () => {
    const body = overlayBody();
    expect(body).toContain('const registerButtonStyle = {');
    expect(body).toContain('const rowHeaderStyle = {');
    expect(body).toContain('const optionalTagStyle = {');
    expect(body).toContain('const controlRowStyle = {');
    expect(body).toContain('const centralValueContainerStyle = {');
    expect(body).toContain('const centralValueTextStyle = {');
    expect(body).toContain('const unitTextStyle = {');
    // Both +/- stepper pairs (load and reps) use the same shared button
    // style object — never a distinct smaller one for reps.
    expect(body.match(/style={registerButtonStyle}/g)?.length).toBe(4);
    // Both value inputs use the same shared central-value text style.
    expect(body.match(/style={centralValueTextStyle}/g)?.length).toBe(2);
    // Both header rows and "optional" tags reuse the same shared styles.
    expect(body.match(/style={rowHeaderStyle}/g)?.length).toBe(2);
    expect(body.match(/style={optionalTagStyle}/g)?.length).toBe(2);
    expect(body.match(/style={controlRowStyle}/g)?.length).toBe(2);
    expect(body.match(/style={centralValueContainerStyle}/g)?.length).toBe(2);
    expect(body.match(/style={unitTextStyle}/g)?.length).toBe(2);
    // No leftover per-row style forks from the earlier asymmetric layout.
    expect(body).not.toContain('repsButtonStyle');
  });

  it('renders exactly one shared typing hint, positioned after both rows — never duplicated per field', () => {
    const body = overlayBody();
    const hintOccurrences = body.match(/t\('rest\.inputHint'\)/g) ?? [];
    expect(hintOccurrences.length).toBe(1);
    // Comes after the reps row's closing, i.e. below both controls.
    const repsRowEnd = body.indexOf("t('rest.repsUnit')");
    const hintIdx = body.indexOf("t('rest.inputHint')");
    expect(hintIdx).toBeGreaterThan(repsRowEnd);
  });
});

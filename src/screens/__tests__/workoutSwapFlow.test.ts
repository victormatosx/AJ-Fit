import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enOnboarding from '../../i18n/resources/en/onboarding.json';
import esOnboarding from '../../i18n/resources/es/onboarding.json';
import ptOnboarding from '../../i18n/resources/pt-BR/onboarding.json';
import enTreino from '../../i18n/resources/en/treino.json';
import esTreino from '../../i18n/resources/es/treino.json';
import ptTreino from '../../i18n/resources/pt-BR/treino.json';

/**
 * Structural guards for the program-swap flow (Editar agenda -> Nova divisão
 * -> Confirmar -> "Trocando treino" 0-100% -> full preview of the new plan).
 *
 * This project has no React Native component-render infrastructure (Vitest
 * runs with `environment: 'node'`, no jsdom/testing-library — see
 * vitest.config.mts), so these mirror the codebase's existing source-text
 * regression guards (e.g. `analyzingScreenHooksOrder.test.ts`,
 * `appShellNavigationStructure.test.ts`) rather than rendering anything. The
 * view-model arithmetic itself is covered for real in
 * `workoutSwapPreview.test.ts`.
 */
const analyzing = readFileSync(new URL('../AnalyzingScreen.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../WorkoutSwapPreviewScreen.tsx', import.meta.url), 'utf8');
const agendaSheet = readFileSync(new URL('../TreinoAgendaSheet.tsx', import.meta.url), 'utf8');
/** The pure module the screen's arithmetic lives in, so Node can test it. */
const swapModule = readFileSync(new URL('../workoutSwapPreview.ts', import.meta.url), 'utf8');

/**
 * Code only. A "this file must not call X" guard has to ignore comments —
 * these files legitimately NAME the services they deliberately do not call,
 * which is exactly the documentation worth keeping. Same technique as
 * `analyzingScreen.test.ts`'s own no-fabricated-values check.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('AnalyzingScreen — reused for "Trocando treino" by prop, not by a copy', () => {
  it('accepts the variant and the injected task instead of hardcoding the onboarding computation', () => {
    expect(analyzing).toContain("variant = 'onboarding'");
    expect(analyzing).toContain('run?: () => Promise<PlanBuildTaskResult>');
    expect(analyzing).toContain('export type PlanBuildTaskResult');
  });

  it('only the title changes — one line for the swap, onboarding keeps its own two', () => {
    expect(analyzing).toContain("t('analyzing.swap.title')");
    expect(analyzing).toContain("t('analyzing.titleLine1')");
    expect(analyzing).toContain("t('analyzing.titleLine2')");
    // Onboarding keeps its hard line break; the swap must not inherit one.
    expect(analyzing).toContain("`${t('analyzing.titleLine1')}\\n${t('analyzing.titleLine2')}`");
  });

  it('tightens the swap rhythm without touching the design spacing onboarding renders', () => {
    expect(analyzing).toContain("variant === 'swap' ? { titleLines: 1, dense: true } : undefined");
    // The leftover height becomes bottom margin, never a gap between the
    // speech and the first step row. Onboarding's list keeps `flex: 1`.
    expect(analyzing).toContain("variant === 'swap' ? { flexGrow: 0, flexShrink: 1 } : { flex: 1 }");
    expect(analyzing).not.toContain("justifyContent: 'center' as const");
    // Every gap is rendered from the resolved set the fit math used, so the
    // two can never disagree.
    expect(analyzing).not.toContain('ANALYSIS_LAYOUT.');
    for (const gap of ['gaps.paddingTop', 'gaps.ringGap', 'gaps.percentGap', 'gaps.titleGap', 'gaps.speechGap', 'gaps.rowGap', 'gaps.reviewGap', 'gaps.paddingBottom']) {
      expect(analyzing).toContain(gap);
    }
  });

  it('keeps one ring, one narration, one checklist and one set of timings for both variants', () => {
    // A second copy of the screen would show up as a second ring elsewhere;
    // these are the same literals `analyzingScreen.test.ts` pins.
    expect(analyzing).toContain('<AnalysisAjRing');
    expect(analyzing).toContain('}, 52)');
    expect(analyzing).toContain('setTimeout(onDone, 700)');
    expect(analyzing.match(/<AnalysisAjRing/g) ?? []).toHaveLength(1);
    expect(preview).not.toContain('AnalysisAjRing');
  });

  it('never shows 100% over a pending task, and never declares completion on the timer alone', () => {
    expect(analyzing).toContain("variant === 'swap' && computeStatus === 'pending' ? PENDING_PERCENT_CEILING : 100");
    expect(analyzing).toContain('const PENDING_PERCENT_CEILING = 99');
    expect(analyzing).toContain('Math.min(ceiling, Math.round(progress))');
    expect(analyzing).toContain("const completed = progress >= 100 && computeStatus === 'success'");
  });

  it('paces the swap ramp so the counter keeps moving instead of parking at the ceiling', () => {
    // Decelerating approach with a floor: it never reaches the ceiling on the
    // timer, so the number is always still moving while work is pending.
    expect(analyzing).toContain('const SWAP_RAMP_KNEE = 78');
    expect(analyzing).toContain('const SWAP_RAMP_MIN_STEP = 0.08');
    expect(analyzing).toContain('Math.max(SWAP_RAMP_MIN_STEP, (PENDING_PERCENT_CEILING - p) * SWAP_RAMP_DECAY)');
    // And once the real work lands, the remaining distance is closed from
    // wherever the ramp is — a fast operation gets a short screen.
    expect(analyzing).toContain("if (computeStatus === 'success') return Math.min(100, p + Math.max(SWAP_FINISH_MIN_STEP, (100 - p) / SWAP_FINISH_DIVISOR));");
    expect(analyzing).toContain('}, [attempt, computeStatus, run]);');
    // The onboarding ramp keeps its own constant pace, untouched.
    expect(analyzing).toContain('return p + 1;');
    expect(analyzing).toContain('}, 52);');
  });

  it('routes an injected task through the same computeStatus the completion gate reads', () => {
    expect(analyzing).toContain("setComputeStatus('success')");
    expect(analyzing).toContain("setComputeStatus('error')");
    // And gives the swap a way off a repeated failure, which the shared CTA
    // (always "retry" for an adaptation) does not provide on its own.
    expect(analyzing).toContain("t('analyzing.swap.back')");
  });
});

describe('AppShell — the swap owns the screen and hands the real snapshot to the preview', () => {
  it('freezes the outgoing plan before anything is activated', () => {
    expect(appShell).toContain("setWorkoutSwap({ phase: 'running'");
    expect(appShell).toContain('previousPlan: activeProgram');
  });

  it('still performs the one authoritative ADAPT, with its original inputs', () => {
    expect(appShell).toContain('adaptWorkoutProgram({');
    expect(appShell).toContain("reason: 'AVAILABILITY'");
    expect(appShell).toContain('agenda-frequency:');
    expect(appShell).toContain('await reloadPrescription()');
  });

  it('publishes the new plan only from the ADAPT result, never from a prescription read', () => {
    expect(appShell).toContain('newPlan: result.program');
    expect(appShell).toContain('newPlan={workoutSwap.newPlan}');
    // The preview is unreachable without a real new plan in hand.
    expect(appShell).toContain("current?.phase === 'running' && current.newPlan");
  });

  it('mounts the loading screen in swap mode and the preview after it', () => {
    expect(appShell).toContain('<AnalyzingScreen');
    expect(appShell).toContain('variant="swap"');
    expect(appShell).toContain('run={() => runProgramSwap(');
    expect(appShell).toContain('<WorkoutSwapPreviewScreen');
  });

  it('treats the swap as a full-screen overlay for the tab bar and the unprompted AJ moments', () => {
    expect(appShell).toContain('workoutSwap !== null ||');
    expect(appShell).toContain('FULL_BLEED.overlayZ70');
  });

  it('leaves the same-frequency agenda save untouched — it never regenerates a program', () => {
    expect(appShell).toContain('saveScheduleConfig(user.uid, {');
    const shellCode = code(appShell);
    const saveAgenda = shellCode.slice(
      shellCode.indexOf('const handleSaveAgenda'),
      shellCode.indexOf('const runProgramSwap'),
    );
    expect(saveAgenda.length).toBeGreaterThan(0);
    expect(saveAgenda).not.toContain('setWorkoutSwap');
    expect(saveAgenda).not.toContain('adaptWorkoutProgram');
  });

  it('keeps the agenda sheet itself unchanged — it still only reports an outcome', () => {
    expect(agendaSheet).toContain('const outcome = await onChangeFrequency({');
    expect(agendaSheet).toContain("if (outcome === 'OK') onClose();");
    expect(agendaSheet).not.toContain('AnalyzingScreen');
    expect(agendaSheet).not.toContain('WorkoutSwapPreviewScreen');
  });
});

describe('WorkoutSwapPreviewScreen — the onboarding plan moment, reused', () => {
  it('is a pure view: no engine call, no persistence, no prescription/schedule read', () => {
    for (const forbidden of [
      'adaptWorkoutProgram',
      'generateWorkoutPrescription',
      'useWorkoutPrescription',
      'useWorkoutSchedule',
      'saveScheduleConfig',
      'reloadPrescription',
    ]) expect(code(preview)).not.toContain(forbidden);
  });

  it('reuses the onboarding plan moment\'s own components instead of restating them', () => {
    for (const shared of [
      'AqSheet',
      'AqMonoLabel',
      'AqPrimaryButton',
      'PlanPanelHeader',
      'PlanWeekRow',
      'PlanStatsLine',
      'AjSpeechText',
      'useAjFunnelDirector',
    ]) expect(preview).toContain(shared);
  });

  it('runs on the same AJ choreography vocabulary as PlanReadyScreen', () => {
    for (const beat of [
      'AJ_TYPING_MS_PER_CHAR.plan',
      'AJ_TYPING_PLAN_CHAIN_GAP_MS',
      'AJ_PLAN.lineSettleMs',
      'AJ_PLAN.ctaContinueAtMs',
    ]) expect(preview).toContain(beat);
    expect(preview).toContain('aj.direct(');
    expect(preview).toContain("aj.play('hop')");
    expect(preview).toContain("aj.play('nod')");
    expect(preview).toContain('aj.setTalking(');
  });

  it('animates the descent instead of snapping the layout', () => {
    // A driven value on its own node. `LayoutAnimation` does not reliably
    // animate height on AqSheet's own natively-driven Animated.View, which is
    // what made the content teleport.
    expect(preview).toContain('const sheetAnim = useRef(new Animated.Value(height)).current');
    expect(preview).toContain('Animated.timing(sheetAnim, {');
    expect(preview).toContain('duration: AJ_TOGGLE_MS');
    expect(preview).toContain('useNativeDriver: false');
    expect(code(preview)).not.toContain('LayoutAnimation');
    // The heading travels with the edge rather than jumping to a new inset.
    expect(preview).toContain('paddingTop: sheetAnim.interpolate({');
    // Reduce Motion gets the end state with no travel.
    expect(preview).toContain('sheetAnim.setValue(toValue)');
  });

  it('sizes the expanded sheet from what AJ actually needs, not a guessed fraction', () => {
    // The arithmetic lives in the pure module (covered for real in
    // `workoutSwapPreview.test.ts`), never inline in the component.
    expect(swapModule).toContain('export function expandedSheetHeight(windowHeight: number, safeTop: number)');
    for (const piece of ['AJ_EXPANDED_TOP', 'AJ_EXPANDED_SIZE', 'AJ_SPEECH_GAP', 'AJ_SPEECH_BOX', 'AJ_SPEECH_BOTTOM_MARGIN']) {
      expect(swapModule).toContain(piece);
    }
    // Clamped, so a short screen keeps the plan readable and a tall one does
    // not strand the lines in empty space.
    expect(swapModule).toContain('EXPANDED_SHEET_BOUNDS');
    // And the screen consumes it rather than recomputing a fraction.
    expect(preview).toContain('expandedSheetHeight(height, insets.top)');
    expect(code(preview)).not.toMatch(/height \* 0\.\d/);
  });

  it('shows the plan immediately, flush to the top of the screen', () => {
    // No delay, no grab handle, no rounded edge: the sheet IS the screen.
    expect(preview).toContain('delay={0}');
    expect(preview).toContain('flush');
    // The frequency badge rides beside the title, leaving the row's right
    // edge free for AJ.
    expect(preview).toContain('badgeInline');
    // Room kept clear for AJ only while he is actually parked there.
    expect(preview).toContain('reserveRight={expanded ? undefined : AJ_CORNER_SIZE + 10}');
    expect(preview).toContain('<PlanWeekRow columns={weekColumns} />');
    expect(code(preview)).not.toContain('revealed(');
    // The CTA is live from the first frame, never gated on AJ having spoken.
    expect(code(preview)).not.toContain('narrationDone');
  });

  it('parks AJ in the corner and only lets him grow when the user asks', () => {
    expect(preview).toContain('const [expanded, setExpanded] = useState(false)');
    expect(preview).toContain('const AJ_CORNER_SIZE');
    expect(swapModule).toContain('export const AJ_EXPANDED_SIZE');
    // One source for the pose and for the tap target over it.
    expect(preview).toContain('const ajBox = expanded');
    expect(preview).toContain('aj.direct({ x: ajBox.x, y: ajBox.y, size: ajBox.size, rotate: 0 })');
    expect(preview).toContain('onPress={toggleAj}');
    // The lines exist only while expanded, and the full-screen sheet gives
    // room back so he has somewhere to stand.
    expect(preview).toContain('{expanded ? (');
    // The content genuinely moves DOWN: the sheet is pushed to the bottom and
    // the lines are bounded by its top edge, so AJ never talks over the plan.
    expect(preview).toContain("justifyContent: expanded ? 'flex-end' : undefined");
    expect(preview).toContain('bottom: sheetShort + AJ_SPEECH_BOTTOM_MARGIN');
    // Centred horizontally while he presents.
    expect(preview).toContain('x: (width - AJ_EXPANDED_SIZE) / 2');
    // Discovery is by curiosity (the user's own framing), so there is no
    // visible hint — but the tap target must still announce itself to
    // assistive technology, in both directions.
    expect(preview).toContain('treino:swapPresentation.ajExpandAccessibility');
    expect(preview).toContain('treino:swapPresentation.ajCollapseAccessibility');
  });

  it('prints the sealed session letter inside each weekday dot', () => {
    expect(preview).toContain('badge: day.sessionIndex !== null ? String.fromCharCode(65 + day.sessionIndex) : null');
    // A flexible plan claims no weekday, so the dots carry the rotation order
    // instead — still the real letters, never a weekday it cannot know.
    expect(preview).toContain('badge: session.letter');
  });

  it('carries NO diet anywhere — not a tab, not a macro, not a meal', () => {
    for (const diet of [
      'AqSegmented',
      'PlanMacroColumn',
      'resolvePlanDietPreview',
      'macroCalorieShares',
      'nutrition:',
      'dietPanel',
      'mealSlots',
      'kcal',
    ]) expect(code(preview)).not.toContain(diet);
  });

  it('scrolls its heading with the plan instead of pinning it as a fixed bar', () => {
    const sheetBody = preview.slice(preview.indexOf('<AqSheet'), preview.indexOf('</AqSheet>'));
    const scrollAt = sheetBody.indexOf('<ScrollView');
    // Kicker and header both live INSIDE the scroll view.
    expect(scrollAt).toBeGreaterThan(-1);
    expect(sheetBody.indexOf('swapPresentation.kicker')).toBeGreaterThan(scrollAt);
    expect(sheetBody.indexOf('<PlanPanelHeader')).toBeGreaterThan(scrollAt);
    // The CTA stays pinned below it — that one is an action, not content.
    expect(sheetBody.indexOf('<AqPrimaryButton')).toBeGreaterThan(sheetBody.indexOf('</ScrollView>'));
    // And the scroll must claim the leftover height, or a short plan would
    // leave the button floating mid-screen instead of at the bottom edge.
    expect(sheetBody).toContain('style={{ flex: 1 }}');
    expect(sheetBody).not.toContain('flexGrow: 0');
  });

  it('shows the real sessions where the onboarding screen shows locked rows', () => {
    expect(preview).toContain('newPlan.sessions.map(');
    expect(preview).toContain('workoutExercisesFromPlan(newPlan, i18n.language, index)');
    expect(preview).toContain('sessionMuscleGroups(exercises)');
    expect(preview).toContain('workout:muscleGroups.');
    expect(preview).toContain("'myPlan:workouts.setsDuration' : 'myPlan:workouts.setsReps'");
    expect(preview).toContain("t('myPlan:workouts.rest', { seconds: exercise.rest })");
    // The acquisition teaser's blurred rows must never reach a plan the user
    // owns. Comment-stripped: the file legitimately NAMES what it refuses to
    // render, and that rationale is worth keeping.
    expect(code(preview)).not.toContain('PlanLockedPreview');
    expect(code(preview)).not.toContain('showPlaceholderBars');
  });

  it('lets AJ narrate from the real plan, through the tested pure builder', () => {
    expect(preview).toContain('buildSwapNarration(tLoose, {');
    expect(preview).toContain('swapPreviewWeek(newPlan)');
    expect(preview).toContain('workoutSwapComparison(previousPlan, newPlan)');
    expect(preview).toContain('narrationLines.map(');
    // No hardcoded narration: every spoken line comes from the builder.
    expect(code(preview)).not.toMatch(/text=\{['"`][A-Za-zÀ-ÿ]/);
  });

  it('degrades gracefully on a catalog lookup miss instead of crashing the presentation', () => {
    expect(preview).toContain('try {');
    expect(preview).toContain('} catch {');
  });
});

describe('Program-swap copy ships in every language', () => {
  it('has the retitled loading screen and its way out', () => {
    for (const resource of [ptOnboarding, enOnboarding, esOnboarding]) {
      const swap = (resource.analyzing as Record<string, unknown>).swap as Record<string, string>;
      expect(swap).toBeTruthy();
      for (const key of ['title', 'back']) {
        expect(swap[key]).toBeTruthy();
      }
      // One line, so it must carry no break of its own, and must be its own
      // copy rather than the onboarding title.
      expect(swap.title).not.toContain('\\n');
      expect(swap.title).not.toBe(resource.analyzing.titleLine1);
      // Short enough to stay on one line at Anton 32pt on a 390pt screen.
      expect(swap.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('has every presentation string, including AJ\'s whole script', () => {
    const panel = [
      'kicker', 'panelTitle', 'panelSubtitle', 'frequencyBadge_one', 'frequencyBadge_other',
      'statsSessions_one', 'statsSessions_other', 'statsExercises_one', 'statsExercises_other', 'cta',
    ];
    const script = [
      'intro', 'introNoName', 'daysFixed', 'daysFlexible', 'division',
      'volume', 'volumeSingleRest', 'volumeRestRange', 'changes',
      'changeSessionsMore_one', 'changeSessionsMore_other',
      'changeSessionsFewer_one', 'changeSessionsFewer_other',
      'changeExercisesMore_one', 'changeExercisesMore_other',
      'changeExercisesFewer_one', 'changeExercisesFewer_other',
      'changeSplit', 'closing',
    ];
    for (const resource of [ptTreino, enTreino, esTreino]) {
      const presentation = (resource as Record<string, unknown>).swapPresentation as Record<string, unknown>;
      expect(presentation).toBeTruthy();
      for (const key of panel) expect(presentation[key]).toBeTruthy();
      const aj = presentation.aj as Record<string, string>;
      expect(aj).toBeTruthy();
      for (const key of script) expect(aj[key]).toBeTruthy();
      // The named greeting must actually interpolate the name.
      expect(aj.intro).toContain('{{name}}');
      expect(aj.introNoName).not.toContain('{{name}}');
    }
  });

  it('keeps the three locales structurally identical, so no language loses a line', () => {
    const shape = (value: unknown): string[] =>
      Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) => (child && typeof child === 'object'
          ? shape(child).map((inner) => `${key}.${inner}`)
          : [key]))
        .sort();
    const pt = shape((ptTreino as Record<string, unknown>).swapPresentation);
    expect(shape((enTreino as Record<string, unknown>).swapPresentation)).toEqual(pt);
    expect(shape((esTreino as Record<string, unknown>).swapPresentation)).toEqual(pt);
  });

  it('keeps the onboarding analysis steps at five, untouched by the swap copy', () => {
    for (const resource of [ptOnboarding, enOnboarding, esOnboarding]) {
      expect(Object.values(resource.analyzing.steps)).toHaveLength(5);
    }
  });

  it('left no dead copy behind from the replaced preview screen', () => {
    for (const resource of [ptTreino, enTreino, esTreino]) {
      expect((resource as Record<string, unknown>).swapPreview).toBeUndefined();
    }
  });
});

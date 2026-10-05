import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync(
  'modules/ajfit-rest-activity/ios/AJFitRestActivityModule.swift',
  'utf8',
);
const attributesSource = readFileSync(
  'modules/ajfit-rest-activity/ios/AJFitRestActivityAttributes.swift',
  'utf8',
);
const widgetSource = readFileSync(
  'plugins/rest-activity/ios/AJFitRestActivityExtension/AJFitRestActivityWidget.swift',
  'utf8',
);
const bundleSource = readFileSync(
  'plugins/rest-activity/ios/AJFitRestActivityExtension/AJFitRestActivityBundle.swift',
  'utf8',
);
const pluginSource = readFileSync('plugins/rest-activity/index.js', 'utf8');
const typesSource = readFileSync('src/types/restLiveActivity.ts', 'utf8');
const workoutScreenSource = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
const restSessionSource = readFileSync('src/state/RestSessionContext.tsx', 'utf8');
const storageSource = readFileSync(
  'modules/ajfit-rest-activity/ios/AJFitRestActivityStorage.swift',
  'utf8',
);
const finishRestIntentSource = readFileSync(
  'plugins/rest-activity/ios/AJFitRestActivityExtension/AJFitFinishRestIntent.swift',
  'utf8',
);
const addSecondsIntentSource = readFileSync(
  'plugins/rest-activity/ios/AJFitRestActivityExtension/AJFitAddRestSecondsIntent.swift',
  'utf8',
);
const localizationCatalog = JSON.parse(
  readFileSync(
    'plugins/rest-activity/ios/AJFitRestActivityExtension/Localizable.xcstrings',
    'utf8',
  ),
) as {
  strings: Record<string, { localizations: Record<string, unknown> }>;
};
const logoImageSet = JSON.parse(
  readFileSync(
    'plugins/rest-activity/ios/AJFitRestActivityExtension/Assets.xcassets/AJFitLogo.imageset/Contents.json',
    'utf8',
  ),
) as {
  images: Array<{ filename?: string; scale: string }>;
  properties: { 'template-rendering-intent': string };
};
const moduleConfig = JSON.parse(
  readFileSync('modules/ajfit-rest-activity/expo-module.config.json', 'utf8'),
) as {
  platforms: string[];
  apple: { modules: string[] };
  android: { modules: string[] };
};
const appConfig = JSON.parse(readFileSync('app.json', 'utf8')) as {
  expo: { plugins: Array<string | [string, unknown]> };
};

describe('AJFitRestActivity Apple module', () => {
  it('registers the Swift module without unregistering Android', () => {
    expect(moduleConfig.platforms).toEqual(['apple', 'android']);
    expect(moduleConfig.apple.modules).toEqual(['AJFitRestActivityModule']);
    expect(moduleConfig.android.modules).toEqual([
      'com.ajfit.restactivity.AJFitRestActivityModule',
    ]);
    expect(moduleSource).toContain('Name("AJFitRestActivity")');
    expect(moduleSource).toContain('Function("getCapabilities")');
    expect(moduleSource).toContain('AsyncFunction("start")');
    expect(moduleSource).toContain('AsyncFunction("update")');
    expect(moduleSource).toContain('AsyncFunction("end")');
    expect(moduleSource).toContain('AsyncFunction("cleanup")');
  });

  it('derives capability from ActivityKit authorization', () => {
    expect(moduleSource).toContain('import ActivityKit');
    expect(moduleSource).toContain(
      'ActivityAuthorizationInfo().areActivitiesEnabled',
    );
    expect(moduleSource).toContain('"ios-live-activity"');
    expect(moduleSource).toContain('"none"');
  });

  it('correlates one activity by workout session id', () => {
    expect(attributesSource).toContain('public let sessionId: String');
    expect(moduleSource).toContain('RestActivity.activities.first');
    expect(moduleSource).toContain(
      'activity.attributes.sessionId == sessionId',
    );
    expect(moduleSource).toContain('RestActivity.request(');
    expect(moduleSource).toContain(
      'existingActivity.update(content, alertConfiguration: alert)',
    );
  });

  it('uses absolute dates and staleDate without a ticking native value', () => {
    expect(attributesSource).toContain('public var startedAt: Date');
    expect(attributesSource).toContain('public var endsAt: Date');
    expect(moduleSource).toContain(
      'staleDate: state.phase == .resting || state.phase == .cardioRunning',
    );
    expect(`${moduleSource}\n${attributesSource}`).not.toContain(
      'remainingSeconds',
    );
  });

  it('extends the same ActivityKit schema and widget with cardio states', () => {
    expect(attributesSource).toContain('case cardioRunning = "cardio_running"');
    expect(attributesSource).toContain('case cardioPaused = "cardio_paused"');
    expect(attributesSource).toContain('case cardioCompleted = "cardio_completed"');
    expect(attributesSource).toContain('case finishWorkout = "finish_workout"');
    expect(attributesSource).toContain('phase == .cardioRunning && isStale');
    expect(moduleSource).toContain('materializedNextAction == .finishWorkout');
    expect(widgetSource).toContain('private struct CardioLockScreenView: View');
    expect(widgetSource).toContain('CardioTimerText(state: context.state');
    expect(localizationCatalog.strings.cardio_activity_completed).toBeDefined();
    expect(localizationCatalog.strings.cardio_activity_finish_workout).toBeDefined();
  });

  it('models and renders a workout with zero completed sets before any rest', () => {
    expect(attributesSource).toContain('case workoutActive = "workout_active"');
    expect(attributesSource).toContain('public var endsAt: Date?');
    expect(moduleSource).toContain('materializedPhase == .workoutActive');
    expect(moduleSource).toContain('setIndex >= 0 && setIndex < totalSets');
    expect(widgetSource).toContain('private struct InWorkoutLockScreenView: View');
    expect(widgetSource).toContain('case .workoutActive, .nextSet, .nextExercise:');
    expect(localizationCatalog.strings.workout_activity_active).toBeDefined();
    expect(localizationCatalog.strings.workout_activity_title).toBeDefined();
  });

  it('keeps the system activity reusable between rests and ends it with the workout', () => {
    expect(moduleSource).toContain(
      'await activity.update(dormantContent(for: activity, reason: reason))',
    );
    expect(moduleSource).toContain(
      'await activity.end(finalContent, dismissalPolicy: .immediate)',
    );
    expect(moduleSource).toContain('if reason == "workout_ended"');
  });

  it('enumerates and immediately dismisses orphaned activities during cleanup', () => {
    expect(moduleSource).toContain('func cleanup() async');
    expect(moduleSource).toContain('let activities = RestActivity.activities');
    expect(moduleSource).toContain('reason: "cleanup"');
    expect(moduleSource).toContain('dismissalPolicy: .immediate');
  });
});

describe('versioned Live Activity extension', () => {
  it('ships a CNG plugin and declares the EAS extension contract', () => {
    expect(appConfig.expo.plugins).toContain('./plugins/rest-activity');
    expect(pluginSource).toContain("const TARGET_NAME = 'AJFitRestActivityExtension'");
    expect(pluginSource).toContain("const EXTENSION_BUNDLE_SUFFIX = 'RestActivity'");
    expect(pluginSource).toContain("const DEPLOYMENT_TARGET = '16.4'");
    expect(pluginSource).toContain('appExtensions');
    expect(pluginSource).toContain('NSSupportsLiveActivities: true');
    expect(pluginSource).toContain('PBXNativeTarget');
    expect(pluginSource).toContain('com.apple.product-type.app-extension');
    expect(pluginSource).toContain('Embed Foundation Extensions');
    expect(pluginSource).toContain('PBXTargetDependency');
    expect(pluginSource).toContain('PBXContainerItemProxy');
    expect(pluginSource).toContain('addTargetDependency');
    expect(pluginSource).toContain("const APP_LOGO_FILE = 'aj-logo.png'");
    expect(pluginSource).toContain("const ASSET_CATALOG = 'Assets.xcassets'");
    expect(pluginSource).toContain("const LOGO_IMAGESET = 'AJFitLogo.imageset'");
    expect(pluginSource).toContain(
      "const RESOURCE_FILES = ['Localizable.xcstrings', ASSET_CATALOG]",
    );
    expect(pluginSource).toContain("'../../assets/aj-logo.png'");
    expect(pluginSource).toContain(
      'fs.cpSync(assetCatalogTemplate, targetAssetCatalog, { recursive: true })',
    );
    expect(pluginSource).toContain("{ filename: APP_LOGO_FILE, pixels: 24 }");
    expect(pluginSource).toContain("{ filename: 'aj-logo@2x.png', pixels: 48 }");
    expect(pluginSource).toContain("{ filename: 'aj-logo@3x.png', pixels: 72 }");
    expect(pluginSource).toContain("execFileSync(");
    expect(pluginSource).toContain("'/usr/bin/sips'");
    expect(pluginSource).toContain("'PBXResourcesBuildPhase'");
  });

  it('does not add storage sharing or push entitlements preemptively', () => {
    expect(pluginSource).not.toContain('com.apple.security.application-groups');
    expect(pluginSource).not.toContain('aps-environment');
    expect(pluginSource).not.toContain('AppGroup');
  });

  it('versions the Widget Extension sources and WidgetKit plist', () => {
    expect(
      existsSync(
        'plugins/rest-activity/ios/AJFitRestActivityExtension/Info.plist',
      ),
    ).toBe(true);
    expect(bundleSource).toContain('@main');
    expect(bundleSource).toContain('AJFitRestActivityWidget()');
    expect(widgetSource).toContain(
      'ActivityConfiguration(for: AJFitRestActivityAttributes.self)',
    );
  });

  it('defines Lock Screen plus compact, minimal and expanded Dynamic Island UI', () => {
    expect(widgetSource).toContain(
      'RestLockScreenView(state: context.state, phase: phase, sessionId: context.attributes.sessionId)',
    );
    expect(widgetSource).toContain('DynamicIsland {');
    expect(widgetSource).toContain('DynamicIslandExpandedRegion(.leading)');
    expect(widgetSource).toContain('DynamicIslandExpandedRegion(.trailing)');
    expect(widgetSource).toContain('DynamicIslandExpandedRegion(.center)');
    expect(widgetSource).toContain('DynamicIslandExpandedRegion(.bottom)');
    expect(widgetSource).toContain('compactLeading:');
    expect(widgetSource).toContain('compactTrailing:');
    expect(widgetSource).toContain('minimal:');
  });

  it('puts countdown in compact leading, progress in trailing, and countdown in minimal', () => {
    expect(widgetSource).toContain('Image(systemName: "stopwatch")');
    expect(widgetSource).toContain('private struct RestSetProgressRing: View');

    const leading = widgetSource.slice(
      widgetSource.indexOf('private struct RestingCompactLeadingView'),
      widgetSource.indexOf('private struct RestingCompactTrailingView'),
    );
    const trailing = widgetSource.slice(
      widgetSource.indexOf('private struct RestingCompactTrailingView'),
      widgetSource.indexOf('private struct RestingMinimalView'),
    );
    const minimal = widgetSource.slice(
      widgetSource.indexOf('private struct RestingMinimalView'),
      widgetSource.indexOf('private struct NextSetCompactLeadingView'),
    );
    expect(leading).toContain('timerInterval: state.timerRange');
    expect(leading).toContain('countsDown: true');
    expect(leading).not.toContain('RestSetProgressRing');
    expect(trailing).toContain('RestSetProgressRing(');
    expect(trailing).toContain('currentSet: state.setIndex');
    expect(minimal).toContain('timerInterval: state.timerRange');
    expect(minimal).toContain('countsDown: true');
    expect(minimal).not.toContain('RestSetProgressRing');
    const compactPresentation = widgetSource.slice(
      widgetSource.indexOf('} compactLeading: {'),
      widgetSource.indexOf('.widgetURL(activeWorkoutURL)'),
    );
    expect(leading).toContain('.frame(width: 48, alignment: .leading)');
    expect(leading).toContain('.minimumScaleFactor(0.78)');
    expect(trailing).toContain('.fixedSize()');
    expect(widgetSource).not.toContain('.fixedSize(maxWidth:');
    expect(widgetSource).not.toContain('.keylineTint(');
    for (const expansiveModifier of [
      'frame(maxWidth: .infinity)',
      'GeometryReader',
      'containerRelativeFrame',
      'contentMargins(',
    ]) {
      expect(compactPresentation).not.toContain(expansiveModifier);
    }
    expect(compactPresentation).not.toContain('Spacer()');
    expect(compactPresentation).not.toContain('Capsule()');
    expect(compactPresentation).not.toContain('RoundedRectangle');
  });

  it('uses one static blue advance affordance for the next-action surfaces', () => {
    expect(widgetSource).toContain('private struct RestAdvanceIndicator: View');
    expect(widgetSource).toContain('Image(systemName: "forward.end.fill")');
    expect(widgetSource).toContain('.strokeBorder(ajFitBlue');
    expect(widgetSource).toContain('RestAdvanceIndicator(');
    expect(widgetSource).toContain('size: 20,');
    expect(widgetSource).not.toContain('Text("S\\(nextSetIndex)")');
    expect(widgetSource).not.toContain('Timer(');
    expect(widgetSource).not.toContain('withAnimation');
  });

  it('derives lightweight segmented progress locally from one-based set state', () => {
    const progressView = widgetSource.slice(
      widgetSource.indexOf('private struct RestSetProgressRing: View'),
      widgetSource.indexOf('private struct RestCountdownText: View'),
    );
    expect(progressView).toContain('let currentSet: Int');
    expect(progressView).toContain('let totalSets: Int');
    expect(progressView).toContain('let size: CGFloat');
    expect(progressView).toContain('private let maximumDiscreteSegments = 8');
    expect(progressView).toContain('ForEach(0..<safeTotalSets');
    expect(progressView).toContain('.trim(from: segmentStart(index), to: segmentEnd(index))');
    expect(progressView).toContain('if index + 1 == safeCurrentSet');
    expect(progressView).toContain('if index < safeCurrentSet');
    expect(progressView).toContain('.trim(from: 0, to: proportionalProgress)');
    expect(progressView).toContain('.frame(width: size, height: size)');
    expect(progressView).not.toContain('ActivityViewContext');
    expect(progressView).not.toContain('Timer');
  });

  it('previews every requested semantic surface state', () => {
    for (const state of [
      'resting 1/4',
      'resting 3/4',
      'resting 4/4',
      'next_set 2/4',
      'next_set 3/4',
      'compact resting',
      'minimal resting',
      'expanded resting',
      'compact next_set',
      'expanded next_set',
      'compact next_exercise',
      'expanded next_exercise',
      'Lock Screen resting',
      'Lock Screen next_set',
      'Lock Screen next_exercise',
    ]) {
      expect(widgetSource).toContain(state);
    }
  });

  it('uses the official app logo in every Lock Screen state', () => {
    expect(existsSync('assets/aj-logo.png')).toBe(true);
    expect(
      existsSync(
        'plugins/rest-activity/ios/AJFitRestActivityExtension/Assets.xcassets/AJFitLogo.imageset/Contents.json',
      ),
    ).toBe(true);
    expect(widgetSource).toContain('private struct AJFitLogo: View');
    expect(widgetSource).toContain('Image("AJFitLogo", bundle: .main)');
    expect(logoImageSet.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: 'aj-logo.png', scale: '1x' }),
        expect.objectContaining({ filename: 'aj-logo@2x.png', scale: '2x' }),
        expect.objectContaining({ filename: 'aj-logo@3x.png', scale: '3x' }),
      ]),
    );
    expect(logoImageSet.properties['template-rendering-intent']).toBe('original');
    const officialLogoView = widgetSource.slice(
      widgetSource.indexOf('private struct AJFitLogo: View'),
      widgetSource.indexOf('private struct RestSetProgressRing: View'),
    );
    expect(officialLogoView).toContain('.resizable()');
    expect(officialLogoView).toContain('.renderingMode(.original)');
    expect(officialLogoView).toContain('.scaledToFit()');
    // Size is now a parameter defaulting to the Lock Screen's 24.
    expect(officialLogoView).toContain('var size: CGFloat = 24');
    expect(officialLogoView).toContain('.frame(width: size, height: size)');
    expect(officialLogoView).not.toContain('Text("AJ")');
    expect(officialLogoView).not.toContain('Circle()');

    const lockScreenPresentation = widgetSource.slice(
      widgetSource.indexOf('private struct RestHairlineDivider'),
      widgetSource.indexOf('private struct RestLockScreenView'),
    );
    expect(lockScreenPresentation).toContain('AJFitLogo()');
    expect(lockScreenPresentation).toContain('RestActivityCopy.restTitle');
    expect(lockScreenPresentation).toContain('RestActivityCopy.finishRest');
    expect(lockScreenPresentation).toContain('RestActivityCopy.backToWorkout');
    expect(lockScreenPresentation).not.toContain('AJFitGlyph()');
    expect(lockScreenPresentation).not.toContain('Text(RestActivityCopy.title)');
    expect(lockScreenPresentation).not.toContain('Text("AJ")');
    expect(lockScreenPresentation).not.toContain('Circle()');
  });

  it('renders all phases from the same typed state in expanded Dynamic Island', () => {
    const informationalPresentation = widgetSource.slice(
      widgetSource.indexOf('DynamicIsland {'),
      widgetSource.indexOf('} compactLeading: {'),
    );
    expect(informationalPresentation).toContain('ExpandedLeadingView(');
    expect(informationalPresentation).toContain('ExpandedTrailingView(');
    expect(informationalPresentation).toContain('ExpandedCenterView(');
    expect(informationalPresentation).toContain('ExpandedBottomView(');
    expect(attributesSource).toContain('public enum RestActivityPhase');
    expect(attributesSource).toContain('public var nextExerciseName: String?');
    expect(attributesSource).toContain('nextExerciseName ?? exerciseName');
  });

  it('renders the system countdown and deep-links to the allowlisted workout route', () => {
    expect(widgetSource).toContain('timerInterval: state.timerRange');
    expect(widgetSource).toContain('countsDown: true');
    expect(widgetSource).toContain('"ajfit://workout/active"');
    expect(widgetSource).toContain('.widgetURL(activeWorkoutURL)');
  });

  it('localizes fixed extension copy in pt-BR, en and es', () => {
    for (const key of [
      'rest_activity_title',
      'rest_activity_lock_screen_title',
      'rest_activity_series_format',
      'rest_activity_return_to_workout',
      'rest_activity_time_accessibility',
      'rest_activity_next_set',
      'rest_activity_next_exercise',
      'rest_activity_tap_to_continue',
      'rest_activity_finish_rest',
    ]) {
      expect(Object.keys(localizationCatalog.strings[key].localizations).sort()).toEqual([
        'en',
        'es',
        'pt-BR',
      ]);
      expect(widgetSource).toContain(key);
    }
    expect(widgetSource).not.toContain('AJ FIT · DESCANSO');
    expect(widgetSource).not.toContain('Toque para voltar ao treino');
  });

  it('uses one presentation phase for Lock Screen and Dynamic Island without set inference', () => {
    const productionWidget = widgetSource.slice(0, widgetSource.indexOf('#if DEBUG'));
    expect(widgetSource.match(/presentationPhase\(isStale: context\.isStale\)/g)).toHaveLength(2);
    expect(attributesSource).toContain('return nextAction.phase');
    expect(productionWidget).not.toMatch(/state\.setIndex\s*</);
    expect(productionWidget).not.toMatch(/state\.setIndex\s*\+/);
    expect(productionWidget).not.toContain('nextSetIndex ?? state.setIndex');
  });

  it('requests ActivityKit emphasis only behind explicit and semantic transition guards', () => {
    expect(moduleSource).toContain('shouldAlert && isRelevantTransition');
    expect(moduleSource).toContain('existingActivity.content.state.phase == .resting');
    expect(moduleSource).toContain('state.phase == state.nextAction.phase');
    expect(moduleSource).toContain('AlertConfiguration(');
    expect(moduleSource).toContain('sound: .default');
    expect(moduleSource).toContain('operation: "start", shouldAlert: false');
  });

  it('contains no Swift timer, second loop or background countdown task', () => {
    const nativePresentation = `${moduleSource}\n${widgetSource}`;
    for (const forbidden of [
      'Timer(',
      'Timer.scheduledTimer',
      'DispatchQueue.asyncAfter',
      'Task.sleep',
      'while true',
      'sleep(1)',
    ]) {
      expect(nativePresentation).not.toContain(forbidden);
    }
    for (const forbidden of [
      'AVPictureInPicture',
      'UIApplication.shared.windows',
      'performSelector',
    ]) expect(nativePresentation).not.toContain(forbidden);
  });
});

describe('Lock Screen "Finalizar descanso" button', () => {
  it('runs a scoped, non-discoverable LiveActivityIntent in the extension', () => {
    expect(finishRestIntentSource).toContain('import AppIntents');
    expect(finishRestIntentSource).toContain(
      'struct AJFitFinishRestIntent: LiveActivityIntent',
    );
    expect(finishRestIntentSource).toContain('static var isDiscoverable: Bool = false');
    expect(finishRestIntentSource).toContain('@Parameter(title: "Session ID")');
    expect(finishRestIntentSource).toContain('var sessionId: String');
  });

  it('flips the activity to its own next-action phase, mirroring dormantContent', () => {
    expect(finishRestIntentSource).toContain('activity.content.state.phase == .resting');
    expect(finishRestIntentSource).toContain('state.phase = state.nextAction.phase');
    expect(finishRestIntentSource).toContain('await activity.update(');
  });

  it('never calls Firestore, a capability token, or the workout engine directly', () => {
    for (const forbidden of [
      'externalWorkoutAction',
      'completeWorkoutSet',
      'AJFitSharedAuth',
      'URLSession',
      'Firestore',
    ]) {
      expect(finishRestIntentSource).not.toContain(forbidden);
    }
  });

  it('hands off to the main app through a plain App Group flag, not a token', () => {
    expect(finishRestIntentSource).toContain('AJFitRestActivityStorage.markPendingFinish');
    expect(storageSource).toContain('group.com.ajfit.app.restactivity');
    expect(storageSource).toContain('func markPendingFinish(sessionId: String)');
    expect(storageSource).toContain('func consumePendingFinish(sessionId: String) -> Bool');
    expect(storageSource).not.toContain('Capability');
    expect(storageSource).not.toContain('Keychain');
    expect(moduleSource).toContain('Function("consumePendingRestFinish")');
    expect(moduleSource).toContain('AJFitRestActivityStorage.consumePendingFinish');
  });

  it('ships both new files through the extension build and keeps the shared storage file single-sourced', () => {
    expect(pluginSource).toContain("'AJFitRestActivityStorage.swift'");
    expect(pluginSource).toContain("'AJFitFinishRestIntent.swift'");
    expect(pluginSource).toContain(
      "'../../modules/ajfit-rest-activity/ios/AJFitRestActivityStorage.swift'",
    );
  });

  it('renders the button only on iOS 17+, falling back to the existing tap-to-open hint', () => {
    expect(widgetSource).toContain('private struct RestFinishButton: View');
    expect(widgetSource).toContain('if #available(iOS 17.0, *)');
    expect(widgetSource).toContain('Button(intent: AJFitFinishRestIntent(sessionId: sessionId))');
    expect(widgetSource).toContain('RestFinishButton(sessionId: sessionId)');
  });

  it('compiles both intents into the main AJFit app target too — LiveActivityIntent.perform() runs there, not in the extension', () => {
    expect(pluginSource).toContain('APP_TARGET_INTENT_FILES');
    expect(pluginSource).toContain("'AJFitFinishRestIntent.swift'");
    expect(pluginSource).toContain("'AJFitAddRestSecondsIntent.swift'");
    expect(pluginSource).toContain('function copyAppTargetIntentFiles');
    expect(pluginSource).toContain('function addRestActivityIntentsToAppTarget');
    expect(pluginSource).toContain('xcodeProject.hasFile(relativePath)');
    expect(pluginSource).toContain('xcodeProject.addSourceFile(');
    expect(pluginSource).toContain('xcodeProject.getFirstTarget()');
    expect(pluginSource).toContain('xcodeProject.getFirstProject().firstProject.mainGroup');
    expect(pluginSource).toContain('copyAppTargetIntentFiles(');
    expect(pluginSource).toContain('addRestActivityIntentsToAppTarget(');
  });

  it('resolves shared types via canImport instead of forking the intent source per target', () => {
    expect(finishRestIntentSource).toContain('#if canImport(AJFitRestActivity)');
    expect(finishRestIntentSource).toContain('#endif');
  });

  it('imports AJFitRestActivity with an explicit access level, matching ExpoModulesProvider.swift in the same app target', () => {
    // A plain `import` here is ambiguous (SE-0409) against the explicit
    // `internal import AJFitRestActivity` Expo's autolinking codegen
    // already emits for the same module in the same AJFit target.
    expect(finishRestIntentSource).toContain('internal import AJFitRestActivity');
    expect(finishRestIntentSource).not.toMatch(/^import AJFitRestActivity$/m);
  });
});

describe('Live Activity schema evolution — the empty-card root cause', () => {
  // A ContentState persisted by an older build must still decode. The
  // synthesized initializer throws on a missing required key, and that throw
  // does more than blank the card: it also makes `Activity.activities` skip
  // the Activity, so cleanup()/end() can never dismiss it and it survives
  // reinstalls. Verified by decoding a pre-`workoutName` payload.
  it('decodes tolerantly so an older-schema Activity can never blank or orphan the card', () => {
    expect(attributesSource).toContain('public init(from decoder: Decoder) throws');
    expect(attributesSource).toContain('decodeIfPresent(String.self, forKey: .workoutName) ?? ""');
    expect(attributesSource).toContain('decodeIfPresent(String.self, forKey: .exerciseName) ?? ""');
    expect(attributesSource).toContain('decodeIfPresent(RestActivityPhase.self, forKey: .phase)');
    expect(attributesSource).toContain('decodeIfPresent(RestActivityNextAction.self, forKey: .nextAction)');
    // No required decode may remain in the initializer.
    const decodeInit = attributesSource.slice(
      attributesSource.indexOf('public init(from decoder: Decoder) throws'),
      attributesSource.indexOf('public var timerEndsAt'),
    );
    expect(decodeInit).not.toMatch(/container\.decode\(/);
  });

  // `startedAt...timerEndsAt` built inline is a runtime trap when endsAt < startedAt,
  // and a trapped widget process renders as an empty card, not a partial one.
  it('routes every timer interval through the clamped timerRange', () => {
    expect(attributesSource).toContain('public var timerRange: ClosedRange<Date>');
    expect(attributesSource).toContain('end >= startedAt ? startedAt...end : startedAt...startedAt');
    expect(widgetSource).not.toContain('state.startedAt...state.timerEndsAt');
    expect(widgetSource).toContain('timerInterval: state.timerRange');
  });

  it('never renders an empty text slot for a field an older schema did not carry', () => {
    expect(widgetSource).toContain('if !state.workoutName.isEmpty');
    // Both cards guard the same derivation now, so one pattern covers both.
    expect(widgetSource.match(/if !state\.upcomingExerciseName\.isEmpty/g)).toHaveLength(4);
    expect(widgetSource.match(/if !state\.workoutName\.isEmpty/g)).toHaveLength(3);
  });

  it('previews the degraded states that must still render', () => {
    for (const name of [
      'rest reference — next_set + load',
      'rest — no load line',
      'rest — next_exercise',
      'rest — legacy decode, no workoutName',
      'rest — expired timer',
      'rest — inverted interval (clamped)',
    ]) {
      expect(widgetSource).toContain(name);
    }
  });
});

describe('Lock Screen "+15s" button', () => {
  it('runs a scoped, non-discoverable LiveActivityIntent that only extends endsAt', () => {
    expect(addSecondsIntentSource).toContain('struct AJFitAddRestSecondsIntent: LiveActivityIntent');
    expect(addSecondsIntentSource).toContain('static var isDiscoverable: Bool = false');
    expect(addSecondsIntentSource).toContain('activity.content.state.phase == .resting');
    expect(addSecondsIntentSource).toContain('state.endsAt = extendedEndsAt');
    expect(addSecondsIntentSource).not.toContain('state.startedAt =');
  });

  it('shares the same dual-target import story as AJFitFinishRestIntent', () => {
    expect(addSecondsIntentSource).toContain('#if canImport(AJFitRestActivity)');
    expect(addSecondsIntentSource).toContain('internal import AJFitRestActivity');
    expect(addSecondsIntentSource).toContain('#endif');
  });

  it('accumulates pending seconds across repeated taps instead of a one-shot flag', () => {
    expect(addSecondsIntentSource).toContain('AJFitRestActivityStorage.markPendingAddSeconds');
    expect(storageSource).toContain('func markPendingAddSeconds(sessionId: String, seconds: Int)');
    expect(storageSource).toContain('func consumePendingAddSeconds(sessionId: String) -> Int');
    expect(moduleSource).toContain('Function("consumePendingAddSeconds")');
    expect(moduleSource).toContain('AJFitRestActivityStorage.consumePendingAddSeconds');
  });

  it('renders the button only on iOS 17+ and never as a dead widgetURL-only fallback', () => {
    expect(widgetSource).toContain('private struct RestAddSecondsButton: View');
    expect(widgetSource).toContain('Button(intent: AJFitAddRestSecondsIntent(sessionId: sessionId))');
    expect(widgetSource).toContain('RestAddSecondsButton(sessionId: sessionId)');
  });
});

describe('Lock Screen redesign — reference-matched composition', () => {
  it('threads workoutName through the ContentState wire contract', () => {
    expect(attributesSource).toContain('public var workoutName: String');
    expect(moduleSource).toContain('@Field var workoutName: String = ""');
    expect(moduleSource).toContain('!workoutName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty');
  });

  it('shows the WORKOUT elapsed time in the header, never this rest duration', () => {
    expect(widgetSource).toContain('Text(state.workoutName)');
    expect(widgetSource).toContain('private struct WorkoutElapsedText: View');
    expect(widgetSource).toContain('state.workoutElapsedRange');
    expect(widgetSource).toContain('countsDown: false');
    // The old header stat was `endsAt - startedAt` = the rest's own duration,
    // a different quantity from what the reference shows.
    expect(widgetSource).not.toContain('totalDurationText');
  });

  it('carries workoutStartedAt as an OPTIONAL field end to end', () => {
    expect(typesSource).toContain('workoutStartedAt?: number');
    expect(attributesSource).toContain('public var workoutStartedAt: Date?');
    expect(attributesSource).toContain('decodeIfPresent(Date.self, forKey: .workoutStartedAt)');
    expect(moduleSource).toContain('@Field var workoutStartedAt: Int64?');
    // Omitted rather than rendered wrong when an older Activity lacks it.
    expect(widgetSource).toContain('if let workoutElapsedRange = state.workoutElapsedRange');
  });

  it('reuses the workout engine clock instead of starting a second one', () => {
    expect(workoutScreenSource).toContain('workoutStartedAt: workoutStartedAtMs ?? undefined');
    expect(restSessionSource).toContain('workoutStartedAt?: number');
  });

  it('uses a live system-ticking linear progress bar instead of the circular ring on the Lock Screen', () => {
    expect(widgetSource).toContain('private struct RestLinearProgressBar: View');
    expect(widgetSource).toContain('timerInterval: state.timerRange');
    expect(widgetSource).toContain('.progressViewStyle(.linear)');
    expect(widgetSource).toContain('RestLinearProgressBar(state: state)');
  });

  // REGRESSION: the bare `ProgressView(timerInterval:countsDown:)` overload is
  // constrained to `CurrentValueLabel == DefaultDateProgressLabel`, which draws
  // a SECOND countdown under the bar. Both labels must stay explicit.
  it('passes both ProgressView labels explicitly so no duplicate countdown is drawn', () => {
    const bar = widgetSource.slice(
      widgetSource.indexOf('private struct RestLinearProgressBar'),
      widgetSource.indexOf('private struct RestAdvanceIndicator'),
    );
    // `currentValueLabel:` is only expressible on the 4-argument overload, so
    // its presence is itself the proof the defaulted label is not in play.
    expect(bar).toContain('currentValueLabel:');
    expect(bar.match(/EmptyView\(\)/g)).toHaveLength(2);
  });

  // REGRESSION: the footer is the LAST child of the card. Anything that
  // inflates the blocks above it pushes the two actions out of the Lock
  // Screen's height budget, which is how they vanished on device.
  it('keeps the rest card inside its height budget with an explicit, auditable vertical rhythm', () => {
    const card = widgetSource.slice(
      widgetSource.indexOf('private func restCardBlocks'),
      widgetSource.indexOf('private func inWorkoutCardBlocks'),
    );
    // The builder is inlined into its caller's stack, so the rhythm is the
    // per-block padding; the callers supply `VStack(spacing: 0)`.
    expect(widgetSource.match(/VStack\(alignment: \.leading, spacing: 0\)/g)!.length).toBeGreaterThanOrEqual(3);
    expect(card).not.toMatch(/VStack\(alignment: \.leading, spacing: (?!0\))/);
    // The Lock Screen countdown is its own smaller view; the 42pt one belongs
    // to the Dynamic Island's expanded region only.
    expect(card).toContain('RestLockScreenCountdownText(state: state)');
    expect(card).not.toContain('RestCountdownText(state: state)');
    expect(widgetSource).toContain('private struct RestLockScreenCountdownText: View');
  });

  it('labels the upcoming exercise with "Próximo" distinctly from the Dynamic Island caps label', () => {
    expect(widgetSource).toContain('rest_activity_next_label');
    expect(widgetSource).toContain('RestActivityCopy.nextLabel');
    expect(localizationCatalog.strings.rest_activity_next_label).toBeDefined();
    expect(localizationCatalog.strings.rest_activity_add_seconds).toBeDefined();
  });

  it('lays out the footer as exactly two actions split by a vertical divider, matching the reference', () => {
    const footer = widgetSource.slice(
      widgetSource.indexOf('// 8 — FOOTER'),
      widgetSource.indexOf('private func inWorkoutCardBlocks'),
    );
    expect(footer).toContain('RestAddSecondsButton(sessionId: sessionId)');
    expect(footer).toContain('RestFinishButton(sessionId: sessionId)');
    expect(footer).toContain('.frame(width: 1, height: 26)');
    // Exactly two — no third action crept in.
    expect(footer.match(/Rest\w+Button\(sessionId: sessionId\)/g)).toHaveLength(2);
  });

  // REGRESSION: applied to the Button from the outside, the frame expands the
  // laid-out result while the hit region stays glued to the text.
  it('expands the tap target inside each button label, not around the button', () => {
    const label = widgetSource.slice(
      widgetSource.indexOf('private struct RestFooterActionLabel'),
      widgetSource.indexOf('private struct RestAddSecondsButton'),
    );
    expect(label).toContain('.frame(maxWidth: .infinity)');
    expect(label).toContain('.contentShape(Rectangle())');
  });

  it('renders the 8 reference blocks in order, with the load line conditional', () => {
    const card = widgetSource.slice(
      widgetSource.indexOf('private func restCardBlocks'),
      widgetSource.indexOf('private func inWorkoutCardBlocks'),
    );
    const order = [
      '// 2 — STATUS',
      '// 3 — TIMER',
      '// 4 — PROGRESS',
      '// 5 —',
      '// 6 —',
      '// 7 — DIVIDER',
      '// 8 — FOOTER',
    ].map((marker) => card.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(card).toMatch(/if (?:restingDiagnosticStage >= \.next, )?let lastSetLoadLabel = state\.lastSetLoadLabel/);
  });

  it('puts "Próximo" and the exercise name on one line, as in the reference', () => {
    const card = widgetSource.slice(
      widgetSource.indexOf('// 5 —'),
      widgetSource.indexOf('// 6 —'),
    );
    expect(card).toContain('HStack(alignment: .firstTextBaseline');
    expect(card).toContain('RestActivityCopy.nextLabel');
    expect(card).toContain('upcomingExerciseName');
  });

  it('threads the completed-set load through the wire contract without inventing a zero', () => {
    expect(attributesSource).toContain('public var lastSetLoadLabel: String?');
    expect(moduleSource).toContain('@Field var lastSetLoadLabel: String?');
    // Blank normalizes to nil so the "omit the line" branch has one source.
    expect(moduleSource).toContain('lastSetLoadLabel: {');
  });

  it('drops the removed-by-design Lock Screen circular ring from both main states, keeping it only for Dynamic Island', () => {
    const lockScreenStates = widgetSource.slice(
      widgetSource.indexOf('private struct RestingLockScreenView'),
      widgetSource.indexOf('private struct RestLockScreenView'),
    );
    expect(lockScreenStates).not.toContain('RestSetProgressRing');
    // Still a real, used component — just no longer from these two views.
    expect(widgetSource).toContain('private struct RestSetProgressRing: View');
  });
});


describe('Lock Screen countdown — proven device root cause', () => {
  // Binary isolation on device: .minimal rendered, .header rendered, adding
  // this view WITH .fixedSize() blanked the entire card, and the identical
  // view WITHOUT it rendered and counted down. Never reintroduce it.
  it('never applies .fixedSize() to a system-driven timer Text', () => {
    // Comments intentionally discuss `.fixedSize()`; assert against code only.
    const code = widgetSource
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

    const countdown = code.slice(
      code.indexOf('private struct RestLockScreenCountdownText'),
      code.indexOf('private struct WorkoutElapsedText'),
    );
    expect(countdown).toContain('timerInterval: state.timerRange');
    expect(countdown).toContain('countsDown: true');
    expect(countdown).not.toContain('.fixedSize()');

    // The rule is specifically about SYSTEM-DRIVEN timers: no struct that
    // builds a `Text(timerInterval:)` may also apply `.fixedSize()`.
    // (A static shape like RestSetProgressRing in the Dynamic Island's
    // compact region may keep it — that one is not time-driven.)
    const offenders = code
      .split(/(?=private struct )/)
      .filter((block) => block.includes('timerInterval:') && block.includes('.fixedSize()'))
      .map((block) => block.slice(0, block.indexOf(':')).replace('private struct ', ''));
    expect(offenders).toEqual([]);
  });

  // REGRESSION: `Text(timerInterval:)` reserves the width of its widest
  // possible value. Giving the elapsed time the layout priority let it claim
  // that width first and starved the workout name to zero, so the header read
  // as "[logo] 22:07" with the name invisible instead of truncated.
  it('lets the workout name win header width over the elapsed timer', () => {
    const header = widgetSource.slice(
      widgetSource.indexOf('// 1 — HEADER'),
      widgetSource.indexOf('restCardBlocks(state: state, sessionId: sessionId)'),
    );
    expect(header).toContain('Text(state.workoutName)');
    expect(header).toContain('.truncationMode(.tail)');
    // priority belongs to the name...
    const nameBlock = header.slice(header.indexOf('Text(state.workoutName)'), header.indexOf('Spacer('));
    expect(nameBlock).toContain('.layoutPriority(1)');
    // ...and the timer is bounded by an explicit width instead.
    const elapsedBlock = header.slice(header.indexOf('WorkoutElapsedText(range:'));
    expect(elapsedBlock).toContain('.frame(width: 54, alignment: .trailing)');
    expect(elapsedBlock).not.toContain('.layoutPriority(');
  });

  it('gives each footer action a full-half, padded touch target', () => {
    const label = widgetSource.slice(
      widgetSource.indexOf('private struct RestFooterActionLabel'),
      widgetSource.indexOf('private struct RestAddSecondsButton'),
    );
    // Order matters: pad first, then expand, then make the whole area hittable.
    expect(label.indexOf('.padding(.vertical, 10)')).toBeLessThan(label.indexOf('.frame(maxWidth: .infinity)'));
    expect(label.indexOf('.frame(maxWidth: .infinity)')).toBeLessThan(label.indexOf('.contentShape(Rectangle())'));
  });

  it('leaves no diagnostic scaffolding in production code', () => {
    for (const leftover of [
      'RestingDiagnosticStage',
      'restingDiagnosticStage',
      'RestingTimerVariant',
      'restingTimerVariant',
      'RestDiagnostics',
      'RESTING OK',
      'import OSLog',
    ]) {
      expect(widgetSource).not.toContain(leftover);
    }
  });
});


describe('Upcoming series and the in-workout card', () => {
  it('derives the upcoming series from the projection, never from set math in Swift', () => {
    expect(attributesSource).toContain('public var upcomingSeries: (number: Int, total: Int)?');
    // next set of the SAME exercise -> the projection's own nextSetIndex
    expect(attributesSource).toContain('return (nextSetIndex, totalSets)');
    // first set of the NEXT exercise -> that exercise's own set count
    expect(attributesSource).toContain('return (1, nextExerciseTotalSets)');
    expect(attributesSource).toContain('case .finishWorkout:');
  });

  it('carries the next exercise set count end to end, since totalSets describes the finished one', () => {
    expect(typesSource).toContain('nextExerciseTotalSets: number');
    expect(attributesSource).toContain('public var nextExerciseTotalSets: Int?');
    expect(attributesSource).toContain('decodeIfPresent(Int.self, forKey: .nextExerciseTotalSets)');
    expect(moduleSource).toContain('@Field var nextExerciseTotalSets: Int?');
    expect(workoutScreenSource).toContain('exercises[order[1]].sets.length');
  });

  it('shows the upcoming series during rest, sharing one line with the load', () => {
    const card = widgetSource.slice(
      widgetSource.indexOf('// 6 — Secondary line'),
      widgetSource.indexOf('// 7 — DIVIDER'),
    );
    expect(card).toContain('RestActivityCopy.nextSeries(series.number, series.total)');
    expect(card).toContain('state.lastSetLoadLabel');
    // each half independently omitted
    expect(card).toContain('if state.upcomingSeries != nil || state.lastSetLoadLabel != nil');
    expect(localizationCatalog.strings.rest_activity_next_series_format).toBeDefined();
  });

  it('rebuilds the in-workout card as header + Próximo + series + one action', () => {
    const card = widgetSource.slice(
      widgetSource.indexOf('private func inWorkoutCardBlocks'),
      widgetSource.indexOf('private struct ExpandedLeadingView'),
    );
    expect(card).toContain('WorkoutElapsedText(range: workoutElapsedRange)');
    expect(card).toContain('RestActivityCopy.nextLabel');
    expect(card).toContain('state.upcomingExerciseName');
    expect(card).toContain('RestActivityCopy.currentSeries(series.number, series.total)');
    expect(card).toContain('BackToWorkoutButton()');
    // the oversized standalone exercise title is gone
    expect(card).not.toContain('size: 22, weight: .bold');
    expect(card).not.toContain('size: 26, weight: .bold');
  });

  it('keeps the in-workout card free of set completion and load editing', () => {
    const card = widgetSource.slice(
      widgetSource.indexOf('private func inWorkoutCardBlocks'),
      widgetSource.indexOf('private struct ExpandedLeadingView'),
    );
    for (const forbidden of ['CompleteSet', 'Stepper', 'completeSet', 'AdjustStepper', 'Button(intent:']) {
      expect(card).not.toContain(forbidden);
    }
  });

  it('returns to the app by deep link rather than an intent, reusing the footer styling', () => {
    const button = widgetSource.slice(
      widgetSource.indexOf('private struct BackToWorkoutButton'),
      widgetSource.indexOf('/// Covers every "no rest running" phase'),
    );
    expect(button).toContain('Link(destination: activeWorkoutURL)');
    expect(button).toContain('RestFooterActionLabel(');
    expect(button).not.toContain('intent:');
    expect(localizationCatalog.strings.rest_activity_back_to_workout).toBeDefined();
  });
});


describe('Dynamic Island — compact identity and expanded parity', () => {
  // Comments explain which labels were abolished, so assert against code only.
  const stripComments = (text: string) => text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const compact = () => stripComments(widgetSource.slice(
    widgetSource.indexOf('} compactLeading: {'),
    widgetSource.indexOf('      .widgetURL(activeWorkoutURL)'),
  ));

  it('carries no text in the compact regions', () => {
    // "AJ FIT" and "PROX. EX." were text the compact slot is too small to
    // render legibly; both labels are abolished there.
    expect(compact()).not.toContain('AJ FIT');
    expect(compact()).not.toMatch(/\bText\(/);
    // ...and their copy keys no longer have a Swift caller at all.
    expect(widgetSource).not.toContain('nextSetCompact');
    expect(widgetSource).not.toContain('nextExerciseCompact');
  });

  it('shows the logo in compactLeading whenever no countdown is running', () => {
    const leading = widgetSource.slice(
      widgetSource.indexOf('} compactLeading: {'),
      widgetSource.indexOf('} compactTrailing: {'),
    );
    expect(leading).toContain('case .workoutActive, .nextSet, .nextExercise, .cardioCompleted:');
    expect(leading).toContain('AJFitLogo(size: 21)');
    // a running rest still owns the slot with its countdown
    expect(leading).toContain('case .resting:');
    expect(leading).toContain('RestingCompactLeadingView(state: context.state)');
  });

  it('shows the existing blue-circled next icon in compactTrailing', () => {
    const trailing = widgetSource.slice(
      widgetSource.indexOf('} compactTrailing: {'),
      widgetSource.indexOf('} minimal: {'),
    );
    expect(trailing).toContain('case .workoutActive, .nextSet, .nextExercise:');
    expect(trailing).toContain('NextActionCompactIcon(phase: phase)');
    expect(trailing).toContain('RestingCompactTrailingView(state: context.state)');
    // reuses the existing affordance rather than a new design
    expect(widgetSource).toContain('private struct RestAdvanceIndicator: View');
    expect(widgetSource).toContain('Image(systemName: "forward.end.fill")');
    expect(widgetSource).toContain('.strokeBorder(ajFitBlue');
  });

  it('keeps minimal icon-only and consistent with compactTrailing', () => {
    const minimal = stripComments(widgetSource.slice(
      widgetSource.indexOf('} minimal: {'),
      widgetSource.indexOf('      .widgetURL(activeWorkoutURL)'),
    ));
    expect(minimal).not.toMatch(/\bText\(/);
    expect(minimal).toContain('NextActionCompactIcon(phase: phase)');
    expect(minimal).toContain('RestingMinimalView(state: context.state)');
  });

  // The island's bottom region has ~135pt once the leading/trailing row is
  // paid for, while `restCardBlocks` costs ~143pt — reusing that stack pushed
  // the footer actions out of view. The island therefore gets its own
  // arrangement while still sharing every component, datum and style.
  it('gives the expanded bottom its own compact arrangement, not the Lock Screen stack', () => {
    const bottom = widgetSource.slice(
      widgetSource.indexOf('private struct ExpandedRestingContent'),
      widgetSource.indexOf('struct AJFitRestActivityWidget: Widget'),
    );
    expect(bottom).not.toContain('restCardBlocks(');
    expect(bottom).not.toContain('inWorkoutCardBlocks(');
    // ...but the leaf components are the very same ones.
    expect(bottom).toContain('RestLockScreenCountdownText(state: state, size: 26)');
    expect(bottom).toContain('RestLinearProgressBar(state: state)');
    expect(bottom).toContain('RestActivityCopy.restTitle');
    expect(bottom).toContain('RestActivityCopy.nextLabel');
    expect(bottom).toContain('state.upcomingExerciseName');
    expect(bottom).toContain('RestActivityCopy.currentSeries(series.number, series.total)');
    // and the Lock Screen keeps its own stack, untouched
    expect(widgetSource.match(/restCardBlocks\(state: state, sessionId: sessionId\)/g)).toHaveLength(1);
    expect(widgetSource.match(/inWorkoutCardBlocks\(state: state\)/g)).toHaveLength(1);
  });

  it('keeps both rest actions and the back action visible in the expanded bottom', () => {
    const resting = widgetSource.slice(
      widgetSource.indexOf('private struct ExpandedRestingContent'),
      widgetSource.indexOf('/// Same reasoning as'),
    );
    // present, and NOT behind any conditional that could hide them
    expect(resting).toContain('RestAddSecondsButton(sessionId: sessionId, verticalPadding: 8)');
    expect(resting).toContain('RestFinishButton(sessionId: sessionId, verticalPadding: 8)');
    expect(resting).toContain('.frame(width: 1, height: 22)');
    const footer = resting.slice(resting.indexOf('RestAddSecondsButton'));
    expect(footer).not.toContain('if ');

    const inWorkout = widgetSource.slice(
      widgetSource.indexOf('private struct ExpandedInWorkoutContent'),
      widgetSource.indexOf('/// Expanded bottom is the only full-width region'),
    );
    expect(inWorkout).toContain('BackToWorkoutButton(verticalPadding: 8)');
    expect(inWorkout.slice(inWorkout.indexOf('BackToWorkoutButton'))).not.toContain('if ');
  });

  // REGRESSION: the countdown's reserved width used to be claimed first via
  // layoutPriority, pushing the next-exercise column off the right edge.
  it('bounds the countdown column so the next-exercise column stays on screen', () => {
    // Slice forward FROM the struct — RestLinearProgressBar also appears
    // earlier in the Lock Screen blocks, so a bare indexOf finds that one.
    const content = stripComments(
      widgetSource.slice(widgetSource.indexOf('private struct ExpandedRestingContent')),
    );
    const row = content.slice(0, content.indexOf('RestLinearProgressBar(state: state)'));
    // width-bounded, not prioritised, and never .fixedSize()
    expect(row).toContain('.frame(width: 74, alignment: .leading)');
    expect(row).not.toContain('layoutPriority');
    expect(row).not.toContain('.fixedSize()');
    // right column starts beside the countdown instead of hugging the edge
    expect(row).not.toContain('Spacer(');
    expect(row).not.toContain('alignment: .trailing');
    expect(row.match(/\.frame\(maxWidth: \.infinity, alignment: \.leading\)/g)).toHaveLength(2);
  });

  it('enlarges the logo only in the Dynamic Island, never on the Lock Screen', () => {
    // Lock Screen keeps the 24pt default — no explicit size anywhere in its
    // composition (rest blocks, in-workout blocks, cardio card).
    for (const marker of [
      'private struct RestingLockScreenView',
      'private struct InWorkoutLockScreenView',
      'private struct CardioLockScreenView',
    ]) {
      const from = widgetSource.indexOf(marker);
      const rest = widgetSource.slice(from + marker.length);
      // stop at the next top-level declaration so the slice cannot bleed
      const end = rest.search(/\nprivate (struct|func) /);
      const block = rest.slice(0, end === -1 ? undefined : end);
      expect(block).toContain('AJFitLogo()');
      expect(block).not.toMatch(/AJFitLogo\(size:/);
    }
    expect(widgetSource).toContain('var size: CGFloat = 24');

    // Island slots opt into larger sizes, bounded by their own room.
    const leading = widgetSource.slice(
      widgetSource.indexOf('private struct ExpandedLeadingView'),
      widgetSource.indexOf('private struct ExpandedTrailingView'),
    );
    expect(leading).toContain('AJFitLogo(size: 22)');
    const compactLeading = widgetSource.slice(
      widgetSource.indexOf('} compactLeading: {'),
      widgetSource.indexOf('} compactTrailing: {'),
    );
    expect(compactLeading).toContain('AJFitLogo(size: 21)');
    // compact must stay under the island's ~24pt content slot
    const compactSize = Number(compactLeading.match(/AJFitLogo\(size: (\d+)\)/)![1]);
    expect(compactSize).toBeLessThanOrEqual(22);

    // aspect ratio preserved, so the bump cannot distort the mark
    const logo = widgetSource.slice(
      widgetSource.indexOf('private struct AJFitLogo'),
      widgetSource.indexOf('private struct RestSetProgressRing'),
    );
    expect(logo).toContain('.resizable()');
    expect(logo).toContain('.scaledToFit()');
    expect(logo).toContain('.frame(width: size, height: size)');
  });

  it('still routes the expanded actions through the existing intents', () => {
    expect(widgetSource).toContain('Button(intent: AJFitAddRestSecondsIntent(sessionId: sessionId))');
    expect(widgetSource).toContain('Button(intent: AJFitFinishRestIntent(sessionId: sessionId))');
    expect(widgetSource).toContain('Link(destination: activeWorkoutURL)');
  });

  it('keeps the Lock Screen defaults untouched while the island opts into smaller sizes', () => {
    expect(widgetSource).toContain('var size: CGFloat = 30');
    expect(widgetSource).toContain('var verticalPadding: CGFloat = 10');
    const lockScreen = widgetSource.slice(
      widgetSource.indexOf('private func restCardBlocks'),
      widgetSource.indexOf('private func inWorkoutCardBlocks'),
    );
    expect(lockScreen).toContain('RestLockScreenCountdownText(state: state)');
    expect(lockScreen).toContain('RestAddSecondsButton(sessionId: sessionId)');
    expect(lockScreen).toContain('RestFinishButton(sessionId: sessionId)');
    expect(lockScreen).not.toContain('verticalPadding:');
    // no explicit countdown size override — it takes the 30pt default
    expect(lockScreen).not.toContain('RestLockScreenCountdownText(state: state, size:');
  });

  it('mirrors the Lock Screen header across expanded leading and trailing', () => {
    const leading = widgetSource.slice(
      widgetSource.indexOf('private struct ExpandedLeadingView'),
      widgetSource.indexOf('private struct ExpandedTrailingView'),
    );
    expect(leading).toContain('AJFitLogo(size: 22)');
    expect(leading).toContain('Text(state.workoutName)');
    expect(leading).toContain('.truncationMode(.tail)');

    const trailing = widgetSource.slice(
      widgetSource.indexOf('private struct ExpandedTrailingView'),
      widgetSource.indexOf('private struct ExpandedCenterView'),
    );
    expect(trailing).toContain('WorkoutElapsedText(range: workoutElapsedRange)');
  });

  it('wires every expanded region and keeps the interactive intents reachable', () => {
    const island = widgetSource.slice(
      widgetSource.indexOf('return DynamicIsland {'),
      widgetSource.indexOf('} compactLeading: {'),
    );
    for (const region of ['.leading', '.trailing', '.center', '.bottom']) {
      expect(island).toContain(`DynamicIslandExpandedRegion(${region})`);
    }
    expect(island).toContain('sessionId: context.attributes.sessionId');
    // the rest blocks carry the real buttons, so expanded gets them too
    expect(widgetSource).toContain('RestAddSecondsButton(sessionId: sessionId)');
    expect(widgetSource).toContain('RestFinishButton(sessionId: sessionId)');
    expect(widgetSource).toContain('BackToWorkoutButton()');
  });
});

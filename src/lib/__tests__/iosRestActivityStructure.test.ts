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
      'RestLockScreenView(state: context.state, phase: phase)',
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
    expect(leading).toContain('timerInterval: state.startedAt...state.endsAt');
    expect(leading).toContain('countsDown: true');
    expect(leading).not.toContain('RestSetProgressRing');
    expect(trailing).toContain('RestSetProgressRing(');
    expect(trailing).toContain('currentSet: state.setIndex');
    expect(minimal).toContain('timerInterval: state.startedAt...state.endsAt');
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
    expect(widgetSource).toContain('RestAdvanceIndicator(size: 20');
    expect(widgetSource).toContain('RestAdvanceIndicator(size: 24');
    expect(widgetSource).toContain('RestAdvanceIndicator(size: 22');
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
    expect(officialLogoView).toContain('.frame(width: 24, height: 24)');
    expect(officialLogoView).not.toContain('Text("AJ")');
    expect(officialLogoView).not.toContain('Circle()');

    const lockScreenPresentation = widgetSource.slice(
      widgetSource.indexOf('private struct RestingLockScreenView'),
      widgetSource.indexOf('private struct ExpandedLeadingView'),
    );
    expect(lockScreenPresentation).toContain('AJFitLogo()');
    expect(lockScreenPresentation).toContain('RestActivityCopy.restTitle');
    expect(lockScreenPresentation).toContain('RestActivityCopy.nextSet');
    expect(lockScreenPresentation).toContain('RestActivityCopy.nextExercise');
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
    expect(widgetSource).toContain('state.nextExerciseName ?? ""');
  });

  it('renders the system countdown and deep-links to the allowlisted workout route', () => {
    expect(widgetSource).toContain('timerInterval: state.startedAt...state.endsAt');
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
      'rest_activity_next_set_compact',
      'rest_activity_next_exercise',
      'rest_activity_next_exercise_compact',
      'rest_activity_tap_to_continue',
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

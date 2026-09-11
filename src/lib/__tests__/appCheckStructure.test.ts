import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('App Check structural security', () => {
  it('keeps Firebase products on the JavaScript SDK', () => {
    const source = [
      read('src/lib/firebase.ts'),
      read('src/lib/firebaseFunctions.ts'),
      read('src/services/progressPhotos.ts'),
      read('src/services/photoVault.ts'),
    ].join('\n');

    expect(source).toContain("from 'firebase/auth'");
    expect(source).toContain("from 'firebase/firestore'");
    expect(source).toContain("from 'firebase/storage'");
    expect(source).toContain("from 'firebase/functions'");
    expect(source).not.toContain('@react-native-firebase/');
  });

  it('makes the Android debug provider impossible in Release', () => {
    const gradle = read('modules/ajfit-app-check/android/build.gradle');
    const debug = read(
      'modules/ajfit-app-check/android/src/debug/java/com/ajfit/appcheck/AJFitAppCheckProvider.kt',
    );
    const release = read(
      'modules/ajfit-app-check/android/src/release/java/com/ajfit/appcheck/AJFitAppCheckProvider.kt',
    );

    expect(gradle).toContain("debugImplementation 'com.google.firebase:firebase-appcheck-debug'");
    expect(gradle).toContain(
      "releaseImplementation 'com.google.firebase:firebase-appcheck-playintegrity'",
    );
    expect(debug).toContain('DebugAppCheckProviderFactory');
    expect(release).toContain('PlayIntegrityAppCheckProviderFactory');
    expect(release).not.toContain('DebugAppCheckProviderFactory');
  });

  it('selects iOS debug/App Attest at compile time and never DeviceCheck', () => {
    const source = read('modules/ajfit-app-check/ios/AJFitAppCheckModule.swift');

    expect(source).toContain('#if DEBUG');
    expect(source).toContain('AppCheckDebugProviderFactory');
    expect(source).toContain('AppAttestProviderFactory');
    expect(source).not.toContain('DeviceCheckProvider');
  });

  it('does not hardcode, log, decode, or manually attach an App Check token', () => {
    const source = withoutComments([
      read('modules/ajfit-app-check/index.ts'),
      read('modules/ajfit-app-check/ios/AJFitAppCheckModule.swift'),
      read('modules/ajfit-app-check/android/src/main/java/com/ajfit/appcheck/AJFitAppCheckModule.kt'),
      read('src/lib/nativeAppCheck.ts'),
      read('src/lib/firebaseAppCheck.ts'),
    ].join('\n'));

    expect(source).not.toMatch(/console\.(log|info|warn|error)/);
    expect(source).not.toContain('X-Firebase-AppCheck');
    expect(source).not.toContain('jwt-decode');
    expect(source).not.toContain('decodeJwt');
    expect(source).not.toContain('00000000-0000-4000-A00000000000');
    expect(source).not.toContain('debugToken');
  });

  it('connects CustomProvider to the same app before JS product instances', () => {
    const firebase = read('src/lib/firebase.ts');
    const bridge = read('src/lib/firebaseAppCheck.ts');

    expect(bridge).toContain('new CustomProvider');
    expect(bridge).toContain('initializeAppCheck(app');
    expect(bridge).toContain('getNativeAppCheckToken(false)');
    expect(firebase.indexOf('initializeFirebaseAppCheck(app)')).toBeLessThan(
      firebase.indexOf('createAuth()'),
    );
    expect(firebase.indexOf('initializeFirebaseAppCheck(app)')).toBeLessThan(
      firebase.indexOf('getFirestore(app)'),
    );
  });

  it('propagates the real native App Check error instead of a generic swallowed message (smoke-test audit: functions/unauthenticated with app=MISSING, no diagnosable reason)', () => {
    const source = read('modules/ajfit-app-check/ios/AJFitAppCheckModule.swift');

    // The token-fetch completion handler must surface the real NSError
    // (domain/code/description), not a single hardcoded string that hides
    // whether the failure was a debug-token rejection, network issue,
    // App Attest unavailability, etc.
    expect(source).toMatch(/if let error/);
    expect(source).toContain('as NSError');
    expect(source).toContain('nsError.localizedDescription');
    expect(source).toContain('ERR_APP_CHECK_NOT_CONFIGURED');
    // Still never logs/exposes an actual token value.
    expect(source).not.toMatch(/print\(.*token/i);
  });

  /**
   * Simulates the Swift compiler's conditional-compilation stripping for a
   * Release build: `#if DEBUG ... #endif` is removed entirely, and
   * `#if DEBUG ... #else X #endif` becomes just `X`. This is what actually
   * ships in a Release/TestFlight/App Store binary — asserting on it (not
   * just "the #else branch of the first #if") is what makes this a real
   * proof rather than a guess, given the token-pin logic lives in a SECOND,
   * separate `#if DEBUG` block (inside the AsyncFunction) with no `#else`.
   */
  function compileForRelease(source: string): string {
    const output: string[] = [];
    let mode: 'normal' | 'debug-then' | 'debug-else' = 'normal';
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '#if DEBUG') {
        mode = 'debug-then';
        continue;
      }
      if (trimmed === '#else' && mode === 'debug-then') {
        mode = 'debug-else';
        continue;
      }
      if (trimmed === '#endif' && mode !== 'normal') {
        mode = 'normal';
        continue;
      }
      if (mode === 'normal' || mode === 'debug-else') output.push(line);
    }
    return output.join('\n');
  }

  it('DEBUG pins the token via the confirmed AppCheckCore process-env mechanism, with no silent fallback and no native crash', () => {
    const source = read('modules/ajfit-app-check/ios/AJFitAppCheckModule.swift');

    expect(source).toContain('AppCheckDebugProviderFactory');
    // Comes from the generated file (plugins/app-check-debug-token), never
    // hand-written here or read from Info.plist.
    expect(source).toContain('ajfitPinnedAppCheckDebugToken');
    expect(source).toContain('setenv("AppCheckDebugToken"');
    // Fails the specific operation clearly instead of a native fatalError —
    // see Etapa 4: a boot-time crash blocks the whole app for unrelated work.
    expect(source).toContain('ERR_APP_CHECK_DEBUG_TOKEN_MISSING');
    expect(source).not.toContain('fatalError');
    // Never reads Info.plist for this anymore (see plugins/app-check-debug-token).
    expect(source).not.toContain('infoDictionary');
  });

  it('is release-safe: compiling out every #if DEBUG block leaves zero reference to the debug-token mechanism', () => {
    const source = read('modules/ajfit-app-check/ios/AJFitAppCheckModule.swift');
    const releaseCompiled = compileForRelease(source);

    expect(releaseCompiled).toContain('AppAttestProviderFactory');
    expect(releaseCompiled).not.toContain('AppCheckDebugProviderFactory');
    expect(releaseCompiled).not.toContain('ajfitPinnedAppCheckDebugToken');
    expect(releaseCompiled).not.toContain('setenv');
    expect(releaseCompiled).not.toContain('ERR_APP_CHECK_DEBUG_TOKEN_MISSING');
    expect(releaseCompiled).not.toContain('AppCheckDebugToken');
  });

  it('generates the local debug token as a #if DEBUG-wrapped Swift source file, not an Info.plist key (Debug/Release share one physical Info.plist)', () => {
    const pluginSource = read('plugins/app-check-debug-token/index.js');

    expect(pluginSource).toContain("ENV_VAR_NAME = 'AJFIT_APP_CHECK_DEBUG_TOKEN'");
    expect(pluginSource).toContain("GENERATED_FILE_NAME = 'AJFitAppCheckDebugTokenLocal.swift'");
    expect(pluginSource).toContain('process.env');
    expect(pluginSource).toContain('#if DEBUG');
    expect(pluginSource).not.toContain('withInfoPlist');
    // No plausible real token value (UUID-shaped or otherwise) is baked
    // into the plugin itself.
    expect(pluginSource).not.toMatch(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);

    const appJson = JSON.parse(read('app.json'));
    expect(appJson.expo.plugins).toContain('./plugins/app-check-debug-token');
  });

  // `ios/` is prebuild-generated and gitignored — absent on a fresh clone
  // before the first `expo prebuild`. This is a one-time environmental
  // confirmation (documented in the audit report), not a repo invariant we
  // can assert unconditionally in CI, so it only runs when the directory
  // happens to exist locally.
  it.skipIf(!existsSync('ios/AJFit.xcodeproj/project.pbxproj'))(
    'confirms Debug and Release actually share one physical Info.plist for this target (the reason the token cannot live there)',
    () => {
      const pbxproj = read('ios/AJFit.xcodeproj/project.pbxproj');
      const infoplistLines = pbxproj
        .split('\n')
        .filter((line) => line.includes('INFOPLIST_FILE = AJFit/Info.plist'));
      // Exactly the main target's Debug and Release XCBuildConfiguration
      // blocks, both pointing at the same file.
      expect(infoplistLines.length).toBe(2);
    },
  );

  it('never commits a real App Check debug token in .env.example or app.json', () => {
    const envExampleLines = read('.env.example').split('\n');
    const tokenLine = envExampleLines.find((line) => line.startsWith('AJFIT_APP_CHECK_DEBUG_TOKEN='));

    // Placeholder only — exactly "KEY=" with nothing after it, never a
    // filled-in value (UUID-shaped or otherwise).
    expect(tokenLine).toBe('AJFIT_APP_CHECK_DEBUG_TOKEN=');

    // app.json never references this variable at all — it is Node-only
    // config-plugin input (plugins/app-check-debug-token), never JSON config.
    const appJson = read('app.json');
    expect(appJson).not.toContain('AJFIT_APP_CHECK_DEBUG_TOKEN');
    expect(appJson).not.toContain('AJFitAppCheckDebugToken');
  });

  it('preserves mobile identity and the corrected Google iOS callback', () => {
    const config = JSON.parse(read('app.json')).expo;

    expect(config.android.package).toBe('com.ajfit.mobile');
    expect(config.ios.bundleIdentifier).toBe('com.ajfit.app');
    expect(config.plugins[0][1].iosUrlScheme).toBe(
      'com.googleusercontent.apps.753375043967-siop689dt3f7njn4kjtlq6hd1ev9lun2',
    );
  });
});

import { readFileSync } from 'node:fs';
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

  it('preserves mobile identity and the corrected Google iOS callback', () => {
    const config = JSON.parse(read('app.json')).expo;

    expect(config.android.package).toBe('com.ajfit.mobile');
    expect(config.ios.bundleIdentifier).toBe('com.ajfit.app');
    expect(config.plugins[0][1].iosUrlScheme).toBe(
      'com.googleusercontent.apps.753375043967-siop689dt3f7njn4kjtlq6hd1ev9lun2',
    );
  });
});

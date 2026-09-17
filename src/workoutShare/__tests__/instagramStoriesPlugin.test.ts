import { describe, expect, it } from 'vitest';

// The config plugin is CommonJS because Expo loads it directly from app.json.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../../plugins/instagram-stories');
const appConfig = require('../../../app.json');

function androidManifest() {
  return { application: [{ $: { 'android:name': '.MainApplication' } }] };
}

describe('Instagram Stories config plugin', () => {
  it('configures the registered iOS Meta App ID without enabling Android', () => {
    const entry = appConfig.expo.plugins.find(
      (candidate: unknown) => Array.isArray(candidate) && candidate[0] === './plugins/instagram-stories',
    );

    expect(entry).toEqual([
      './plugins/instagram-stories',
      { metaAppId: '1566726211857054', androidEnabled: false },
    ]);
    expect(plugin.normalizeMetaAppId(entry[1].metaAppId)).toBe('1566726211857054');
    expect(plugin.resolveAndroidMetaAppId(entry[1].metaAppId, entry[1].androidEnabled)).toBeUndefined();
  });

  it('declares discovery but leaves direct sharing disabled without a Meta App ID', () => {
    const plist = plugin.applyIosConfiguration({}, undefined);
    const manifest = plugin.applyAndroidConfiguration(androidManifest(), undefined);
    const resources = plugin.applyAndroidStrings({}, undefined);

    expect(plist.LSApplicationQueriesSchemes).toContain('instagram-stories');
    expect(plist).not.toHaveProperty(plugin.IOS_INFO_KEY);
    expect(manifest.queries[0].package[0].$['android:name']).toBe('com.instagram.android');
    expect(manifest.application[0]['meta-data']).toEqual([]);
    expect(resources.string).toEqual([]);
  });

  it('declares the plain "instagram" scheme itself, now that react-native-share no longer does', () => {
    const plist = plugin.applyIosConfiguration({}, undefined);
    expect(plist.LSApplicationQueriesSchemes).toContain('instagram');
    expect(appConfig.expo.plugins).not.toContain('react-native-share');
    expect(
      appConfig.expo.plugins.some(
        (candidate: unknown) => Array.isArray(candidate) && candidate[0] === 'react-native-share',
      ),
    ).toBe(false);
  });

  it('configures the add-only Photos permission for Instagram feed sharing regardless of the Meta App ID', () => {
    const plistWithoutMetaAppId = plugin.applyIosConfiguration({}, undefined);
    expect(plistWithoutMetaAppId[plugin.IOS_PHOTO_LIBRARY_ADD_USAGE_KEY]).toBe(
      plugin.IOS_PHOTO_LIBRARY_ADD_USAGE_TEXT,
    );

    const plistWithMetaAppId = plugin.applyIosConfiguration({}, '123456789012345');
    expect(plistWithMetaAppId[plugin.IOS_PHOTO_LIBRARY_ADD_USAGE_KEY]).toBe(
      plugin.IOS_PHOTO_LIBRARY_ADD_USAGE_TEXT,
    );
    // Must never be confused with expo-image-picker's full-library key.
    expect(plugin.IOS_PHOTO_LIBRARY_ADD_USAGE_KEY).toBe('NSPhotoLibraryAddUsageDescription');
  });

  it('generates source_application configuration for both native platforms', () => {
    const testMetaAppId = '123456789012345';
    const plist = plugin.applyIosConfiguration({}, testMetaAppId);
    const manifest = plugin.applyAndroidConfiguration(androidManifest(), testMetaAppId);
    const resources = plugin.applyAndroidStrings({}, testMetaAppId);

    expect(plist[plugin.IOS_INFO_KEY]).toBe(testMetaAppId);
    expect(manifest.application[0]['meta-data']).toContainEqual({
      $: {
        'android:name': plugin.ANDROID_META_DATA_KEY,
        'android:resource': `@string/${plugin.ANDROID_STRING_NAME}`,
      },
    });
    expect(resources.string).toContainEqual({
      $: { name: plugin.ANDROID_STRING_NAME, translatable: 'false' },
      _: testMetaAppId,
    });
  });

  it('rejects a non-numeric Meta App ID instead of shipping a placeholder', () => {
    expect(() => plugin.normalizeMetaAppId('replace-me')).toThrow(/numeric App ID/);
  });

  it('can keep Android direct sharing disabled while configuring iOS', () => {
    const testMetaAppId = '123456789012345';
    const plist = plugin.applyIosConfiguration({}, testMetaAppId);
    const androidMetaAppId = plugin.resolveAndroidMetaAppId(testMetaAppId, false);
    const manifest = plugin.applyAndroidConfiguration(androidManifest(), androidMetaAppId);
    const resources = plugin.applyAndroidStrings({}, androidMetaAppId);

    expect(plist[plugin.IOS_INFO_KEY]).toBe(testMetaAppId);
    expect(androidMetaAppId).toBeUndefined();
    expect(manifest.application[0]['meta-data']).toEqual([]);
    expect(resources.string).toEqual([]);
  });
});

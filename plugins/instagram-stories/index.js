const { withAndroidManifest, withInfoPlist, withStringsXml } = require('@expo/config-plugins');

const IOS_INFO_KEY = 'AJFitInstagramStoriesMetaAppID';
const ANDROID_META_DATA_KEY = 'com.ajfit.instagramstories.META_APP_ID';
const ANDROID_STRING_NAME = 'ajfit_instagram_stories_meta_app_id';
// Distinct from expo-image-picker's NSPhotoLibraryUsageDescription (full
// read-write) — this is the iOS 14+ add-only key, requested only for the
// Instagram feed share handoff, which never reads the user's existing
// photos.
const IOS_PHOTO_LIBRARY_ADD_USAGE_KEY = 'NSPhotoLibraryAddUsageDescription';
const IOS_PHOTO_LIBRARY_ADD_USAGE_TEXT =
  'O AJ Fit precisa adicionar a imagem do treino às suas Fotos para compartilhar diretamente no Instagram.';

function normalizeMetaAppId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw new Error('instagram-stories metaAppId must be the numeric App ID from Meta for Developers');
  }
  return value.trim();
}

function resolveAndroidMetaAppId(metaAppId, androidEnabled) {
  return androidEnabled === false ? undefined : metaAppId;
}

function applyIosConfiguration(infoPlist, metaAppId) {
  const schemes = new Set(infoPlist.LSApplicationQueriesSchemes || []);
  schemes.add('instagram-stories');
  // Plain "instagram" scheme — needed for the Instagram Feed handoff's
  // `isInstagramAppAvailable()` check (`canOpenURL("instagram://app")`).
  // Previously declared by the react-native-share config plugin, which no
  // longer exists now that WhatsApp/Facebook/TikTok always use the generic
  // OS share sheet instead of that library.
  schemes.add('instagram');
  infoPlist.LSApplicationQueriesSchemes = [...schemes];
  if (metaAppId) infoPlist[IOS_INFO_KEY] = metaAppId;
  else delete infoPlist[IOS_INFO_KEY];
  // Instagram feed sharing (unlike Stories) is not gated by the Meta App ID —
  // it always needs this description present so the OS add-only prompt can
  // run.
  infoPlist[IOS_PHOTO_LIBRARY_ADD_USAGE_KEY] = IOS_PHOTO_LIBRARY_ADD_USAGE_TEXT;
  return infoPlist;
}

function applyAndroidConfiguration(manifest, metaAppId) {
  manifest.queries = manifest.queries || [];
  const alreadyDeclared = manifest.queries.some((query) =>
    query.package?.some((entry) => entry.$?.['android:name'] === 'com.instagram.android'),
  );
  if (!alreadyDeclared) {
    manifest.queries.push({ package: [{ $: { 'android:name': 'com.instagram.android' } }] });
  }

  const application = manifest.application?.[0];
  if (!application) throw new Error('instagram-stories requires an Android application manifest node');
  application['meta-data'] = application['meta-data'] || [];
  application['meta-data'] = application['meta-data'].filter(
    (entry) => entry.$?.['android:name'] !== ANDROID_META_DATA_KEY,
  );
  if (metaAppId) {
    application['meta-data'].push({
      $: {
        'android:name': ANDROID_META_DATA_KEY,
        'android:resource': `@string/${ANDROID_STRING_NAME}`,
      },
    });
  }
  return manifest;
}

function applyAndroidStrings(resources, metaAppId) {
  resources.string = (resources.string || []).filter(
    (entry) => entry.$?.name !== ANDROID_STRING_NAME,
  );
  if (metaAppId) {
    resources.string.push({ $: { name: ANDROID_STRING_NAME, translatable: 'false' }, _: metaAppId });
  }
  return resources;
}

function withAJFitInstagramStories(config, options = {}) {
  const metaAppId = normalizeMetaAppId(options.metaAppId);
  const androidMetaAppId = resolveAndroidMetaAppId(metaAppId, options.androidEnabled);
  config = withInfoPlist(config, (result) => {
    applyIosConfiguration(result.modResults, metaAppId);
    return result;
  });

  config = withAndroidManifest(config, (result) => {
    applyAndroidConfiguration(result.modResults.manifest, androidMetaAppId);
    return result;
  });

  return withStringsXml(config, (result) => {
    applyAndroidStrings(result.modResults.resources, androidMetaAppId);
    return result;
  });
}

module.exports = withAJFitInstagramStories;
module.exports.IOS_INFO_KEY = IOS_INFO_KEY;
module.exports.IOS_PHOTO_LIBRARY_ADD_USAGE_KEY = IOS_PHOTO_LIBRARY_ADD_USAGE_KEY;
module.exports.IOS_PHOTO_LIBRARY_ADD_USAGE_TEXT = IOS_PHOTO_LIBRARY_ADD_USAGE_TEXT;
module.exports.ANDROID_META_DATA_KEY = ANDROID_META_DATA_KEY;
module.exports.ANDROID_STRING_NAME = ANDROID_STRING_NAME;
module.exports.normalizeMetaAppId = normalizeMetaAppId;
module.exports.resolveAndroidMetaAppId = resolveAndroidMetaAppId;
module.exports.applyIosConfiguration = applyIosConfiguration;
module.exports.applyAndroidConfiguration = applyAndroidConfiguration;
module.exports.applyAndroidStrings = applyAndroidStrings;

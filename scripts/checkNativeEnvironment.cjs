/* global __dirname */
// Read-only preflight. Uses Expo's own environment resolution, never prints keys.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function validateNativeEnvironment(env, platform = 'ios') {
  const required = ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID',
    platform === 'ios' ? 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY' : 'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY'];
  const errors = required.filter(key => !env[key]?.trim()).map(key => `Missing ${key}`);
  const keyName = platform === 'ios' ? 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY' : 'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY';
  if (env[keyName] && !env[keyName].startsWith(platform === 'ios' ? 'appl_' : 'goog_')) errors.push(`Expected a public ${platform} SDK key in ${keyName}`);
  return { ok: errors.length === 0, errors };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const expoRequire = createRequire(require.resolve('expo/package.json'));
  const parsed = expoRequire('@expo/env').parseProjectEnv(root, { mode: 'development', silent: true });
  const env = { ...parsed.env, ...process.env };
  const result = validateNativeEnvironment(env);
  const generated = path.join(root, 'modules/ajfit-app-check/ios/AJFitAppCheckDebugTokenLocal.swift');
  const token = fs.existsSync(generated) && fs.readFileSync(generated, 'utf8')
    .match(/ajfitPinnedAppCheckDebugToken: String\? = ("(?:[^"\\]|\\.)*"|nil)/)?.[1];
  const debugTokenMatches = !!token && token !== 'nil' && JSON.parse(token) === env.AJFIT_APP_CHECK_DEBUG_TOKEN;
  if (!debugTokenMatches) result.errors.push('Native App Check Debug configuration missing/stale: regenerate with the existing local debug token before building');
  result.ok = result.errors.length === 0;
  console.log(JSON.stringify({ ...result, root, firebaseProject: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    environmentFiles: parsed.files.map(file => path.basename(file)), revenueCatIOSConfigured: !!env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    appCheckDebugTokenMatches: debugTokenMatches }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = { validateNativeEnvironment };
if (require.main === module) main();

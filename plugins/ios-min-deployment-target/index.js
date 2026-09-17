const { withPodfile, createRunOncePlugin, CodeGenerator } = require('@expo/config-plugins');

const { mergeContents } = CodeGenerator;

// Must track `expo.ios.deploymentTarget` in app.json (the Podfile's
// `platform :ios, podfile_properties['ios.deploymentTarget']` line already
// reads that same value) — this only backstops individual Pods whose own
// podspec pins something lower.
const MIN_IOS_DEPLOYMENT_TARGET = '16.4';

const TAG = 'ajfit-pods-min-deployment-target';

const SNIPPET = `
    # AJ Fit: several transitive Pods (GTMSessionFetcher, PromisesObjC,
    # GoogleUtilities, AppAuth, GTMAppAuth, GoogleSignIn, RNCAsyncStorage,
    # RNSVG, react-native-view-shot, RevenueCat/PurchasesHybridCommon, ...)
    # declare their own IPHONEOS_DEPLOYMENT_TARGET in their podspec, below
    # this project's minimum (${MIN_IOS_DEPLOYMENT_TARGET}) — Xcode then
    # rejects the build ("range of supported deployment target versions").
    # The Podfile's \`platform :ios\` line only sets the *default* for the
    # Pods project; it does not override a pod's own, more specific setting.
    # Only raise targets that are strictly below our floor — a pod already
    # pinned at or above ${MIN_IOS_DEPLOYMENT_TARGET} is left untouched.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && Gem::Version.new(current) < Gem::Version.new('${MIN_IOS_DEPLOYMENT_TARGET}')
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS_DEPLOYMENT_TARGET}'
        end
      end
    end
`;

function withPodsMinDeploymentTarget(config) {
  return withPodfile(config, (config) => {
    const results = mergeContents({
      tag: TAG,
      src: config.modResults.contents,
      newSrc: SNIPPET,
      // The very first statement inside the existing `post_install` block —
      // ordering relative to `react_native_post_install` doesn't matter
      // since this only raises targets that are still below the floor
      // afterwards too, but anchoring on the block's opening line (instead
      // of matching `react_native_post_install`'s argument list) keeps this
      // plugin from breaking if that call's signature changes upstream.
      anchor: /post_install do \|installer\|/,
      offset: 1,
      comment: '#',
    });
    config.modResults.contents = results.contents;
    return config;
  });
}

module.exports = createRunOncePlugin(
  withPodsMinDeploymentTarget,
  'ajfit-ios-min-deployment-target',
  '1.0.0',
);

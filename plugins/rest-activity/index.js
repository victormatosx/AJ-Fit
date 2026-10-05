const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_NAME = 'AJFitRestActivityExtension';
const EXTENSION_BUNDLE_SUFFIX = 'RestActivity';
const DEPLOYMENT_TARGET = '16.4';
const EMBED_PHASE_NAME = 'Embed Foundation Extensions';
const ASSET_CATALOG = 'Assets.xcassets';
const LOGO_IMAGESET = 'AJFitLogo.imageset';
const APP_LOGO_FILE = 'aj-logo.png';
// Shared App Group used to exchange the Workout Action Capability Keychain
// item (`AJFitSharedAuth.swift`) between the main app and this extension.
// Declared in exactly one place (this plugin) for both targets so the two
// entitlements files can never drift from each other.
const APP_GROUP_IDENTIFIER = 'group.com.ajfit.app.restactivity';
const ENTITLEMENTS_FILE = 'AJFitRestActivityExtension.entitlements';
const LIVE_ACTIVITY_LOGO_RENDITIONS = [
  { filename: APP_LOGO_FILE, pixels: 24 },
  { filename: 'aj-logo@2x.png', pixels: 48 },
  { filename: 'aj-logo@3x.png', pixels: 72 },
];
const SOURCE_FILES = [
  'AJFitRestActivityAttributes.swift',
  'AJFitRestActivityStorage.swift',
  'AJFitFinishRestIntent.swift',
  'AJFitAddRestSecondsIntent.swift',
  'AJFitRestActivityBundle.swift',
  'AJFitRestActivityWidget.swift',
];
// Both conform to `LiveActivityIntent` — per ActivityKit, their `perform()`
// runs in the main app's own process, not the extension's. The extension
// target membership above is only what lets the widget's `Button(intent:)`
// reference the types; these are the ones that actually run.
const APP_TARGET_INTENT_FILES = [
  'AJFitFinishRestIntent.swift',
  'AJFitAddRestSecondsIntent.swift',
];
const RESOURCE_FILES = ['Localizable.xcstrings', ASSET_CATALOG];
// Entitlements files are intentionally excluded from RESOURCE_FILES: they
// must never be added to the "Copy Bundle Resources" build phase, only
// referenced by the CODE_SIGN_ENTITLEMENTS build setting below.
const EXTENSION_FILES = [
  ...SOURCE_FILES,
  ...RESOURCE_FILES,
  'Info.plist',
  ENTITLEMENTS_FILE,
];

function extensionBundleIdentifier(config) {
  const appBundleIdentifier = config.ios && config.ios.bundleIdentifier;
  if (!appBundleIdentifier) {
    throw new Error(
      'AJ Fit rest activity requires expo.ios.bundleIdentifier before creating its extension.',
    );
  }
  return `${appBundleIdentifier}.${EXTENSION_BUNDLE_SUFFIX}`;
}

function declareEasExtension(config, bundleIdentifier) {
  const currentExtensions =
    config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  const extensionConfig = {
    targetName: TARGET_NAME,
    bundleIdentifier,
    entitlements: {
      'com.apple.security.application-groups': [APP_GROUP_IDENTIFIER],
    },
  };
  const existingIndex = currentExtensions.findIndex(
    (candidate) => candidate.targetName === TARGET_NAME,
  );
  const appExtensions = [...currentExtensions];
  if (existingIndex >= 0) appExtensions[existingIndex] = extensionConfig;
  else appExtensions.push(extensionConfig);

  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...config.extra?.eas?.build?.experimental,
          ios: {
            ...config.extra?.eas?.build?.experimental?.ios,
            appExtensions,
          },
        },
      },
    },
  };
  return config;
}

function extensionEntitlementsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_IDENTIFIER}</string>
	</array>
	<!-- Shares the Workout Action Capability Keychain item
	     (AJFitSharedAuth.swift) between the main app and this extension.
	     Generated from APP_GROUP_IDENTIFIER in this plugin, same as the main
	     app's entitlements (see withRestActivity) — the two can never drift. -->
	<key>keychain-access-groups</key>
	<array>
		<string>$(AppIdentifierPrefix)${APP_GROUP_IDENTIFIER}</string>
	</array>
</dict>
</plist>
`;
}

function copyExtensionFiles(platformProjectRoot) {
  const targetDirectory = path.join(platformProjectRoot, TARGET_NAME);
  const templateDirectory = path.join(__dirname, 'ios', TARGET_NAME);
  const sharedAttributes = path.resolve(
    __dirname,
    '../../modules/ajfit-rest-activity/ios/AJFitRestActivityAttributes.swift',
  );
  const sharedStorage = path.resolve(
    __dirname,
    '../../modules/ajfit-rest-activity/ios/AJFitRestActivityStorage.swift',
  );
  const sharedAppLogo = path.resolve(__dirname, '../../assets/aj-logo.png');

  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const file of EXTENSION_FILES) {
    if (file === ASSET_CATALOG) continue;
    if (file === ENTITLEMENTS_FILE) {
      fs.writeFileSync(
        path.join(targetDirectory, file),
        extensionEntitlementsPlist(),
      );
      continue;
    }
    const source =
      file === 'AJFitRestActivityAttributes.swift'
        ? sharedAttributes
        : file === 'AJFitRestActivityStorage.swift'
          ? sharedStorage
          : path.join(templateDirectory, file);
    if (!fs.existsSync(source)) {
      throw new Error(`AJ Fit rest activity source is missing: ${source}`);
    }
    fs.copyFileSync(source, path.join(targetDirectory, file));
  }

  const assetCatalogTemplate = path.join(templateDirectory, ASSET_CATALOG);
  const targetAssetCatalog = path.join(targetDirectory, ASSET_CATALOG);
  const targetLogoImageSet = path.join(targetAssetCatalog, LOGO_IMAGESET);
  if (!fs.existsSync(assetCatalogTemplate)) {
    throw new Error(
      `AJ Fit rest activity asset catalog is missing: ${assetCatalogTemplate}`,
    );
  }
  if (!fs.existsSync(sharedAppLogo)) {
    throw new Error(`AJ Fit app logo is missing: ${sharedAppLogo}`);
  }
  fs.cpSync(assetCatalogTemplate, targetAssetCatalog, { recursive: true });
  for (const rendition of LIVE_ACTIVITY_LOGO_RENDITIONS) {
    execFileSync(
      '/usr/bin/sips',
      [
        '--resampleHeightWidth',
        String(rendition.pixels),
        String(rendition.pixels),
        sharedAppLogo,
        '--out',
        path.join(targetLogoImageSet, rendition.filename),
      ],
      { stdio: 'pipe' },
    );
  }
}

// Each intent must physically exist as a source file of the main app
// target too (see `addFinishRestIntentsToAppTarget`) — the extension copy
// above only lets the widget's `Button(intent:)` reference the types.
// Single canonical source per file (the extension's own template copy),
// copied a second time so the two can never drift.
function copyAppTargetIntentFiles(platformProjectRoot, projectName) {
  const targetDirectory = path.join(platformProjectRoot, projectName);
  for (const file of APP_TARGET_INTENT_FILES) {
    const source = path.join(__dirname, 'ios', TARGET_NAME, file);
    if (!fs.existsSync(source)) {
      throw new Error(`AJ Fit rest activity source is missing: ${source}`);
    }
    fs.copyFileSync(source, path.join(targetDirectory, file));
  }
}

function unquote(value) {
  return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
}

function extensionStatus(xcodeProject, bundleIdentifier) {
  const nativeTargets = xcodeProject.pbxNativeTargetSection();
  const existingTarget = Object.values(nativeTargets).find(
    (target) => target && target.name && unquote(target.name) === TARGET_NAME,
  );
  if (!existingTarget) return 'missing';

  const configurationList =
    xcodeProject.pbxXCConfigurationList()[existingTarget.buildConfigurationList];
  const firstConfiguration = configurationList?.buildConfigurations?.[0]?.value;
  const buildConfiguration =
    xcodeProject.pbxXCBuildConfigurationSection()[firstConfiguration];
  const existingIdentifier = unquote(
    buildConfiguration?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER,
  );
  return existingIdentifier === bundleIdentifier ? 'exists' : 'conflict';
}

function addConfigurationList(
  xcodeProject,
  config,
  bundleIdentifier,
) {
  const commonSettings = {
    APPLICATION_EXTENSION_API_ONLY: 'YES',
    CLANG_ENABLE_MODULES: 'YES',
    CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/${ENTITLEMENTS_FILE}"`,
    CODE_SIGN_STYLE: 'Automatic',
    CURRENT_PROJECT_VERSION: `"${config.ios?.buildNumber ?? '1'}"`,
    GENERATE_INFOPLIST_FILE: 'NO',
    INFOPLIST_FILE: `"${TARGET_NAME}/Info.plist"`,
    IPHONEOS_DEPLOYMENT_TARGET: `"${DEPLOYMENT_TARGET}"`,
    LD_RUNPATH_SEARCH_PATHS: [
      '"$(inherited)"',
      '"@executable_path/Frameworks"',
      '"@executable_path/../../Frameworks"',
    ],
    MARKETING_VERSION: config.version ?? '1.0',
    PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
    PRODUCT_NAME: '"$(TARGET_NAME)"',
    SKIP_INSTALL: 'YES',
    SWIFT_EMIT_LOC_STRINGS: 'YES',
    SWIFT_VERSION: '5.9',
    TARGETED_DEVICE_FAMILY: '"1,2"',
    ...(config.ios?.appleTeamId
      ? { DEVELOPMENT_TEAM: `"${config.ios.appleTeamId}"` }
      : {}),
  };
  const configurations = [
    {
      name: 'Debug',
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ...commonSettings,
        DEBUG_INFORMATION_FORMAT: 'dwarf',
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"DEBUG $(inherited)"',
        SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
      },
    },
    {
      name: 'Release',
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ...commonSettings,
        COPY_PHASE_STRIP: 'NO',
        DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"',
        SWIFT_COMPILATION_MODE: 'wholemodule',
      },
    },
  ];
  return xcodeProject.addXCConfigurationList(
    configurations,
    'Release',
    `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`,
  );
}

function addProductFile(xcodeProject) {
  return xcodeProject.addProductFile(TARGET_NAME, {
    basename: `${TARGET_NAME}.appex`,
    group: EMBED_PHASE_NAME,
    explicitFileType: 'wrapper.app-extension',
    settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    includeInIndex: 0,
    path: `${TARGET_NAME}.appex`,
    sourceTree: 'BUILT_PRODUCTS_DIR',
  });
}

function addExtensionTarget(xcodeProject, config, bundleIdentifier) {
  const status = extensionStatus(xcodeProject, bundleIdentifier);
  if (status === 'conflict') {
    throw new Error(
      `An iOS target named ${TARGET_NAME} already exists with another bundle identifier. ` +
        'Run expo prebuild --clean to regenerate it safely.',
    );
  }
  if (status === 'exists') return;

  const targetUuid = xcodeProject.generateUuid();
  const configurationList = addConfigurationList(
    xcodeProject,
    config,
    bundleIdentifier,
  );
  const productFile = addProductFile(xcodeProject);
  const nativeTarget = {
    uuid: targetUuid,
    pbxNativeTarget: {
      isa: 'PBXNativeTarget',
      name: TARGET_NAME,
      productName: TARGET_NAME,
      productReference: productFile.fileRef,
      productType: '"com.apple.product-type.app-extension"',
      buildConfigurationList: configurationList.uuid,
      buildPhases: [],
      buildRules: [],
      dependencies: [],
    },
  };

  xcodeProject.addToPbxNativeTargetSection(nativeTarget);
  xcodeProject.addToPbxProjectSection(nativeTarget);

  // The app must build the extension before the embed phase runs. Relying on
  // Xcode's implicit product-reference dependency is fragile for clean builds
  // and archives, so model the target relationship explicitly.
  xcodeProject.hash.project.objects.PBXTargetDependency ??= {};
  xcodeProject.hash.project.objects.PBXContainerItemProxy ??= {};
  xcodeProject.addTargetDependency(xcodeProject.getFirstTarget().uuid, [targetUuid]);

  const projectUuid = xcodeProject.getFirstProject().uuid;
  const projectSection = xcodeProject.pbxProjectSection()[projectUuid];
  projectSection.attributes.TargetAttributes ??= {};
  projectSection.attributes.TargetAttributes[targetUuid] = {
    CreatedOnToolsVersion: '26.0',
    LastSwiftMigration: 2600,
    ProvisioningStyle: 'Automatic',
  };

  const folderType = 'app_extension';
  const buildPath = '""';
  xcodeProject.addBuildPhase(
    SOURCE_FILES,
    'PBXSourcesBuildPhase',
    TARGET_NAME,
    targetUuid,
    folderType,
    buildPath,
  );
  xcodeProject.addBuildPhase(
    [],
    'PBXFrameworksBuildPhase',
    TARGET_NAME,
    targetUuid,
    folderType,
    buildPath,
  );
  xcodeProject.addBuildPhase(
    RESOURCE_FILES,
    'PBXResourcesBuildPhase',
    TARGET_NAME,
    targetUuid,
    folderType,
    buildPath,
  );

  xcodeProject.addBuildPhase(
    [],
    'PBXCopyFilesBuildPhase',
    EMBED_PHASE_NAME,
    xcodeProject.getFirstTarget().uuid,
    folderType,
    buildPath,
  );
  xcodeProject
    .buildPhaseObject('PBXCopyFilesBuildPhase', EMBED_PHASE_NAME, productFile.target)
    .files.push({
      value: productFile.uuid,
      comment: `${productFile.basename} in ${productFile.group}`,
    });
  xcodeProject.addToPbxBuildFileSection(productFile);

  const { uuid: extensionGroupUuid } = xcodeProject.addPbxGroup(
    EXTENSION_FILES,
    TARGET_NAME,
    TARGET_NAME,
  );
  if (extensionGroupUuid) {
    const groups = xcodeProject.hash.project.objects.PBXGroup;
    for (const key of Object.keys(groups)) {
      if (!groups[key].name && !groups[key].path) {
        xcodeProject.addToPbxGroup(extensionGroupUuid, key);
      }
    }
  }
}

function withSharedAppGroupEntitlements(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    const existingGroups = Array.isArray(
      entitlementsConfig.modResults['com.apple.security.application-groups'],
    )
      ? entitlementsConfig.modResults['com.apple.security.application-groups']
      : [];
    entitlementsConfig.modResults['com.apple.security.application-groups'] =
      Array.from(new Set([...existingGroups, APP_GROUP_IDENTIFIER]));

    const keychainGroup = `$(AppIdentifierPrefix)${APP_GROUP_IDENTIFIER}`;
    const existingKeychainGroups = Array.isArray(
      entitlementsConfig.modResults['keychain-access-groups'],
    )
      ? entitlementsConfig.modResults['keychain-access-groups']
      : [];
    entitlementsConfig.modResults['keychain-access-groups'] = Array.from(
      new Set([...existingKeychainGroups, keychainGroup]),
    );

    return entitlementsConfig;
  });
}

// `LiveActivityIntent.perform()` runs in the main app's process (ActivityKit
// contract), so the intent must be a real source member of the `AJFit`
// target's existing Sources phase — not only the extension's. Uses
// `addSourceFile` (appends to the target's EXISTING Sources phase) rather
// than `addBuildPhase` (which always creates a new phase — correct for
// `addExtensionTarget`'s brand-new target, wrong here). Idempotent via
// `hasFile` so a repeated, non-`--clean` prebuild never double-adds it.
function addRestActivityIntentsToAppTarget(xcodeProject, projectName) {
  const appTarget = xcodeProject.getFirstTarget();
  const mainGroup = xcodeProject.getFirstProject().firstProject.mainGroup;
  for (const intentFile of APP_TARGET_INTENT_FILES) {
    const relativePath = `${projectName}/${intentFile}`;
    if (xcodeProject.hasFile(relativePath)) continue;

    const file = xcodeProject.addSourceFile(
      relativePath,
      { target: appTarget.uuid },
      mainGroup,
    );
    if (!file) {
      throw new Error(`AJ Fit rest activity: failed to add ${intentFile} to the main app target.`);
    }
  }
}

function withRestActivity(config) {
  const bundleIdentifier = extensionBundleIdentifier(config);
  config = declareEasExtension(config, bundleIdentifier);
  config.ios = {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      NSSupportsLiveActivities: true,
    },
  };

  // The main app target needs the same App Group + Keychain access group as
  // the extension (see extensionEntitlementsPlist) so AJFitSharedAuth.swift
  // can hand off the Workout Action Capability between them. This must be
  // declared here, in code, rather than left for manual Xcode edits: a clean
  // `expo prebuild`/EAS Build only reproduces what plugins declare.
  config = withSharedAppGroupEntitlements(config);

  config = withDangerousMod(config, [
    'ios',
    async (dangerousConfig) => {
      copyExtensionFiles(dangerousConfig.modRequest.platformProjectRoot);
      copyAppTargetIntentFiles(
        dangerousConfig.modRequest.platformProjectRoot,
        dangerousConfig.modRequest.projectName,
      );
      return dangerousConfig;
    },
  ]);

  return withXcodeProject(config, (xcodeConfig) => {
    addExtensionTarget(xcodeConfig.modResults, xcodeConfig, bundleIdentifier);
    addRestActivityIntentsToAppTarget(xcodeConfig.modResults, xcodeConfig.modRequest.projectName);
    return xcodeConfig;
  });
}

module.exports = createRunOncePlugin(
  withRestActivity,
  'ajfit-rest-activity-ios',
  '1.0.0',
);

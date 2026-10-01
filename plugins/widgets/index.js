const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_NAME = 'AJFitWidgetsExtension';
const EXTENSION_BUNDLE_SUFFIX = 'Widgets';
const DEPLOYMENT_TARGET = '16.4';
const EMBED_PHASE_NAME = 'Embed Foundation Extensions';
const APP_GROUP_IDENTIFIER = 'group.com.ajfit.app.widgets';
const ENTITLEMENTS_FILE = `${TARGET_NAME}.entitlements`;
// Keep a target-specific basename: node-xcode de-duplicates file references
// globally, so a generic Assets.xcassets would collide with Rest Activity's
// catalog and could attach the wrong resource to this target.
const ASSET_CATALOG = 'AJFitWidgetsAssets.xcassets';
const LOGO_IMAGESET = 'AJFitLogo.imageset';
const LOGO_RENDITIONS = [
  { filename: 'aj-logo.png', pixels: 48 },
  { filename: 'aj-logo@2x.png', pixels: 96 },
  { filename: 'aj-logo@3x.png', pixels: 144 },
];
const SOURCE_FILES = [
  'AJFitWidgetsStorage.swift',
  'AJFitWidgetModels.swift',
  'AJFitWidgets.swift',
  'AJFitWidgetsBundle.swift',
];
const FONT_SOURCES = [
  ['@expo-google-fonts/anton/400Regular/Anton_400Regular.ttf', 'Anton_400Regular.ttf'],
  ['@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf', 'Archivo_400Regular.ttf'],
  ['@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf', 'Archivo_600SemiBold.ttf'],
  ['@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf', 'Archivo_700Bold.ttf'],
  ['@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf', 'JetBrainsMono_400Regular.ttf'],
];
const RESOURCE_FILES = [...FONT_SOURCES.map(([, target]) => target), ASSET_CATALOG];
// Info.plist is copied and referenced by INFOPLIST_FILE, but deliberately
// omitted from this PBX group: node-xcode de-duplicates generic basenames
// globally and would otherwise reuse Rest Activity's Info.plist file ref.
const EXTENSION_FILES = [...SOURCE_FILES, ...RESOURCE_FILES, ENTITLEMENTS_FILE];

function extensionBundleIdentifier(config) {
  const appBundleIdentifier = config.ios?.bundleIdentifier;
  if (!appBundleIdentifier) throw new Error('AJ Fit widgets require expo.ios.bundleIdentifier.');
  return `${appBundleIdentifier}.${EXTENSION_BUNDLE_SUFFIX}`;
}

function declareEasExtension(config, bundleIdentifier) {
  const current = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  const extensionConfig = {
    targetName: TARGET_NAME,
    bundleIdentifier,
    entitlements: { 'com.apple.security.application-groups': [APP_GROUP_IDENTIFIER] },
  };
  const index = current.findIndex((candidate) => candidate.targetName === TARGET_NAME);
  const appExtensions = [...current];
  if (index >= 0) appExtensions[index] = extensionConfig;
  else appExtensions.push(extensionConfig);
  config.extra = {
    ...config.extra,
    eas: { ...config.extra?.eas, build: { ...config.extra?.eas?.build,
      experimental: { ...config.extra?.eas?.build?.experimental,
        ios: { ...config.extra?.eas?.build?.experimental?.ios, appExtensions } } } },
  };
  return config;
}

function extensionEntitlementsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key>
  <array><string>${APP_GROUP_IDENTIFIER}</string></array>
</dict></plist>\n`;
}

function copyExtensionFiles(projectRoot, platformProjectRoot) {
  const destination = path.join(platformProjectRoot, TARGET_NAME);
  const template = path.join(__dirname, 'ios', TARGET_NAME);
  fs.mkdirSync(destination, { recursive: true });
  for (const file of ['AJFitWidgetModels.swift', 'AJFitWidgets.swift', 'AJFitWidgetsBundle.swift', 'Info.plist']) {
    const source = path.join(template, file);
    if (!fs.existsSync(source)) throw new Error(`AJ Fit widget source is missing: ${source}`);
    fs.copyFileSync(source, path.join(destination, file));
  }
  const sharedStorage = path.join(projectRoot, 'modules/ajfit-widgets/ios/AJFitWidgetsStorage.swift');
  if (!fs.existsSync(sharedStorage)) throw new Error(`AJ Fit widget storage is missing: ${sharedStorage}`);
  fs.copyFileSync(sharedStorage, path.join(destination, 'AJFitWidgetsStorage.swift'));
  fs.writeFileSync(path.join(destination, ENTITLEMENTS_FILE), extensionEntitlementsPlist());
  for (const [modulePath, target] of FONT_SOURCES) {
    const source = path.join(projectRoot, 'node_modules', modulePath);
    if (!fs.existsSync(source)) throw new Error(`AJ Fit widget font is missing: ${source}`);
    fs.copyFileSync(source, path.join(destination, target));
  }
  const catalogSource = path.join(template, ASSET_CATALOG);
  const catalogDestination = path.join(destination, ASSET_CATALOG);
  const sharedLogo = path.join(projectRoot, 'assets/aj-logo.png');
  if (!fs.existsSync(catalogSource)) throw new Error(`AJ Fit widget asset catalog is missing: ${catalogSource}`);
  if (!fs.existsSync(sharedLogo)) throw new Error(`AJ Fit official logo is missing: ${sharedLogo}`);
  fs.cpSync(catalogSource, catalogDestination, { recursive: true });
  for (const rendition of LOGO_RENDITIONS) {
    execFileSync('/usr/bin/sips', [
      '--resampleHeightWidth', String(rendition.pixels), String(rendition.pixels),
      sharedLogo, '--out', path.join(catalogDestination, LOGO_IMAGESET, rendition.filename),
    ], { stdio: 'pipe' });
  }
}

function copyAndroidWidgetAssets(projectRoot) {
  const source = path.join(projectRoot, 'assets', 'aj-logo.png');
  const destination = path.join(
    projectRoot, 'modules', 'ajfit-widgets', 'android', 'src', 'main', 'res', 'drawable',
    'ajfit_widget_logo.png',
  );
  if (!fs.existsSync(source)) throw new Error(`AJ Fit official logo is missing: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function unquote(value) {
  return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
}

function extensionStatus(project, bundleIdentifier) {
  const target = Object.values(project.pbxNativeTargetSection()).find(
    (candidate) => candidate?.name && unquote(candidate.name) === TARGET_NAME,
  );
  if (!target) return 'missing';
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const first = list?.buildConfigurations?.[0]?.value;
  const configuration = project.pbxXCBuildConfigurationSection()[first];
  return unquote(configuration?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER) === bundleIdentifier
    ? 'exists' : 'conflict';
}

function addConfigurationList(project, config, bundleIdentifier) {
  const common = {
    APPLICATION_EXTENSION_API_ONLY: 'YES', CLANG_ENABLE_MODULES: 'YES',
    CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/${ENTITLEMENTS_FILE}"`,
    CODE_SIGN_STYLE: 'Automatic', CURRENT_PROJECT_VERSION: `"${config.ios?.buildNumber ?? '1'}"`,
    GENERATE_INFOPLIST_FILE: 'NO', INFOPLIST_FILE: `"${TARGET_NAME}/Info.plist"`,
    IPHONEOS_DEPLOYMENT_TARGET: `"${DEPLOYMENT_TARGET}"`,
    LD_RUNPATH_SEARCH_PATHS: ['"$(inherited)"', '"@executable_path/Frameworks"', '"@executable_path/../../Frameworks"'],
    MARKETING_VERSION: config.version ?? '1.0', PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
    PRODUCT_NAME: '"$(TARGET_NAME)"', SKIP_INSTALL: 'YES', SWIFT_EMIT_LOC_STRINGS: 'YES',
    SWIFT_VERSION: '5.9', TARGETED_DEVICE_FAMILY: '"1,2"',
    ...(config.ios?.appleTeamId ? { DEVELOPMENT_TEAM: `"${config.ios.appleTeamId}"` } : {}),
  };
  return project.addXCConfigurationList([
    { name: 'Debug', isa: 'XCBuildConfiguration', buildSettings: { ...common, DEBUG_INFORMATION_FORMAT: 'dwarf', SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"DEBUG $(inherited)"', SWIFT_OPTIMIZATION_LEVEL: '"-Onone"' } },
    { name: 'Release', isa: 'XCBuildConfiguration', buildSettings: { ...common, COPY_PHASE_STRIP: 'NO', DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"', SWIFT_COMPILATION_MODE: 'wholemodule' } },
  ], 'Release', `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`);
}

function addExtensionTarget(project, config, bundleIdentifier) {
  const status = extensionStatus(project, bundleIdentifier);
  if (status === 'conflict') throw new Error(`An iOS target named ${TARGET_NAME} has another bundle identifier. Run expo prebuild --clean.`);
  if (status === 'exists') return;
  const targetUuid = project.generateUuid();
  const configurationList = addConfigurationList(project, config, bundleIdentifier);
  const productFile = project.addProductFile(TARGET_NAME, { basename: `${TARGET_NAME}.appex`, group: EMBED_PHASE_NAME,
    explicitFileType: 'wrapper.app-extension', settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] }, includeInIndex: 0,
    path: `${TARGET_NAME}.appex`, sourceTree: 'BUILT_PRODUCTS_DIR' });
  const target = { uuid: targetUuid, pbxNativeTarget: { isa: 'PBXNativeTarget', name: TARGET_NAME,
    productName: TARGET_NAME, productReference: productFile.fileRef,
    productType: '"com.apple.product-type.app-extension"', buildConfigurationList: configurationList.uuid,
    buildPhases: [], buildRules: [], dependencies: [] } };
  project.addToPbxNativeTargetSection(target);
  project.addToPbxProjectSection(target);
  project.hash.project.objects.PBXTargetDependency ??= {};
  project.hash.project.objects.PBXContainerItemProxy ??= {};
  project.addTargetDependency(project.getFirstTarget().uuid, [targetUuid]);
  const projectUuid = project.getFirstProject().uuid;
  const section = project.pbxProjectSection()[projectUuid];
  section.attributes.TargetAttributes ??= {};
  section.attributes.TargetAttributes[targetUuid] = { CreatedOnToolsVersion: '26.0', LastSwiftMigration: 2600, ProvisioningStyle: 'Automatic' };
  const folderType = 'app_extension';
  project.addBuildPhase(SOURCE_FILES, 'PBXSourcesBuildPhase', TARGET_NAME, targetUuid, folderType, '""');
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', TARGET_NAME, targetUuid, folderType, '""');
  project.addBuildPhase(RESOURCE_FILES, 'PBXResourcesBuildPhase', TARGET_NAME, targetUuid, folderType, '""');
  project.addBuildPhase([], 'PBXCopyFilesBuildPhase', EMBED_PHASE_NAME, project.getFirstTarget().uuid, folderType, '""');
  project.buildPhaseObject('PBXCopyFilesBuildPhase', EMBED_PHASE_NAME, productFile.target).files.push({ value: productFile.uuid, comment: `${productFile.basename} in ${productFile.group}` });
  project.addToPbxBuildFileSection(productFile);
  const { uuid } = project.addPbxGroup(EXTENSION_FILES, TARGET_NAME, TARGET_NAME);
  if (uuid) {
    const groups = project.hash.project.objects.PBXGroup;
    for (const key of Object.keys(groups)) if (!groups[key].name && !groups[key].path) project.addToPbxGroup(uuid, key);
  }
}

function withWidgets(config) {
  const bundleIdentifier = extensionBundleIdentifier(config);
  config = declareEasExtension(config, bundleIdentifier);
  config = withDangerousMod(config, ['android', async (result) => {
    copyAndroidWidgetAssets(result.modRequest.projectRoot);
    return result;
  }]);
  config = withEntitlementsPlist(config, (result) => {
    const groups = Array.isArray(result.modResults['com.apple.security.application-groups'])
      ? result.modResults['com.apple.security.application-groups'] : [];
    result.modResults['com.apple.security.application-groups'] = Array.from(new Set([...groups, APP_GROUP_IDENTIFIER]));
    return result;
  });
  config = withDangerousMod(config, ['ios', async (result) => {
    copyExtensionFiles(result.modRequest.projectRoot, result.modRequest.platformProjectRoot);
    return result;
  }]);
  return withXcodeProject(config, (result) => {
    addExtensionTarget(result.modResults, result, bundleIdentifier);
    return result;
  });
}

module.exports = createRunOncePlugin(withWidgets, 'ajfit-home-screen-widgets-ios', '1.0.0');

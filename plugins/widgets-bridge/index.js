const { createRunOncePlugin, withEntitlementsPlist } = require('@expo/config-plugins');

// Dedicated App Group for Home Screen Widgets — deliberately NOT
// `group.com.ajfit.app.restactivity`. Rest Activity and the widgets have
// different responsibilities and different data: Rest Activity shares a
// short-lived Keychain capability token (`AJFitSharedAuth.swift`); widgets
// share a small, versioned, non-secret JSON snapshot (`WidgetSnapshotV1`) via
// plain `UserDefaults(suiteName:)`. Keeping them in separate App Groups means
// neither surface can accidentally read the other's container.
const WIDGETS_APP_GROUP_IDENTIFIER = 'group.com.ajfit.app.widgets';

/**
 * Declares the widgets App Group on the MAIN APP target only. There is no
 * `AJFitWidgetsExtension` target yet (Phase 3) — the app itself already
 * needs this capability to WRITE the shared snapshot via the
 * `ajfit-widgets` Expo module, and that alone is enough to prove the
 * entitlement round-trips through `expo prebuild`. When the widget
 * extension is created later, its own `.entitlements` must declare the
 * SAME identifier (see `extensionEntitlementsPlist` in
 * `plugins/rest-activity/index.js` for the equivalent pattern already used
 * for Rest Activity's extension).
 *
 * Merges into whatever `com.apple.security.application-groups` the main
 * target already has (e.g. `group.com.ajfit.app.restactivity` from
 * `plugins/rest-activity/index.js`) — never overwrites it. Plugin order in
 * `app.json` does not matter; both groups end up present either way.
 */
function withWidgetsAppGroupEntitlements(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    const existingGroups = Array.isArray(
      entitlementsConfig.modResults['com.apple.security.application-groups'],
    )
      ? entitlementsConfig.modResults['com.apple.security.application-groups']
      : [];
    entitlementsConfig.modResults['com.apple.security.application-groups'] = Array.from(
      new Set([...existingGroups, WIDGETS_APP_GROUP_IDENTIFIER]),
    );
    return entitlementsConfig;
  });
}

module.exports = createRunOncePlugin(
  withWidgetsAppGroupEntitlements,
  'ajfit-widgets-bridge-ios',
  '1.0.0',
);

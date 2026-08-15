/**
 * Defers non-urgent work (screen prewarm mounts — docs/23_navegacao_e_
 * lifecycle.md §14) off the critical path of whatever is currently
 * rendering, using `requestIdleCallback`.
 *
 * NOT `InteractionManager.runAfterInteractions`: RN 0.85 (this project's
 * version — see node_modules/react-native/index.js) marks
 * `InteractionManager` `@deprecated`, and its own deprecation warning
 * points at `requestIdleCallback` as the replacement. `requestIdleCallback`
 * is a real, native-backed (TurboModule) global in this RN version — not a
 * DOM shim — see
 * react-native/src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js.
 * TypeScript resolves its ambient types from `lib: ["DOM", ...]` in
 * expo/tsconfig.base.
 */
export function schedulePrewarm(task: () => void): () => void {
  const handle = requestIdleCallback(() => task());
  return () => cancelIdleCallback(handle);
}

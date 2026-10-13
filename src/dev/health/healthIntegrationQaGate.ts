/** Fase 1 — exercises the production service/hook layer (not the Fase 0 raw-library spike). Dev-build only. */
export function isHealthIntegrationQaPanelAllowed(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

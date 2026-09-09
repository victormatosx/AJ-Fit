/** The UI is dead-code gated by Metro's development constant. */
export function isPushNotificationQaPanelAllowed(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

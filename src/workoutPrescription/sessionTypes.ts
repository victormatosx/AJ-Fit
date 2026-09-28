/** Recovery sessions occupy an available day but do not count as training frequency. */
export function isRecoverySessionType(type: string): boolean {
  return type === 'recovery' || type === 'active_recovery';
}

/** These sessions already prescribe cardio within their exercise slots. */
export function isCardioDominantSessionType(type: string): boolean {
  return ['cardio', 'interval', 'circuit', 'mixed', 'recovery', 'active_recovery', 'balance_cardio'].includes(type);
}

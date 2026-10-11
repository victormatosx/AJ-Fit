/**
 * Pure scan-debounce state machine for the barcode scanner (round brief
 * §1/§7: "impedir múltiplas leituras do mesmo código durante o scan" /
 * "scan repetido rapidamente não dispara múltiplos requests"). No timers,
 * no camera coupling — the scanner component owns the actual
 * `CameraView`/`onBarcodeScanned` wiring and just threads decoded frames
 * through `shouldAcceptBarcodeScan`.
 *
 * Two independent rules:
 * 1. While a resolution is in flight (`busy`), EVERY frame is ignored —
 *    a camera firing several times a second would otherwise kick off one
 *    `resolveFoodLogEntryByBarcode` call per frame for the same product.
 * 2. Once a resolution finishes, the SAME code is still visible to the
 *    camera for a beat — `lastCode`/`lastResolvedAtMs` suppress an
 *    immediate re-trigger of that one code for `BARCODE_SCAN_COOLDOWN_MS`,
 *    without blocking a genuinely different code scanned right after.
 */
export interface BarcodeScanGuardState {
  busy: boolean;
  lastCode: string | null;
  lastResolvedAtMs: number;
}

export const BARCODE_SCAN_COOLDOWN_MS = 2000;

export function initialBarcodeScanGuardState(): BarcodeScanGuardState {
  return { busy: false, lastCode: null, lastResolvedAtMs: 0 };
}

export function shouldAcceptBarcodeScan(
  state: BarcodeScanGuardState, code: string, nowMs: number, cooldownMs: number = BARCODE_SCAN_COOLDOWN_MS,
): boolean {
  if (!code || state.busy) return false;
  if (state.lastCode === code && nowMs - state.lastResolvedAtMs < cooldownMs) return false;
  return true;
}

/** Call right after `shouldAcceptBarcodeScan` returns `true`, before starting the resolution — locks out every subsequent frame until `endBarcodeScan`. */
export function beginBarcodeScan(state: BarcodeScanGuardState, code: string): BarcodeScanGuardState {
  return { ...state, busy: true, lastCode: code };
}

/** Call once the resolution settles (found/not found/error) — starts this code's cooldown window and unlocks the guard for the next frame. */
export function endBarcodeScan(state: BarcodeScanGuardState, nowMs: number): BarcodeScanGuardState {
  return { ...state, busy: false, lastResolvedAtMs: nowMs };
}

/** Fase 0 — painel só existe em build de desenvolvimento. Apagar com o resto de `src/dev/health/` ao final do spike. */
export function isHealthSpikeQaPanelAllowed(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

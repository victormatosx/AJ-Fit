import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (same pattern as premiumCommercialContextFase6.test.ts
 * — no component renderer in this Node-only suite) proving that BOTH the
 * purchase and restore success paths in PaywallScreen request the
 * server-authoritative `commercialGateResolvedAt` confirmation
 * (functions/src/billing/confirmCommercialGate.ts) — not just one of them.
 * Requirement PARTE 4 of the residual-risk fix: "não quero corrigir compra
 * e esquecer restore".
 */
function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('PaywallScreen — commercial gate confirmation wiring', () => {
  const code = source('src/screens/PaywallScreen.tsx');

  it('imports the confirmation request from src/services/commercialGate', () => {
    expect(code).toContain(
      "import { requestCommercialGateConfirmation } from '../services/commercialGate';",
    );
  });

  it('requests confirmation on the purchase success path (case "premium" in handlePurchase)', () => {
    const purchaseBlock = code.slice(
      code.indexOf("case 'premium':"),
      code.indexOf('break;', code.indexOf("case 'premium':")),
    );
    expect(purchaseBlock).toContain('requestCommercialGateConfirmation()');
  });

  it("requests confirmation on the restore success path (result === 'premium' in handleRestore)", () => {
    const restoreBlock = code.slice(
      code.indexOf("if (result === 'premium')"),
      code.indexOf("} else if (result === 'missing-entitlement')"),
    );
    expect(restoreBlock).toContain('requestCommercialGateConfirmation()');
  });

  it('never awaits the confirmation call — it must stay best-effort and never block/gate the UI', () => {
    for (const line of code.split('\n')) {
      if (line.includes('requestCommercialGateConfirmation()')) {
        expect(line).not.toMatch(/\bawait\b/);
        expect(line.trim().startsWith('void ')).toBe(true);
      }
    }
  });
});

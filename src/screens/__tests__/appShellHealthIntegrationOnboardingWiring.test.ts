import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Fase 5 — structural guarantees for the post-auth confirmation sheet
 * mounted in `AppShell.tsx`. No component renderer in this Node-only suite
 * (see `appShellSupportNotifications.test.ts` for the same pattern).
 */
const SOURCE = readFileSync('src/screens/AppShell.tsx', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppShell — Fase 5 pending health-integration confirmation', () => {
  it('derives visibility from the dedicated hook, keyed by the signed-in uid', () => {
    expect(SOURCE).toContain("from '../hooks/usePendingHealthIntegrationConfirmation'");
    expect(CODE).toContain('usePendingHealthIntegrationConfirmation(user?.uid ?? null)');
  });

  it('only mounts the sheet (and therefore useHealthIntegration/connect()) while actually visible', () => {
    const mountIdx = CODE.indexOf('<PendingHealthIntegrationConfirmationSheet');
    expect(mountIdx).toBeGreaterThan(-1);
    const guardIdx = CODE.lastIndexOf('pendingHealthIntegrationConfirmation.visible && user', mountIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(mountIdx - guardIdx).toBeLessThan(80);
  });

  it('passes resolve() through unmodified — AppShell never re-derives its own settle logic', () => {
    expect(CODE).toContain('onResolved={pendingHealthIntegrationConfirmation.resolve}');
  });

  it('never calls connect() or requestHealthPermissions directly from AppShell itself', () => {
    expect(CODE).not.toContain('.connect()');
    expect(CODE).not.toContain('requestHealthPermissions');
  });
});

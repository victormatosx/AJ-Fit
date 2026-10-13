import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/health/PendingHealthIntegrationConfirmationSheet.tsx'),
  'utf8',
);

describe('PendingHealthIntegrationConfirmationSheet — the one explicit tap before any native dialog', () => {
  it('reuses the Fase 1 hook as the only connect implementation', () => {
    expect(source).toContain("import { useHealthIntegration } from '../../hooks/useHealthIntegration'");
  });

  it('never calls connect() outside of the explicit Connect button handler', () => {
    const connectCallIdx = source.indexOf('await health.connect()');
    expect(connectCallIdx).toBeGreaterThan(-1);
    const handlerStart = source.lastIndexOf('const handleConnect', connectCallIdx);
    expect(handlerStart).toBeGreaterThan(-1);
    // No useEffect anywhere in the file ever calls connect() automatically.
    expect(source).not.toMatch(/useEffect\([^)]*\{[^}]*connect\(\)/s);
  });

  it('guards against a double tap while a connect is already in flight', () => {
    const handleConnectBody = source.slice(
      source.indexOf('const handleConnect = async () => {'),
      source.indexOf('};', source.indexOf('const handleConnect = async () => {')),
    );
    expect(handleConnectBody).toContain('if (connecting) return;');
  });

  it('never applies the result after the component has unmounted mid-await (a uid switch/logout race)', () => {
    const handleConnectBody = source.slice(
      source.indexOf('const handleConnect = async () => {'),
      source.indexOf('};', source.indexOf('const handleConnect = async () => {')),
    );
    expect(handleConnectBody).toContain('if (!mountedRef.current) return;');
  });

  it('dismissing ("Agora não"/backdrop tap) never calls connect()', () => {
    const handleDismissBody = source.slice(
      source.indexOf('const handleDismiss = () => {'),
      source.indexOf('};', source.indexOf('const handleDismiss = () => {')),
    );
    expect(handleDismissBody).not.toContain('connect(');
  });

  it('disables both actions while connecting, so neither can be tapped twice', () => {
    expect(source.match(/disabled=\{connecting\}/g) ?? []).toHaveLength(2);
  });
});

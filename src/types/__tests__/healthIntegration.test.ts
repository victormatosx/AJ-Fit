import { describe, expect, it } from 'vitest';

import { isHealthIntegrationActionBusy } from '../healthIntegration';

describe('isHealthIntegrationActionBusy', () => {
  it('is false when neither connect nor disconnect is in flight', () => {
    expect(isHealthIntegrationActionBusy({ requestingPermissions: false, disconnecting: false })).toBe(false);
  });

  it('is true while a connect (permission request) is in flight — blocks a double tap on Connect', () => {
    expect(isHealthIntegrationActionBusy({ requestingPermissions: true, disconnecting: false })).toBe(true);
  });

  it('is true while a disconnect is in flight — blocks a double tap on Disconnect', () => {
    expect(isHealthIntegrationActionBusy({ requestingPermissions: false, disconnecting: true })).toBe(true);
  });

  it('is true if, somehow, both are in flight at once — never treats that as idle', () => {
    expect(isHealthIntegrationActionBusy({ requestingPermissions: true, disconnecting: true })).toBe(true);
  });
});

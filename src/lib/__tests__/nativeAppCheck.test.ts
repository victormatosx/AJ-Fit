import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  available: vi.fn(),
}));

vi.mock('../../../modules/ajfit-app-check', () => ({
  getAppCheckToken: mocks.getToken,
  isAJFitAppCheckNativeModuleAvailable: mocks.available,
}));

import {
  getNativeAppCheckToken,
  isNativeAppCheckAvailable,
} from '../nativeAppCheck';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.available.mockReturnValue(true);
  mocks.getToken.mockResolvedValue({
    token: 'opaque-native-app-check-token',
    expireTimeMillis: Date.now() + 60_000,
  });
});

describe('native App Check contract', () => {
  it('passes through the native token and official expiration unchanged', async () => {
    const expected = {
      token: 'opaque-native-app-check-token',
      expireTimeMillis: Date.now() + 60_000,
    };
    mocks.getToken.mockResolvedValue(expected);

    await expect(getNativeAppCheckToken(false)).resolves.toEqual(expected);
    expect(mocks.getToken).toHaveBeenCalledWith(false);
  });

  it('supports a deliberate force refresh without making it the default', async () => {
    await getNativeAppCheckToken(true);
    expect(mocks.getToken).toHaveBeenCalledWith(true);
  });

  it('rejects an empty token', async () => {
    mocks.getToken.mockResolvedValue({ token: '', expireTimeMillis: Date.now() + 60_000 });
    await expect(getNativeAppCheckToken()).rejects.toMatchObject({
      code: 'ERR_APP_CHECK_INVALID_TOKEN',
    });
  });

  it('rejects an expired or fabricated-looking expiration contract', async () => {
    mocks.getToken.mockResolvedValue({
      token: 'opaque',
      expireTimeMillis: Date.now() - 1,
    });
    await expect(getNativeAppCheckToken()).rejects.toMatchObject({
      code: 'ERR_APP_CHECK_INVALID_TOKEN',
    });
  });

  it('reports whether the autolinked module exists', () => {
    expect(isNativeAppCheckAvailable()).toBe(true);
  });
});

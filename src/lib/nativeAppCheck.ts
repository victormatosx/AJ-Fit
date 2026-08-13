import {
  getAppCheckToken,
  isAJFitAppCheckNativeModuleAvailable,
} from '../../modules/ajfit-app-check';

export type NativeAppCheckToken = {
  token: string;
  expireTimeMillis: number;
};

export function isNativeAppCheckAvailable(): boolean {
  return isAJFitAppCheckNativeModuleAvailable();
}

/**
 * Returns only the official token and expiration supplied by Firebase's
 * native SDK. No JWT decoding, TTL estimation, persistence, or logging.
 */
export async function getNativeAppCheckToken(
  forceRefresh = false,
): Promise<NativeAppCheckToken> {
  const result = await getAppCheckToken(forceRefresh);

  if (
    typeof result.token !== 'string' ||
    result.token.length === 0 ||
    !Number.isFinite(result.expireTimeMillis) ||
    result.expireTimeMillis <= Date.now()
  ) {
    throw Object.assign(new Error('Native App Check returned an invalid token contract.'), {
      code: 'ERR_APP_CHECK_INVALID_TOKEN',
    });
  }

  return result;
}

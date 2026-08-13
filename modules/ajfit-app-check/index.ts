import { requireOptionalNativeModule } from 'expo-modules-core';

export type NativeAppCheckToken = {
  token: string;
  expireTimeMillis: number;
};

type AJFitAppCheckNativeModule = {
  getAppCheckToken(forceRefresh: boolean): Promise<NativeAppCheckToken>;
};

const nativeModule =
  requireOptionalNativeModule<AJFitAppCheckNativeModule>('AJFitAppCheck');

export function isAJFitAppCheckNativeModuleAvailable(): boolean {
  return nativeModule !== null;
}

export function getAppCheckToken(
  forceRefresh = false,
): Promise<NativeAppCheckToken> {
  if (!nativeModule) {
    return Promise.reject(
      Object.assign(new Error('Native App Check module is unavailable.'), {
        code: 'ERR_APP_CHECK_MODULE_UNAVAILABLE',
      }),
    );
  }
  return nativeModule.getAppCheckToken(forceRefresh);
}

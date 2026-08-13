export const PASSWORD_PROVIDER_ID = 'password';
export const GOOGLE_PROVIDER_ID = 'google.com';
export const APPLE_PROVIDER_ID = 'apple.com';

export type ReauthenticationProvider = 'password' | 'google' | 'apple';

type ProviderUser = {
  providerData: ReadonlyArray<{ providerId: string }>;
};

export function hasPasswordProvider(
  user: ProviderUser | null | undefined,
): boolean {
  return !!user?.providerData.some(
    (provider) => provider.providerId === PASSWORD_PROVIDER_ID,
  );
}

/**
 * Returns every safe reauthentication method linked to the current Firebase
 * user. The order is deliberate: password remains the familiar default, while
 * federated methods are offered as explicit alternatives. No caller may infer
 * identity from providerData array position.
 */
export function getReauthenticationProviders(
  user: ProviderUser | null | undefined,
): ReauthenticationProvider[] {
  if (!user) return [];

  const linked = new Set(user.providerData.map((provider) => provider.providerId));
  const providers: ReauthenticationProvider[] = [];
  if (linked.has(PASSWORD_PROVIDER_ID)) providers.push('password');
  if (linked.has(GOOGLE_PROVIDER_ID)) providers.push('google');
  if (linked.has(APPLE_PROVIDER_ID)) providers.push('apple');
  return providers;
}

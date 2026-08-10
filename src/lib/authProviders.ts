export const PASSWORD_PROVIDER_ID = 'password';

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

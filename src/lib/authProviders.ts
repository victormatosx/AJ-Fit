import type { User } from 'firebase/auth';

export const PASSWORD_PROVIDER_ID = 'password';

type ProviderUser = Pick<User, 'providerData'>;

export function hasPasswordProvider(
  user: ProviderUser | null | undefined,
): boolean {
  return !!user?.providerData.some(
    (provider) => provider.providerId === PASSWORD_PROVIDER_ID,
  );
}

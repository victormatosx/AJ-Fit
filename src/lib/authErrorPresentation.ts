export type AuthErrorTranslationKey = `errors.${string}` | `validation.${string}`;

const AUTH_ERROR_KEY_BY_CODE: Readonly<Record<string, AuthErrorTranslationKey>> = {
  '10': 'errors.googleUnavailable',
  'auth/app-not-authorized': 'errors.signInFailed',
  'auth/email-already-in-use': 'errors.emailInUse',
  'auth/invalid-email': 'errors.invalidEmail',
  'auth/invalid-api-key': 'errors.generic',
  'auth/missing-email': 'errors.missingEmail',
  'auth/weak-password': 'errors.weakPassword',
  'auth/password-does-not-meet-requirements': 'errors.passwordPolicy',
  passwordTooShort: 'errors.passwordPolicy',
  passwordTooLong: 'errors.passwordPolicy',
  passwordMissingUppercase: 'errors.passwordPolicy',
  passwordMissingNumber: 'errors.passwordPolicy',
  passwordMissingSpecialChar: 'errors.passwordPolicy',
  passwordPolicyMismatch: 'errors.passwordPolicy',
  'auth/missing-password': 'errors.missingPassword',
  'auth/user-not-found': 'errors.invalidLogin',
  'auth/wrong-password': 'errors.invalidLogin',
  'auth/invalid-credential': 'errors.invalidLogin',
  'auth/user-disabled': 'errors.invalidLogin',
  'auth/too-many-requests': 'errors.tooManyRequests',
  'auth/network-request-failed': 'errors.networkFailed',
  'auth/operation-not-allowed': 'errors.methodUnavailable',
  'auth/account-exists-with-different-credential': 'errors.accountExists',
  'auth/credential-already-in-use': 'errors.credentialInUse',
  'auth/provider-already-linked': 'errors.providerLinked',
  'permission-denied': 'errors.profileCreateFailed',
  unavailable: 'errors.serviceUnavailable',
  registrationBirthDateRequired: 'validation.birthDateRequired',
  registrationUnderage: 'validation.minimumAge',
  registrationBirthDateInvalid: 'validation.birthDateInvalid',
  registrationLegalAcceptanceRequired: 'validation.legalAcceptanceRequired',
};

export function authErrorTranslationKey(code: string): AuthErrorTranslationKey | null {
  return AUTH_ERROR_KEY_BY_CODE[code] ?? null;
}

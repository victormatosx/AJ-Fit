import { describe, expect, it } from 'vitest';
import {
  passwordChangeIssueFromError,
  validatePasswordChange,
  type PasswordChangeInput,
} from '../passwordChange';

const valid: PasswordChangeInput = {
  currentPassword: '123456',
  newPassword: 'Passphrase1!',
  confirmation: 'Passphrase1!',
};

describe('password change validation', () => {
  it.each([
    [{ ...valid, currentPassword: '' }, 'currentPasswordRequired'],
    [{ ...valid, newPassword: '' }, 'newPasswordRequired'],
    [{ ...valid, confirmation: '' }, 'confirmationRequired'],
    [{ ...valid, confirmation: 'different' }, 'passwordMismatch'],
    [{ currentPassword: 'same-pass', newPassword: 'same-pass', confirmation: 'same-pass' }, 'passwordUnchanged'],
    [{ ...valid, newPassword: 'a'.repeat(7), confirmation: 'a'.repeat(7) }, 'passwordTooShort'],
    [{ ...valid, newPassword: 'a'.repeat(4097), confirmation: 'a'.repeat(4097) }, 'passwordTooLong'],
    [{ ...valid, newPassword: 'abcdefg1!', confirmation: 'abcdefg1!' }, 'passwordMissingUppercase'],
    [{ ...valid, newPassword: 'Abcdefg!', confirmation: 'Abcdefg!' }, 'passwordMissingNumber'],
    [{ ...valid, newPassword: 'Abcdefgh1', confirmation: 'Abcdefgh1' }, 'passwordMissingSpecialChar'],
  ] as const)('rejects invalid input with %s', (input, issue) => {
    expect(validatePasswordChange(input)).toBe(issue);
  });

  it('accepts a valid change', () => {
    expect(validatePasswordChange(valid)).toBeNull();
  });

  it('accepts a legacy current password when the new password is compliant', () => {
    expect(
      validatePasswordChange({
        currentPassword: '123456',
        newPassword: 'Passphrase123!',
        confirmation: 'Passphrase123!',
      }),
    ).toBeNull();
  });
});

describe('password change error mapping', () => {
  it.each([
    ['auth/wrong-password', 'currentPasswordIncorrect'],
    ['auth/invalid-credential', 'currentPasswordIncorrect'],
    ['auth/weak-password', 'weakPassword'],
    ['auth/password-does-not-meet-requirements', 'weakPassword'],
    ['auth/requires-recent-login', 'sessionExpired'],
    ['auth/user-token-expired', 'sessionExpired'],
    ['auth/password-provider-required', 'providerRequired'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/network-request-failed', 'networkFailed'],
    ['auth/unexpected', 'changeFailed'],
  ])('maps %s to %s', (code, issue) => {
    expect(passwordChangeIssueFromError({ code })).toBe(issue);
  });

  it('does not expose unknown SDK messages', () => {
    expect(passwordChangeIssueFromError(new Error('sensitive SDK detail'))).toBe(
      'changeFailed',
    );
  });
});

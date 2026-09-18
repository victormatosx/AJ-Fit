import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ validatePassword: vi.fn() }));

vi.mock('firebase/auth', () => ({ validatePassword: mocks.validatePassword }));
vi.mock('../firebase', () => ({ auth: { project: 'test' } }));

import {
  assertNewPasswordMeetsPolicy,
  PASSWORD_POLICY_ALLOWED_SPECIAL_CHARACTERS,
  validateAuthFormPasswordPolicy,
  validateNewPasswordAgainstFirebase,
  validateNewPasswordLocally,
} from '../passwordPolicy';

describe('approved password policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validatePassword.mockResolvedValue({ isValid: true });
  });

  it.each([
    ['Abcde1!', 'passwordTooShort'],
    ['Abcdef1!', null],
    ['Abcdef1!' + 'a'.repeat(4088), null],
    ['a'.repeat(4097), 'passwordTooLong'],
  ] as const)('validates the approved length boundary (%s)', (password, issue) => {
    expect(validateNewPasswordLocally(password)).toBe(issue);
  });

  it.each([
    ['abcdefg1!', 'passwordMissingUppercase'],
    ['Abcdefgh1', 'passwordMissingSpecialChar'],
    ['Abcdefg!', 'passwordMissingNumber'],
  ] as const)('requires each composition rule individually (%s)', (password, issue) => {
    expect(validateNewPasswordLocally(password)).toBe(issue);
  });

  it.each([
    'Abcdef1!',
    'MyP@ssw0rd',
    'Tr3in0!Hoje',
  ])('accepts a password meeting every rule at once (%s)', (password) => {
    expect(validateNewPasswordLocally(password)).toBeNull();
  });

  // Approved policy: >= 8 characters, >= 1 uppercase, >= 1 number,
  // >= 1 special character. These exact vectors are the acceptance criteria
  // for the policy and are asserted against the one shared implementation
  // that the signup form, the submit path and every password mutation use.
  const MUST_BE_VALID = ['Ajfit@123', 'Treino#2026', 'Senha!123', 'Abcdef1!'] as const;
  const MUST_BE_INVALID = [
    ['abcdef1!', 'passwordMissingUppercase'],
    ['ABCDEFG!', 'passwordMissingNumber'],
    ['Abcdefg1', 'passwordMissingSpecialChar'],
    ['Ab1!', 'passwordTooShort'],
    ['abcdefgh', 'passwordMissingUppercase'],
  ] as const;

  it.each(MUST_BE_VALID)('accepts the approved example password %s', (password) => {
    expect(validateNewPasswordLocally(password)).toBeNull();
    expect(validateAuthFormPasswordPolicy('signup', password)).toBeNull();
  });

  it.each(MUST_BE_VALID)(
    'lets the approved example password %s through the full signup policy gate',
    async (password) => {
      await expect(assertNewPasswordMeetsPolicy(password)).resolves.toBeUndefined();
    },
  );

  it.each(MUST_BE_INVALID)('rejects %s with %s', (password, issue) => {
    expect(validateNewPasswordLocally(password)).toBe(issue);
    expect(validateAuthFormPasswordPolicy('signup', password)).toBe(issue);
  });

  it.each(MUST_BE_INVALID)(
    'keeps %s blocked at the full signup policy gate',
    async (password, issue) => {
      await expect(assertNewPasswordMeetsPolicy(password)).rejects.toMatchObject({
        code: issue,
      });
    },
  );

  it('reports the first unmet rule when several are missing at once', () => {
    // Missing uppercase AND number AND special char: uppercase is checked first.
    expect(validateNewPasswordLocally('abcdefgh')).toBe('passwordMissingUppercase');
    // Has uppercase, missing number AND special char: number is checked next.
    expect(validateNewPasswordLocally('Abcdefgh')).toBe('passwordMissingNumber');
  });

  it('matches exactly the non-alphanumeric character set Firebase\'s remote password policy accepts', () => {
    // Firebase's `allowedNonAlphanumericCharacters` for this project
    // (captured from the real `validatePassword` response) — anything
    // outside this exact set must never satisfy the local special-character
    // requirement, or a password accepted here could still be rejected by
    // Firebase once the remote policy enforces character composition.
    expect(PASSWORD_POLICY_ALLOWED_SPECIAL_CHARACTERS).toBe(
      '^$*.[]{}()?"!@#%&/\\,><\':;|_~`-',
    );
  });

  it.each([
    'Abcd123!',
    'Abcd123@',
    'Abcd123-',
  ])('accepts a Firebase-allowed special character (%s)', (password) => {
    expect(validateNewPasswordLocally(password)).toBeNull();
  });

  it.each([
    'Abcd123=',
    'Abcd123+',
    'Abcd123 ',
  ])('rejects a special character Firebase does not allow (%s)', (password) => {
    expect(validateNewPasswordLocally(password)).toBe('passwordMissingSpecialChar');
  });

  it('does not let an emoji satisfy the special-character requirement', () => {
    expect(validateNewPasswordLocally('Abcd123😀')).toBe('passwordMissingSpecialChar');
  });

  it('never applies creation policy to an existing login password', () => {
    expect(validateAuthFormPasswordPolicy('login', '123456')).toBeNull();
    expect(validateAuthFormPasswordPolicy('login', 'short')).toBeNull();
    expect(validateAuthFormPasswordPolicy('signup', '123456')).toBe(
      'passwordTooShort',
    );
  });

  it('uses Firebase validation after the local boundary passes', async () => {
    mocks.validatePassword.mockResolvedValueOnce({
      isValid: false,
      meetsMinPasswordLength: true,
      meetsMaxPasswordLength: true,
    });

    await expect(
      validateNewPasswordAgainstFirebase('Abcdef1!'),
    ).resolves.toBe('passwordPolicyMismatch');
    expect(mocks.validatePassword).toHaveBeenCalledWith(
      expect.anything(),
      'Abcdef1!',
    );
  });

  it.each([
    [{ containsUppercaseLetter: false }],
    [{ containsNumericCharacter: false }],
    [{ containsNonAlphanumericCharacter: false }],
  ] as const)(
    'reports remote policy drift instead of a locally worded issue (%o)',
    async (partialStatus) => {
      mocks.validatePassword.mockResolvedValueOnce({
        isValid: false,
        meetsMinPasswordLength: true,
        meetsMaxPasswordLength: true,
        ...partialStatus,
      });

      await expect(
        validateNewPasswordAgainstFirebase('Abcdef1!'),
      ).resolves.toBe('passwordPolicyMismatch');
    },
  );

  it('never tells the user a locally valid length is too short when the remote minimum is stricter', async () => {
    // Regression: the remote project policy still enforced `minPasswordLength:
    // 15` after the approved policy moved to 8. Mapping that to
    // `passwordTooShort` rendered "use at least 8 characters" for a
    // 9-character password — a requirement the password visibly met.
    mocks.validatePassword.mockResolvedValueOnce({
      isValid: false,
      meetsMinPasswordLength: false,
      meetsMaxPasswordLength: true,
    });

    await expect(validateNewPasswordAgainstFirebase('Ajfit@123')).resolves.toBe(
      'passwordPolicyMismatch',
    );
  });

  it('falls back to approved local checks when policy lookup is unavailable', async () => {
    mocks.validatePassword.mockRejectedValueOnce(new Error('network unavailable'));

    await expect(
      validateNewPasswordAgainstFirebase('Abcdef1!'),
    ).resolves.toBeNull();
    await expect(assertNewPasswordMeetsPolicy('a'.repeat(7))).rejects.toMatchObject({
      code: 'passwordTooShort',
    });
  });
});

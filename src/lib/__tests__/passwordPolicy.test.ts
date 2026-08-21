import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ validatePassword: vi.fn() }));

vi.mock('firebase/auth', () => ({ validatePassword: mocks.validatePassword }));
vi.mock('../firebase', () => ({ auth: { project: 'test' } }));

import {
  assertNewPasswordMeetsPolicy,
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
    ['a'.repeat(14), 'passwordTooShort'],
    ['a'.repeat(15), null],
    ['a'.repeat(16), null],
    ['a'.repeat(64), null],
    ['a'.repeat(4096), null],
    ['a'.repeat(4097), 'passwordTooLong'],
  ] as const)('validates the approved length boundary', (password, issue) => {
    expect(validateNewPasswordLocally(password)).toBe(issue);
  });

  it.each([
    'abcdefghijklmnop',
    '123456789012345',
    'uma passphrase longa sem simbolo',
  ])('does not invent composition requirements', (password) => {
    expect(validateNewPasswordLocally(password)).toBeNull();
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
      validateNewPasswordAgainstFirebase('a'.repeat(15)),
    ).resolves.toBe('passwordPolicyMismatch');
    expect(mocks.validatePassword).toHaveBeenCalledWith(
      expect.anything(),
      'a'.repeat(15),
    );
  });

  it('falls back to approved local checks when policy lookup is unavailable', async () => {
    mocks.validatePassword.mockRejectedValueOnce(new Error('network unavailable'));

    await expect(
      validateNewPasswordAgainstFirebase('a'.repeat(15)),
    ).resolves.toBeNull();
    await expect(assertNewPasswordMeetsPolicy('a'.repeat(14))).rejects.toMatchObject({
      code: 'passwordTooShort',
    });
  });
});

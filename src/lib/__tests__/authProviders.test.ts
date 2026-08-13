import { describe, expect, it } from 'vitest';
import { getReauthenticationProviders } from '../authProviders';

function user(providerIds: string[]) {
  return { providerData: providerIds.map((providerId) => ({ providerId })) };
}

describe('reauthentication provider policy', () => {
  it.each([
    [['password'], ['password']],
    [['google.com'], ['google']],
    [['apple.com'], ['apple']],
    [['google.com', 'password'], ['password', 'google']],
    [['apple.com', 'password'], ['password', 'apple']],
    [['apple.com', 'google.com'], ['google', 'apple']],
    [
      ['apple.com', 'password', 'google.com'],
      ['password', 'google', 'apple'],
    ],
  ])('maps linked providers %j to explicit choices %j', (linked, expected) => {
    expect(getReauthenticationProviders(user(linked))).toEqual(expected);
  });

  it('never invents a path for null or unsupported providers', () => {
    expect(getReauthenticationProviders(null)).toEqual([]);
    expect(getReauthenticationProviders(user(['phone']))).toEqual([]);
  });
});

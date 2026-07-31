import { describe, expect, it } from 'vitest';
import { getDisplayFirstName } from '../userName';

describe('getDisplayFirstName', () => {
  it('uses the profile name and keeps only the first name', () => {
    expect(
      getDisplayFirstName({ profileName: 'Victor Silva', authDisplayName: 'Victor Silva', email: 'victor@example.com' }),
    ).toBe('Victor');
  });

  it('falls back to the auth display name when profile is missing', () => {
    expect(getDisplayFirstName({ authDisplayName: 'Ana Paula', email: 'ana@example.com' })).toBe('Ana');
  });

  it('falls back to the email prefix when no name exists', () => {
    expect(getDisplayFirstName({ email: 'maria.souza@example.com' })).toBe('maria.souza');
  });
});

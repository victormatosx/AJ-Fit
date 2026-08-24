import { describe, expect, it } from 'vitest';
import {
  consumeDeepLinkIntent,
  enqueueDeepLinkIntent,
  parseDeepLink,
  type DeepLinkIntent,
} from '../deepLinks';

const ACTIVE_WORKOUT: DeepLinkIntent = { type: 'active-workout' };

describe('parseDeepLink', () => {
  it('recognizes the allowlisted active-workout URL', () => {
    expect(parseDeepLink('ajfit://workout/active')).toEqual(ACTIVE_WORKOUT);
  });

  it('ignores an unknown route', () => {
    expect(parseDeepLink('ajfit://profile/foo')).toBeNull();
  });

  it('ignores the right-looking route under the wrong scheme', () => {
    expect(parseDeepLink('https://workout/active')).toBeNull();
  });

  it.each(['', 'not a url', '://missing-scheme', 'ajfit://%'])(
    'does not throw for malformed input %j',
    (url) => {
      expect(() => parseDeepLink(url)).not.toThrow();
      expect(parseDeepLink(url)).toBeNull();
    },
  );

  it('never turns URL-controlled values into navigation state', () => {
    expect(parseDeepLink('ajfit://profile/active?tab=workout')).toBeNull();
    expect(parseDeepLink('ajfit://workout/active?tab=profile')).toBeNull();
    expect(parseDeepLink('ajfit://workout/active#profile')).toBeNull();
    expect(parseDeepLink('ajfit://user@workout/active')).toBeNull();
    expect(parseDeepLink('ajfit://workout/active')).toEqual({ type: 'active-workout' });
    expect(parseDeepLink('ajfit://workout/active')).not.toHaveProperty('tab');
  });
});

describe('pending deep-link intent state', () => {
  it('coalesces repeated pending intents and consumes the handled intent once', () => {
    const pending = enqueueDeepLinkIntent(null, ACTIVE_WORKOUT);
    const duplicate = enqueueDeepLinkIntent(pending, { type: 'active-workout' });

    expect(duplicate).toBe(pending);
    expect(consumeDeepLinkIntent(duplicate, ACTIVE_WORKOUT)).toBeNull();
    expect(consumeDeepLinkIntent(null, ACTIVE_WORKOUT)).toBeNull();
  });
});

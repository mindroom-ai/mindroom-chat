import { describe, expect, it } from 'vitest';
import { isInAppPath } from './afterLoginRedirectPath';

describe('isInAppPath', () => {
  it('accepts app paths', () => {
    expect(isInAppPath('/home/')).toBe(true);
    expect(isInAppPath('/connect?code=ABCD-EFGH')).toBe(true);
  });

  it('rejects URLs and paths a browser treats as another host', () => {
    expect(isInAppPath('https://evil.test/')).toBe(false);
    expect(isInAppPath('//evil.test/')).toBe(false);
    expect(isInAppPath('/\\evil.test/')).toBe(false);
    expect(isInAppPath('home')).toBe(false);
    expect(isInAppPath(undefined)).toBe(false);
  });
});

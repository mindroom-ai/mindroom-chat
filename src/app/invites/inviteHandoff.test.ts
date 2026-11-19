// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdInviteLink, takeInviteFragment } from './inviteHandoff';

const LINK = '#r=%40router%3Aexample.org&c=secret-code';

const openAt = (url: string) => {
  window.history.replaceState(null, '', url);
  holdInviteLink();
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('holdInviteLink', () => {
  it.each(['/invite/', '/invite', '/%69nvite/', '/INVITE//', '/chat/invite/'])(
    'takes the code out of the address of %s before anything reads it',
    (path) => {
      openAt(`${path}?x=1${LINK}`);
      expect(window.location.hash).toBe('');
      expect(`${window.location.pathname}${window.location.search}`).toBe(`${path}?x=1`);
      expect(JSON.stringify({ ...localStorage })).not.toContain('secret-code');
      expect(takeInviteFragment()).toBe(LINK);
      expect(takeInviteFragment()).toBe('');
    }
  );

  it('keeps the newest link', () => {
    openAt(`/invite/${LINK}`);
    openAt('/invite/#r=%40router%3Aexample.org&c=second');
    expect(takeInviteFragment()).toBe('#r=%40router%3Aexample.org&c=second');
  });

  it('drops an expired link at boot', () => {
    vi.useFakeTimers();
    openAt(`/invite/${LINK}`);
    vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
    openAt('/home/');
    expect(sessionStorage.length).toBe(0);
  });

  it('still clears the address, and reads nothing, without session storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => openAt(`/invite/${LINK}`)).not.toThrow();
    expect(window.location.hash).toBe('');
    expect(takeInviteFragment()).toBe('');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveAuthRouteRedirect,
  resolveProtectedRouteRedirect,
  resolveRootRouteRedirect,
} from './routeSessionGuards';
import { getHomePath, getLoginPath } from './pathUtils';

describe('routeSessionGuards', () => {
  const originalWindow = globalThis.window;
  const originalBasePath = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  afterEach(() => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalBasePath;

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('sends signed-in users at root to home', () => {
    expect(
      resolveRootRouteRedirect('https://chat.mindroom.chat/', {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE',
        accessToken: 'token',
        lastUsedAt: 1,
      })
    ).toEqual({
      redirectTo: getHomePath(),
    });
  });

  it('captures after-login path when redirecting signed-out root visits to login', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://chat.mindroom.chat',
        },
      },
      configurable: true,
    });

    expect(resolveRootRouteRedirect('https://chat.mindroom.chat/space/%23lobby%3Amindroom.chat')).toEqual({
      redirectTo: getLoginPath(),
      afterLoginPath: '/space/%23lobby%3Amindroom.chat',
    });
  });

  it('keeps auth routes accessible for add-account flows', () => {
    const activeSession = {
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    };

    expect(resolveAuthRouteRedirect('https://chat.mindroom.chat/login', activeSession)).toBe(
      getHomePath()
    );
    expect(
      resolveAuthRouteRedirect('https://chat.mindroom.chat/login?addAccount=1', activeSession)
    ).toBeNull();
  });

  it('redirects protected routes to login when there are no stored sessions', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://chat.mindroom.chat',
        },
      },
      configurable: true,
    });

    expect(
      resolveProtectedRouteRedirect(
        'https://chat.mindroom.chat/home/%23room%3Amindroom.chat',
        undefined,
        false
      )
    ).toEqual({
      redirectTo: getLoginPath(),
      afterLoginPath: '/home/%23room%3Amindroom.chat',
    });
  });

  it('redirects protected routes to login when accounts exist but none is active', () => {
    expect(
      resolveProtectedRouteRedirect(
        'https://chat.mindroom.chat/home',
        undefined,
        true,
        undefined
      )
    ).toEqual({
      redirectTo: getLoginPath(),
    });
  });

  it('allows protected routes when an active session exists', () => {
    expect(
      resolveProtectedRouteRedirect(
        'https://chat.mindroom.chat/home',
        undefined,
        true,
        {
          sessionId: 'session-a',
          baseUrl: 'https://chat.mindroom.chat',
          userId: '@alice:mindroom.chat',
          deviceId: 'DEVICE',
          accessToken: 'token',
          lastUsedAt: 1,
        }
      )
    ).toBeNull();
  });
});

// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const homeserver = vi.hoisted(() => ({ versions: ['v1.11'] }));

vi.mock('./useSpecVersions', () => ({
  useSpecVersions: () => ({ versions: homeserver.versions }),
}));

vi.mock('../../config/runtimeConfig', () => ({
  isServiceWorkerEnabled: () => true,
}));

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.resetModules();
  homeserver.versions = ['v1.11'];
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  document.body.replaceChildren();
});

/** Renders the hook and returns a reader of its latest value. */
const renderHook = async () => {
  const module = await import('./useMediaAuthentication');
  let value: boolean | undefined;
  const Probe = () => {
    value = module.useMediaAuthenticationUnavailable();
    return null;
  };
  act(() => {
    renderer = create(React.createElement(Probe));
  });
  return { module, read: () => value };
};

/** An image that fails to load `src`, as an `<img>` the server refused does. */
const failImage = (src: string) =>
  act(() => {
    const image = document.createElement('img');
    image.src = src;
    document.body.append(image);
    image.dispatchEvent(new Event('error'));
  });

const LEGACY_EMOJI = 'https://matrix.example/_matrix/media/v3/thumbnail/matrix.example/abc?width=32';

describe('useMediaAuthenticationUnavailable', () => {
  it('turns on once a legacy media image fails on a page that cannot run the service worker', async () => {
    const { module, read } = await renderHook();
    failImage(LEGACY_EMOJI);
    expect(read()).toBe(false);

    act(() => module.markServiceWorkerUnavailable());
    expect(read()).toBe(false);

    failImage('https://cdn.example/picture.png');
    expect(read()).toBe(false);

    failImage(LEGACY_EMOJI);
    expect(read()).toBe(true);
  });

  it('stays off on a homeserver without authenticated media, whose legacy images just failed', async () => {
    homeserver.versions = ['v1.10'];
    const { module, read } = await renderHook();
    act(() => module.markServiceWorkerUnavailable());
    failImage(LEGACY_EMOJI);
    expect(read()).toBe(false);
  });

  it('stays off while a service worker controls the page', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: Object.assign(new EventTarget(), { controller: {} }),
    });
    try {
      const { module, read } = await renderHook();
      act(() => module.markServiceWorkerUnavailable());
      failImage(LEGACY_EMOJI);
      expect(read()).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });
});

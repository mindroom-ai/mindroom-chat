import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBrowserCacheAndReload } from '../../../client/initMatrix';
import { removeFallbackSession } from '../../state/sessions';
import { SpecVersions } from './SpecVersions';

let specVersionsLoaderMode: 'fallback' | 'error' | 'success' = 'success';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    Dialog: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    Text: ({ children }: { children: React.ReactNode }) => reactModule.createElement('span', null, children),
    Button: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => reactModule.createElement('button', { onClick }, children),
    Spinner: () => reactModule.createElement('div', null, 'spinner'),
    config: {
      space: {
        S400: '16px',
      },
    },
  };
});

vi.mock('../../components/splash-screen', () => ({
  SplashScreen: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../components/SpecVersionsLoader', () => ({
  SpecVersionsLoader: ({
    fallback,
    error,
    children,
  }: {
    fallback?: () => React.ReactNode;
    error?: (err: unknown, retry: () => void, ignore: () => void) => React.ReactNode;
    children: (versions: { versions: string[] }) => React.ReactNode;
  }) => {
    if (specVersionsLoaderMode === 'fallback') return fallback?.() ?? null;
    if (specVersionsLoaderMode === 'error') {
      return error?.(new Error('request failed'), () => undefined, () => undefined) ?? null;
    }
    return children({ versions: [] });
  },
}));

vi.mock('../../state/sessions', () => ({
  removeFallbackSession: vi.fn(),
}));

vi.mock('../../../client/initMatrix', () => ({
  clearBrowserCacheAndReload: vi.fn(),
}));

describe('SpecVersions', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();
    specVersionsLoaderMode = 'success';

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('supports canceling from connecting state', async () => {
    specVersionsLoaderMode = 'fallback';
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const renderer = create(
      React.createElement(
        SpecVersions,
        { baseUrl: 'https://example.com' },
        React.createElement('div', null, 'child')
      )
    );

    const cancelButton = renderer.root
      .findAllByType('button')
      .find((node) =>
        node.findAllByType('span').some((textNode) => textNode.children.join('') === 'Cancel and return to sign in')
      );

    expect(cancelButton).toBeDefined();

    await act(async () => {
      cancelButton?.props.onClick();
    });

    expect(vi.mocked(removeFallbackSession)).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows clear-cache recovery on connection error', async () => {
    specVersionsLoaderMode = 'error';
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          reload: vi.fn(),
        },
      },
      configurable: true,
    });

    const renderer = create(
      React.createElement(
        SpecVersions,
        { baseUrl: 'https://example.com' },
        React.createElement('div', null, 'child')
      )
    );

    const clearCacheButton = renderer.root
      .findAllByType('button')
      .find((node) =>
        node.findAllByType('span').some((textNode) => textNode.children.join('') === 'Clear Cache and Reload')
      );

    expect(clearCacheButton).toBeDefined();

    await act(async () => {
      clearCacheButton?.props.onClick();
    });

    expect(vi.mocked(clearBrowserCacheAndReload)).toHaveBeenCalledTimes(1);
  });
});

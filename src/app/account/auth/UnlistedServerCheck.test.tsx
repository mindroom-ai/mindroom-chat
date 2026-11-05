// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { useSsoStartCheck, type SsoStartCheck } from './unlistedServer';
import { UnlistedServerCheck } from './UnlistedServerCheck';

// jsdom has no layout, so focus-trap finds nothing tabbable; the trap itself is not under test.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const SHIPPED: ClientConfig = {
  homeserverList: ['mindroom.chat', 'matrix.org'],
  defaultHomeserver: 0,
  allowCustomHomeservers: true,
};

describe('UnlistedServerCheck', () => {
  let host: HTMLDivElement;
  let root: Root;
  let check: SsoStartCheck | undefined;

  function Probe() {
    check = useSsoStartCheck();
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    check = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const show = (server: string, baseUrl: string) =>
    act(() =>
      root.render(
        <ClientConfigProvider value={SHIPPED}>
          <UnlistedServerCheck server={server} baseUrl={baseUrl}>
            <Probe />
          </UnlistedServerCheck>
        </ClientConfigProvider>
      )
    );

  const prompt = () => document.querySelector('[role="alertdialog"]');
  const button = (text: string) =>
    [...(prompt()?.querySelectorAll('button') ?? [])].find((item) => item.textContent === text);

  it('sets no check on a listed server, so its buttons start at once', () => {
    show('MindRoom.Chat', 'https://mindroom.chat');
    expect(check).toBeUndefined();
    show('matrix.org', 'https://matrix-client.matrix.org');
    expect(check).toBeUndefined();
  });

  it('asks first on any other server, naming the host the login goes to', () => {
    show('evil-hs.example', 'https://matrix.evil-hs.example');
    const start = vi.fn();
    expect(prompt()).toBeNull();

    act(() => check?.(start));

    expect(prompt()?.textContent).toContain('Signing in sends your login to this server:');
    expect(document.getElementById('unlisted-server-host')?.textContent).toBe(
      'matrix.evil-hs.example'
    );
    expect(prompt()?.textContent).toContain('Only continue if you trust matrix.evil-hs.example.');
    expect(start).not.toHaveBeenCalled();
  });

  it('drops the sign-in on Cancel and starts it once on Continue', () => {
    show('evil-hs.example', 'https://evil-hs.example');
    const refused = vi.fn();
    act(() => check?.(refused));
    act(() => button('Cancel')?.click());
    expect(prompt()).toBeNull();
    expect(refused).not.toHaveBeenCalled();

    const accepted = vi.fn();
    act(() => check?.(accepted));
    act(() => button('Continue')?.click());
    expect(prompt()).toBeNull();
    expect(accepted).toHaveBeenCalledOnce();
    expect(refused).not.toHaveBeenCalled();
  });
});

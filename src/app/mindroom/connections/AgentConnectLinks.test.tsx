// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConnectLinkFeature, agentLinkBackend } from './AgentConnectLinks';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  openPortal: vi.fn(() => 'opened' as 'opened' | 'blocked'),
  urls: ['https://app.example.org'],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));
vi.mock('../computer/useComputerApiUrl', () => ({
  useComputerApiUrls: () => ({ urls: mocks.urls, discovered: false }),
}));
vi.mock('./useOpenConnectionsPortal', () => ({
  useOpenConnectionsPortal: () => mocks.openPortal,
}));

const CONNECT_PATH =
  '/api/oauth/slack/authorize?connect_token=t&agent_name=mind_alice&execution_scope=user';

describe('agentLinkBackend', () => {
  it.each([
    [`https://app.example.org${CONNECT_PATH}`, 'https://app.example.org/'],
    [
      'https://app.example.org/api/oauth/google_gmail/reset?reset_token=t',
      'https://app.example.org/',
    ],
    [`https://other.example.org${CONNECT_PATH}`, undefined],
    ['https://app.example.org/api/oauth/slack/callback?code=c', undefined],
    ['https://app.example.org/connections/', undefined],
    ['not a url', undefined],
  ])('maps %s to %s', (href, backend) => {
    expect(agentLinkBackend(href, ['https://app.example.org/'])).toBe(backend);
  });
});

describe('AgentConnectLinkFeature', () => {
  let renderer: ReactTestRenderer | undefined;
  let anchor: HTMLAnchorElement;

  const render = () =>
    act(() => {
      renderer = create(<AgentConnectLinkFeature />);
    });
  const click = (init: MouseEventInit = {}, target: Element = anchor) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    mocks.isNativePlatform.mockReset().mockReturnValue(false);
    mocks.openPortal.mockReset().mockReturnValue('opened');
    mocks.urls = ['https://app.example.org'];
    anchor = document.createElement('a');
    anchor.href = `https://app.example.org${CONNECT_PATH}`;
    anchor.target = '_blank';
    anchor.innerHTML = '<span>link</span>';
    document.body.append(anchor);
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    anchor.remove();
  });

  it('opens a clicked connect link through the signed-in portal instead of the browser', () => {
    render();
    const event = click({}, anchor.querySelector('span')!);
    expect(mocks.openPortal).toHaveBeenCalledWith('https://app.example.org', CONNECT_PATH);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the click to the browser when the portal window is blocked', () => {
    mocks.openPortal.mockReturnValue('blocked');
    render();
    expect(click().defaultPrevented).toBe(false);
    expect(mocks.openPortal).toHaveBeenCalledTimes(1);
  });

  it.each([
    { button: 1 },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
  ])('leaves %o clicks to the browser', (init) => {
    render();
    expect(click(init).defaultPrevented).toBe(false);
    expect(mocks.openPortal).not.toHaveBeenCalled();
  });

  it('leaves links to other backends and other paths to the browser', () => {
    render();
    anchor.href = `https://other.example.org${CONNECT_PATH}`;
    expect(click().defaultPrevented).toBe(false);
    anchor.href = 'https://app.example.org/connections/';
    expect(click().defaultPrevented).toBe(false);
    expect(mocks.openPortal).not.toHaveBeenCalled();
  });

  it('follows the current backend list', () => {
    mocks.urls = [];
    render();
    expect(click().defaultPrevented).toBe(false);
    mocks.urls = ['https://app.example.org'];
    act(() => renderer!.update(<AgentConnectLinkFeature />));
    expect(click().defaultPrevented).toBe(true);
  });

  it('stays out of the native apps and stops listening when unmounted', () => {
    mocks.isNativePlatform.mockReturnValue(true);
    render();
    expect(click().defaultPrevented).toBe(false);
    act(() => renderer!.unmount());
    mocks.isNativePlatform.mockReturnValue(false);
    renderer = undefined;
    render();
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(click().defaultPrevented).toBe(false);
    expect(mocks.openPortal).not.toHaveBeenCalled();
  });
});

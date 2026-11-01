// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsPage } from './ConnectionsPage';

const mocks = vi.hoisted(() => ({
  urls: [] as string[],
  native: false,
  handOff: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock('../computer/useComputerApiUrl', () => ({
  useComputerApiUrls: () => ({ urls: mocks.urls, discovered: false }),
}));
vi.mock('./useOpenConnectionsPortal', () => ({ useConnectionsHandoff: () => mocks.handOff }));
vi.mock('../settings/MindroomConnectionsSettings', () => ({
  MindroomConnectionsSettings: () => <section>settings card</section>,
}));
vi.mock('../../components/page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
  PageContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const render = async () => {
  await act(async () => {
    create(<ConnectionsPage />);
  });
};

afterEach(() => {
  mocks.urls = [];
  mocks.native = false;
  mocks.handOff.mockClear();
});

describe('ConnectionsPage', () => {
  it('opens the portal of the only MindRoom server signed in, once', async () => {
    mocks.urls = ['https://backend.example.org'];
    await render();
    expect(mocks.handOff).toHaveBeenCalledOnce();
    expect(mocks.handOff).toHaveBeenCalledWith('https://backend.example.org');
  });

  it.each([
    ['several servers', ['https://a.example.org', 'https://b.example.org'], false],
    ['no server', [], false],
    ['the native app', ['https://backend.example.org'], true],
  ])('leaves %s to the Settings card', async (_case, urls, native) => {
    mocks.urls = urls;
    mocks.native = native;
    await render();
    expect(mocks.handOff).not.toHaveBeenCalled();
  });
});

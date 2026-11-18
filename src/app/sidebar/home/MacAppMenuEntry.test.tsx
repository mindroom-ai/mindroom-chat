import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { MAC_APP_RELEASES_URL, resetMacAppDownloadUrlForTests } from '../../native/macApp';
import { MacAppMenuEntry } from './MacAppMenuEntry';

const state = vi.hoisted(() => ({ macBrowser: true }));

vi.mock('../../lib/user-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/user-agent')>()),
  isMacOS: () => state.macBrowser,
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({ Line: () => null }));
vi.mock('../../ui/MenuEntry', () => ({
  MenuGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  MenuEntry: ({ label, onSelect }: { label: string; onSelect: () => void }) =>
    React.createElement('button', { onClick: onSelect }, label),
}));

const OFFERED: ClientConfig = { macApp: { offer: true } };

const menu = (onClose: () => void, config: ClientConfig = OFFERED) =>
  create(
    <ClientConfigProvider value={config}>
      <MacAppMenuEntry onClose={onClose} />
    </ClientConfigProvider>
  );

const DMG = 'https://github.com/mindroom-ai/mindroom-chat/releases/download/v1/MindRoom.dmg';

describe('MacAppMenuEntry', () => {
  // GitHub's list of releases never answers, unless a test answers it.
  const fetchReleases = vi.fn(() => new Promise<Response>(() => undefined));

  beforeEach(() => {
    resetMacAppDownloadUrlForTests();
    fetchReleases.mockReset();
    fetchReleases.mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchReleases);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    state.macBrowser = true;
  });

  it('adds nothing outside a browser on a Mac', () => {
    state.macBrowser = false;
    expect(menu(vi.fn()).toJSON()).toBeNull();
  });

  it('adds nothing where the deployment does not offer the app', () => {
    expect(menu(vi.fn(), {}).toJSON()).toBeNull();
    expect(menu(vi.fn(), { macApp: { offer: false } }).toJSON()).toBeNull();
    expect(fetchReleases).not.toHaveBeenCalled();
  });

  it('closes the menu and opens the download in a browser on a Mac', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const onClose = vi.fn();
    const renderer = menu(onClose);
    const [entry, ...others] = renderer.root.findAllByType('button');
    expect(others).toEqual([]);
    expect(entry?.children).toEqual(['Download Mac app']);

    act(() => {
      entry?.props.onClick();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(MAC_APP_RELEASES_URL, '_blank', 'noopener,noreferrer');
  });

  it('opens the disk image of the newest release that has one, once GitHub has named it', async () => {
    fetchReleases.mockResolvedValue(
      new Response(
        JSON.stringify([
          { assets: [{ name: 'MindRoom.dmg', state: 'uploaded', browser_download_url: DMG }] },
        ])
      )
    );
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    let renderer!: ReturnType<typeof menu>;
    await act(async () => {
      renderer = menu(vi.fn());
    });
    const [entry] = renderer.root.findAllByType('button');

    act(() => {
      entry?.props.onClick();
    });

    expect(open).toHaveBeenCalledWith(DMG, '_blank', 'noopener,noreferrer');
  });
});

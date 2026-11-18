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
  MenuEntry: ({ label, href, onSelect }: { label: string; href?: string; onSelect: () => void }) =>
    React.createElement('a', { href, onClick: onSelect }, label),
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

  it('links the releases page in a browser on a Mac, and closes the menu when chosen', () => {
    const onClose = vi.fn();
    const renderer = menu(onClose);
    const [entry, ...others] = renderer.root.findAllByType('a');
    expect(others).toEqual([]);
    expect(entry?.children).toEqual(['Download Mac app']);
    expect(entry?.props.href).toBe(MAC_APP_RELEASES_URL);

    act(() => {
      entry?.props.onClick();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('links the disk image of the newest release that has one, once GitHub has named it', async () => {
    let respond!: (response: Response) => void;
    fetchReleases.mockReturnValue(
      new Promise<Response>((resolve) => {
        respond = resolve;
      })
    );
    const renderer = menu(vi.fn());
    const entry = () => renderer.root.findByType('a');
    expect(entry().props.href).toBe(MAC_APP_RELEASES_URL);

    await act(async () => {
      respond(
        new Response(
          JSON.stringify([
            { assets: [{ name: 'MindRoom.dmg', state: 'uploaded', browser_download_url: DMG }] },
          ])
        )
      );
    });

    expect(entry().props.href).toBe(DMG);
  });
});

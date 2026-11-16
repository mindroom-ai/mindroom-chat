import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { settingsModalAtom } from '../navigation/settingsModal';
import { SettingsPages } from '../navigation/settingsPages';
import { SettingsModalRenderer } from './SettingsModalRenderer';

vi.mock('../ui/Modal500', () => ({
  Modal500: ({ children, requestClose }: { children: React.ReactNode; requestClose: () => void }) =>
    React.createElement('div', { 'data-testid': 'settings-modal', requestClose }, children),
}));

vi.mock('./Settings', () => ({
  Settings: ({
    initialPage,
    initialSetting,
    requestClose,
  }: {
    initialPage?: import('../navigation/settingsPages').SettingsPage;
    initialSetting?: string;
    requestClose: () => void;
  }) =>
    React.createElement('div', {
      'data-testid': 'settings-view',
      'data-initial-page': initialPage,
      'data-initial-setting': initialSetting,
      requestClose,
    }),
}));

const renderModal = async (store: ReturnType<typeof createStore>) => {
  // Inside act, the first render's effects (the store subscription among them) run before the
  // test goes on. After a bare create() React's scheduler ran them in a later task, and on a busy
  // machine that came after a close the test sends.
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      React.createElement(Provider, { store }, React.createElement(SettingsModalRenderer))
    );
  });
  return renderer;
};

describe('SettingsModalRenderer', () => {
  it('renders the shared settings modal state and closes by clearing it', async () => {
    const store = createStore();
    store.set(settingsModalAtom, {
      initialPage: SettingsPages.PrivacyPage,
    });

    const renderer = await renderModal(store);

    const settingsView = renderer.root.findByProps({ 'data-testid': 'settings-view' });
    expect(settingsView.props['data-initial-page']).toBe(SettingsPages.PrivacyPage);

    await act(async () => {
      settingsView.props.requestClose();
    });

    expect(store.get(settingsModalAtom)).toBeUndefined();
    expect(renderer.root.findAllByProps({ 'data-testid': 'settings-modal' })).toHaveLength(0);
  });

  it('opens Settings at the setting the state names', async () => {
    const store = createStore();
    store.set(settingsModalAtom, {
      initialPage: SettingsPages.AppearancePage,
      initialSetting: 'pageZoom',
    });

    const renderer = await renderModal(store);

    const settingsView = renderer.root.findByProps({ 'data-testid': 'settings-view' });
    expect(settingsView.props['data-initial-page']).toBe(SettingsPages.AppearancePage);
    expect(settingsView.props['data-initial-setting']).toBe('pageZoom');
  });
});

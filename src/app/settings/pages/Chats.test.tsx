// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Choice } from '../../ui/settings/ChoiceButton';
import { getSettings, settingsAtom } from '../../preferences/settings';
import {
  loadPendingRoamingSettings,
  pendingRoamingSettingsAtom,
  pendingRoamingSettingsKey,
  roamingAccountContentAtom,
} from '../../preferences/roamingSettings';
import { Chats } from './Chats';

vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({
    focusId,
    title,
    description,
    after,
  }: {
    focusId?: string;
    title?: React.ReactNode;
    description?: React.ReactNode;
    after?: React.ReactNode;
  }) => (
    <div data-focus-id={focusId} data-title={title} data-description={description}>
      {after}
    </div>
  ),
}));

vi.mock('../../ui/settings/SettingSwitchTile', () => ({
  SettingSwitchTile: ({ focusId }: { focusId?: string }) => <div data-focus-id={focusId} />,
}));

vi.mock('../../ui/settings/ChoiceButton', () => ({
  ChoiceButton: ({
    label,
    value,
    choices,
    onChoose,
  }: {
    label: string;
    value: string;
    choices: ReadonlyArray<Choice<string>>;
    onChoose: (value: string) => void;
  }) => (
    <div data-choice-label={label} data-choice-value={value}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          data-choice-option={choice.value}
          onClick={() => onChoose(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({
    title,
    children,
  }: {
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) => <main data-page-title={title}>{children}</main>,
}));

vi.mock('../../ui/settings/SettingsSection', () => ({
  SettingsSection: ({
    title,
    children,
  }: {
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <section data-section-title={title}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  ),
}));

vi.mock('../../emoji/packs/ImagePackView', () => ({ ImagePackView: () => null }));
vi.mock('../../emoji/settings/UserPack', () => ({ UserPack: () => null }));
vi.mock('../../emoji/settings/GlobalPacks', () => ({ GlobalPacks: () => null }));
vi.mock('../../emoji/settings/ServerPack', () => ({ ServerPack: () => null }));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;

const renderChats = () =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <Chats requestClose={() => undefined} />
      </Provider>
    );
  });

beforeEach(() => {
  localStorage.clear();
  store = createStore();
});

afterEach(() => {
  act(() => renderer.unmount());
});

describe('Chats settings page', () => {
  it('places Media compression in the Editor section right after Markdown Formatting with Off, Balanced, and Small presets', () => {
    renderChats();

    const editorSection = renderer.root.findByProps({ 'data-section-title': 'Editor' });
    const editorFocusIds = editorSection
      .findAll((node) => typeof node.props['data-focus-id'] === 'string')
      .map((node) => node.props['data-focus-id']);
    expect(editorFocusIds).toEqual([
      'enterForNewline',
      'voiceHoldShortcut',
      'markdown',
      'mediaCompression',
    ]);

    const tile = editorSection.findByProps({ 'data-focus-id': 'mediaCompression' });
    expect(tile.props['data-title']).toBe('Media compression');
    expect(tile.props['data-description']).toBeTruthy();

    const picker = tile.findByProps({ 'data-choice-label': 'Media compression' });
    expect(picker.props['data-choice-value']).toBe('balanced');
    const options = picker
      .findAllByType('button')
      .map((button) => [button.props['data-choice-option'], button.children.join('')]);
    expect(options).toEqual([
      ['off', 'Off'],
      ['balanced', 'Balanced'],
      ['small', 'Small'],
    ]);
  });

  it('persists selected preset to device storage when signed out and to pending roaming edits when signed in', () => {
    renderChats();

    const option = (value: string) => renderer.root.findByProps({ 'data-choice-option': value });

    act(() => {
      option('small').props.onClick();
    });
    expect(store.get(settingsAtom).mediaCompression).toBe('small');
    expect(getSettings().mediaCompression).toBe('small');

    act(() => {
      option('off').props.onClick();
    });
    expect(store.get(settingsAtom).mediaCompression).toBe('off');
    expect(getSettings().mediaCompression).toBe('off');

    act(() => renderer.unmount());

    localStorage.clear();
    const aliceKey = pendingRoamingSettingsKey('@alice:example.org', 'ALICEPHONE');
    store = createStore();
    store.set(roamingAccountContentAtom, { version: 1, mediaCompression: 'balanced' });
    store.set(pendingRoamingSettingsAtom, { storageKey: aliceKey, values: {} });
    renderChats();

    act(() => {
      option('small').props.onClick();
    });
    expect(store.get(settingsAtom).mediaCompression).toBe('small');
    expect(loadPendingRoamingSettings(aliceKey)).toEqual({ mediaCompression: 'small' });
    expect(getSettings().mediaCompression).toBe('balanced');
  });
});

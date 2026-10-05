// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import {
  computerServicePreferenceAtom,
  loadComputerServicePreference,
} from '../computer/computerServiceSettings';
import { MindroomComputerSettings } from './MindroomComputerSettings';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, role }: { children?: React.ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Input: ({
    size: _size,
    variant: _variant,
    ...props
  }: Omit<React.ComponentProps<'input'>, 'size'> & { size?: string; variant?: string }) => (
    <input {...props} />
  ),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

let renderer: ReactTestRenderer;
let store: ReturnType<typeof createStore>;
const button = (label: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findByType('span').children.join('') === label)!;
const input = () => renderer.root.findByType('input');
const message = (role: string) =>
  renderer.root.findAllByType('span').find((node) => node.props.role === role)!;
const edit = (value: string) => act(() => input().props.onChange({ currentTarget: { value } }));
const click = (label: string) => act(() => button(label).props.onClick());

beforeEach(() => {
  localStorage.clear();
  store = createStore();
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.restoreAllMocks();
});
const render = (deploymentUrl = '') =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          <MindroomComputerSettings />
        </ClientConfigProvider>
      </Provider>
    );
  });

describe('computer service settings', () => {
  it('explains LAN HTTP before Save, persists it, and clears the notice for HTTPS', () => {
    render();
    edit('http://192.168.1.50:8765/');
    expect(message('note').children).toEqual([
      'HTTP does not encrypt your sign-in or computer traffic. Use it only on a trusted local network.',
    ]);
    expect(loadComputerServicePreference()).toBeNull();
    click('Save computer service');
    expect(loadComputerServicePreference()).toBe('http://192.168.1.50:8765');
    expect(input().props.value).toBe('http://192.168.1.50:8765');
    expect(message('note')).toBeDefined();
    click('Use MindRoom Lab');
    expect(message('note')).toBeUndefined();
  });

  it('offers a lab preset that requires Save, persists it, and keeps confirmation visible', () => {
    render();
    click('Use MindRoom Lab');
    expect(input().props.value).toBe('https://mindroom.lab.mindroom.chat');
    expect(loadComputerServicePreference()).toBeNull();
    click('Save computer service');
    expect(loadComputerServicePreference()).toBe('https://mindroom.lab.mindroom.chat');
    expect(message('status').children).toEqual(['Computer service saved.']);
  });

  it('validates custom origins without changing the current service', () => {
    render('https://deployment.example');
    edit('https://user:secret@example.org/path');
    click('Save computer service');
    expect(message('alert')).toBeDefined();
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    expect(loadComputerServicePreference()).toBeNull();
  });

  it('normalizes custom URLs, disables on blank, and restores the displayed deployment', () => {
    render('https://deployment.example');
    edit('https://custom.example/');
    click('Save computer service');
    expect(input().props.value).toBe('https://custom.example');
    edit('');
    click('Save computer service');
    expect(store.get(computerServicePreferenceAtom)).toBe('');
    click('Use app default');
    expect(input().props.value).toBe('https://deployment.example');
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    edit('https://unsaved.example');
    click('Use app default');
    expect(input().props.value).toBe('https://deployment.example');
  });

  it('reports failed persistence without activating the entered service', () => {
    render();
    edit('https://custom.example');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    click('Save computer service');
    expect(message('alert').children).toEqual([
      'Could not save the computer service on this device.',
    ]);
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
  });
});

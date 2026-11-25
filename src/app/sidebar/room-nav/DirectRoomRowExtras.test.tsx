// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMsgDraftStorageKey,
  getRoomInputDraftKey,
  readStoredMsgDraft,
  roomIdToWrittenMsgDraftAtomFamily,
} from '../../composer/roomInputDrafts';
import { RoomDraftMark } from './DirectRoomRowExtras';

const ME = '@robin:example.org';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Draft', i18n: { language: 'en' } }),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => ME }) as unknown as MatrixClient,
}));

vi.mock('./RoomNavItem.css', () => ({
  SelfDirectTag: 'SelfDirectTag',
  GroupCountAvatar: 'GroupCountAvatar',
}));

vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => {}),
}));

vi.mock('folds', () => ({
  Avatar: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  Icon: ({ ref: _ref, ...props }: Record<string, unknown>) => React.createElement('i', props),
  Icons: { Pencil: 'Pencil' },
  Text: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
  config: { opacity: { P500: 0.5 } },
}));

vi.mock('../../composer/roomInputDrafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../composer/roomInputDrafts')>();
  return {
    ...actual,
    readStoredMsgDraft: vi.fn(actual.readStoredMsgDraft),
  };
});

const makeRoom = (roomId: string) => ({ roomId, myUserId: ME }) as unknown as Room;

const DRAFT_NODES = [{ type: 'paragraph', children: [{ text: 'Hello from draft' }] }];

describe('RoomDraftMark', () => {
  const touchedKeys = new Set<string>();

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    touchedKeys.forEach((key) => roomIdToWrittenMsgDraftAtomFamily.remove(key));
    touchedKeys.clear();
    vi.mocked(readStoredMsgDraft).mockClear();
  });

  it('reads stored drafts once on mount and memoizes across hover/focus showIcon re-renders', () => {
    const room = makeRoom('!dm-memo:example.org');
    const draftKey = getRoomInputDraftKey(ME, room.roomId);
    touchedKeys.add(draftKey);
    window.localStorage.setItem(getMsgDraftStorageKey(draftKey), JSON.stringify(DRAFT_NODES));

    const store = createStore();
    const { container, rerender } = render(
      <Provider store={store}>
        <RoomDraftMark room={room} descriptionId="draft-desc" showIcon />
      </Provider>
    );

    expect(readStoredMsgDraft).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-draft-indicator="true"]')).not.toBeNull();
    expect(container.querySelector('#draft-desc')?.textContent).toBe('Draft');

    // Toggling showIcon (hover/focus) re-renders RoomDraftMark without re-reading localStorage.
    rerender(
      <Provider store={store}>
        <RoomDraftMark room={room} descriptionId="draft-desc" showIcon={false} />
      </Provider>
    );
    expect(readStoredMsgDraft).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-draft-indicator="true"]')).toBeNull();
    expect(container.querySelector('#draft-desc')?.textContent).toBe('Draft');

    rerender(
      <Provider store={store}>
        <RoomDraftMark room={room} descriptionId="draft-desc" showIcon />
      </Provider>
    );
    expect(readStoredMsgDraft).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-draft-indicator="true"]')).not.toBeNull();
  });

  it('skips readStoredMsgDraft when inMemoryDraft is set and resumes if it clears to undefined', () => {
    const room = makeRoom('!dm-in-memory:example.org');
    const draftKey = getRoomInputDraftKey(ME, room.roomId);
    touchedKeys.add(draftKey);
    window.localStorage.setItem(getMsgDraftStorageKey(draftKey), JSON.stringify(DRAFT_NODES));

    const store = createStore();
    const writtenAtom = roomIdToWrittenMsgDraftAtomFamily(draftKey);
    store.set(writtenAtom, DRAFT_NODES as never);

    const { container } = render(
      <Provider store={store}>
        <RoomDraftMark room={room} descriptionId="draft-desc" showIcon />
      </Provider>
    );

    expect(readStoredMsgDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-draft-indicator="true"]')).not.toBeNull();

    act(() => {
      store.set(writtenAtom, []);
    });
    expect(readStoredMsgDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-draft-indicator="true"]')).toBeNull();

    act(() => {
      store.set(writtenAtom, undefined);
    });
    expect(readStoredMsgDraft).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-draft-indicator="true"]')).not.toBeNull();
  });

  it('re-reads stored drafts on matching window storage events and ignores unrelated keys', () => {
    const room = makeRoom('!dm-storage:example.org');
    const draftKey = getRoomInputDraftKey(ME, room.roomId);
    const storageKey = getMsgDraftStorageKey(draftKey);
    touchedKeys.add(draftKey);

    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <RoomDraftMark room={room} descriptionId="draft-desc" showIcon />
      </Provider>
    );

    expect(readStoredMsgDraft).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-draft-indicator="true"]')).toBeNull();

    window.localStorage.setItem(storageKey, JSON.stringify(DRAFT_NODES));

    // Unrelated storage key does not trigger a storage read or re-render.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated_storage_key' }));
    });
    expect(readStoredMsgDraft).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-draft-indicator="true"]')).toBeNull();

    // Matching storage key re-reads storage and shows the draft pencil.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
    });
    expect(readStoredMsgDraft).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-draft-indicator="true"]')).not.toBeNull();

    // Full storage clear (key === null) also re-reads and clears the draft pencil.
    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(readStoredMsgDraft).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[data-draft-indicator="true"]')).toBeNull();
  });
});

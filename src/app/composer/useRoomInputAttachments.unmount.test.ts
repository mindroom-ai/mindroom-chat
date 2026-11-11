import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { createEditor } from 'slate';
import { describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import {
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from './roomInputDrafts';
import { type TUploadItem, UploadStatus } from '../matrix/state/upload';
import { useRoomInputAttachments } from './useRoomInputAttachments';

// The paste marker module brings the composer's menus and indicators along.
vi.mock('./commands/CommandAutocomplete', () => ({
  AgentCommandAutocomplete: () => null,
}));
vi.mock('../ui/PendingSendIndicator', () => ({ PendingSendIndicator: () => null }));
vi.mock('../messages/ThreadIndicator', () => ({ ThreadIndicator: () => null }));
vi.mock('./voice/VoiceRecorderDialog', () => ({ VoiceRecorderComposer: () => null }));
vi.mock('folds', () => ({ config: { space: {} }, Icons: {}, toRem: String }));
vi.mock('./upload/UploadCardRenderer', () => ({ UploadCardRenderer: () => null }));
vi.mock('./upload/UploadBoard', () => ({
  UploadBoard: () => null,
  UploadBoardContent: () => null,
  UploadBoardHeader: () => null,
}));

const ROOM_ID = '!attachments:example.org';

const stagedFile = (name: string): TUploadItem => {
  const file = new File(['content'], name, { type: 'text/plain' });
  return { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
};

/** A store that counts the live subscriptions of each atom. */
const countingStore = () => {
  const store = createStore();
  const live = new Map<unknown, number>();
  const { sub } = store;
  store.sub = (atom, listener) => {
    live.set(atom, (live.get(atom) ?? 0) + 1);
    const unsubscribe = sub(atom, listener);
    return () => {
      live.set(atom, (live.get(atom) ?? 1) - 1);
      unsubscribe();
    };
  };
  return { store, subscriptions: (atom: unknown) => live.get(atom) ?? 0 };
};

const mountComposer = (staged: TUploadItem[] = []) => {
  const { store, subscriptions } = countingStore();
  if (staged.length > 0) {
    store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), { type: 'PUT', item: staged });
  }
  const room = { roomId: ROOM_ID, hasEncryptionStateEvent: () => false } as unknown as Room;
  let feature!: ReturnType<typeof useRoomInputAttachments>;
  function Harness() {
    feature = useRoomInputAttachments({
      mx: { cancelUpload: vi.fn() } as never,
      userId: '@tester:example.org',
      room,
      roomId: ROOM_ID,
      editor: createEditor(),
      isMarkdown: true,
      fileDropContainerRef: createRef<HTMLElement>(),
      createUploadItems: async () => [],
    });
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Harness)));
  });
  return { store, subscriptions, renderer, access: () => feature.access };
};

describe('upload progress watches of the composer', () => {
  it('follow a staged file while the composer is open and end when it unmounts', () => {
    const { store, subscriptions, renderer, access } = mountComposer();
    const item = stagedFile('notes.txt');
    const upload = roomUploadAtomFamily(item.file);
    act(() => access().append(ROOM_ID, [item]));
    expect(subscriptions(upload)).toBe(1);

    act(() => renderer.unmount());

    expect(subscriptions(upload)).toBe(0);
    // The staged file stays for the next composer; only the watch went away.
    expect(store.get(upload).status).toBe(UploadStatus.Idle);
  });

  it('follow a file staged before the composer mounted, such as a restored draft', () => {
    const item = stagedFile('restored.txt');
    const { subscriptions, renderer } = mountComposer([item]);
    const upload = roomUploadAtomFamily(item.file);
    expect(subscriptions(upload)).toBe(1);

    act(() => renderer.unmount());

    expect(subscriptions(upload)).toBe(0);
  });
});

describe('a file another composer took over', () => {
  it('leaves the board of the composer that went, its upload going on and unwatched', () => {
    const item = stagedFile('child.txt');
    const kept = stagedFile('kept.txt');
    const { store, subscriptions, renderer, access } = mountComposer([item, kept]);
    const loading = {
      status: UploadStatus.Loading,
      promise: new Promise<never>(() => undefined),
      progress: { loaded: 0, total: 7 },
    };
    act(() => store.set(roomUploadAtomFamily(item.file), loading as never));
    const board = access();
    act(() => renderer.unmount());

    act(() => board.release(ROOM_ID, [item.file]));
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((staged) => staged.file)).toEqual([
      kept.file,
    ]);
    expect(store.get(roomUploadAtomFamily(item.file)).status).toBe(UploadStatus.Loading);
    // A composer that went watches nothing again.
    expect(subscriptions(roomUploadAtomFamily(kept.file))).toBe(0);
  });
});

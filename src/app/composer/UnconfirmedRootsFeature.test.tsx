import React from 'react';
import { EventEmitter } from 'events';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createEditor, type Descendant } from 'slate';
import { EventStatus, RoomEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import {
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  roomIdToMsgDraftAtomFamily,
  type PendingVoiceSendDraft,
} from './roomInputDrafts';
import { useRoomInputDraft } from './useRoomInputDraft';
import { UnconfirmedRootsFeature } from './UnconfirmedRootsFeature';

const ROOM = '!roots:example.org';
const USER = '@me:example.org';
const LOCAL_ROOT = `~${ROOM}:txn-1`;
const draft = (text: string) => [{ type: 'paragraph', children: [{ text }] }] as Descendant[];
const draftAtom = (threadId?: string) =>
  roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(USER, ROOM, threadId));

function ShownDraft({ threadId }: { threadId: string }) {
  useRoomInputDraft(
    React.useMemo(() => createEditor(), []),
    USER,
    ROOM,
    threadId
  );
  return null;
}

describe('UnconfirmedRootsFeature', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;
  let mx: EventEmitter & { getSafeUserId: () => string };
  let stored: Map<string, string>;

  const forgetAtoms = () => {
    roomIdToMsgDraftAtomFamily.setShouldRemove(() => true);
    roomIdToMsgDraftAtomFamily.setShouldRemove(null);
  };

  const mount = (shownThreadId?: string) => {
    act(() => {
      renderer = create(
        <Provider store={store}>
          <MatrixClientProvider value={mx as unknown as MatrixClient}>
            <UnconfirmedRootsFeature />
            {shownThreadId && <ShownDraft threadId={shownThreadId} />}
          </MatrixClientProvider>
        </Provider>
      );
    });
  };

  const echo = (id: string, status: EventStatus | null) =>
    act(() => {
      mx.emit(
        RoomEvent.LocalEchoUpdated,
        { getId: () => id, status },
        { roomId: ROOM },
        LOCAL_ROOT
      );
    });

  beforeEach(() => {
    store = createStore();
    mx = Object.assign(new EventEmitter(), { getSafeUserId: () => USER });
    stored = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      key: (index: number) => [...stored.keys()][index] ?? null,
      get length() {
        return stored.size;
      },
    });
    forgetAtoms();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it('moves the draft of a closed thread to its root once the root is confirmed', () => {
    store.set(draftAtom(LOCAL_ROOT), draft('written while the root was sending'));
    mount();

    echo('$root', EventStatus.SENT);

    // After a reload the thread's composer, which knows the root by its own ID, finds the draft.
    forgetAtoms();
    expect(store.get(draftAtom('$root'))).toEqual(draft('written while the root was sending'));
    expect(store.get(draftAtom(LOCAL_ROOT))).toEqual([]);
  });

  it('leaves the draft to a composer that shows the thread', () => {
    store.set(draftAtom(LOCAL_ROOT), draft('on screen'));
    mount(LOCAL_ROOT);

    echo('$root', EventStatus.SENT);

    expect(store.get(draftAtom(LOCAL_ROOT))).toEqual(draft('on screen'));
    expect(store.get(draftAtom('$root'))).toEqual([]);
  });

  it("offers a recording on the room's page once its thread root is deleted unsent", () => {
    const recording = {
      file: new File(['voice'], 'voice.ogg'),
      duration: 1000,
      context: {
        ownerSessionId: USER,
        roomId: ROOM,
        room: { roomId: ROOM },
        threadId: LOCAL_ROOT,
        replyDraft: { userId: USER, eventId: LOCAL_ROOT, body: 'root' },
        threadingEnabled: true,
        signalBridgedRoom: false,
        threadView: true,
      },
      errorMessage: 'The thread has not been sent yet.',
    } as unknown as PendingVoiceSendDraft;
    store.set(pendingVoiceSendDraftAtom, recording);
    mount();

    echo(LOCAL_ROOT, EventStatus.CANCELLED);

    expect(store.get(pendingVoiceSendDraftAtom)).toEqual({
      ...recording,
      context: {
        ...recording.context,
        threadId: undefined,
        replyDraft: undefined,
        threadView: undefined,
      },
    });
  });
});

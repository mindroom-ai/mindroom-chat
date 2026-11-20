import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createEditor, Editor, Node, Transforms, type Descendant } from 'slate';
import { withHistory } from 'slate-history';
import { createClient, EventStatus, MatrixEvent, PendingEventOrdering, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomInputDraft } from './useRoomInputDraft';
import { type HeldSend, useUnconfirmedRootSends } from './useUnconfirmedRootSends';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from './roomInputDrafts';

const ROOM = '!pending-root:example.org';
const USER = '@writer:example.org';
const LOCAL_ID = `~${ROOM}:txn-root`;

const paragraph = (text: string): Descendant[] => [{ type: 'paragraph', children: [{ text }] }];

const makeRoom = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER });
  const room = new Room(ROOM, mx, USER, {
    pendingEventOrdering: PendingEventOrdering.Chronological,
  });
  const root = new MatrixEvent({
    event_id: LOCAL_ID,
    room_id: ROOM,
    sender: USER,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Can we ship on Thursday?' },
  });
  root.setStatus(EventStatus.SENDING);
  room.addPendingEvent(root, 'txn-root');
  return { room, root };
};

type Exposed = ReturnType<typeof useUnconfirmedRootSends>;

describe('useUnconfirmedRootSends', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;
  let exposed: Exposed | undefined;
  const confirmed: HeldSend[][] = [];
  const onConfirmedRef = { current: (sends: HeldSend[]) => void confirmed.push(sends) };

  const Harness = ({
    room,
    editor,
    threadId,
  }: {
    room: Room;
    editor: Editor;
    threadId?: string;
  }) => {
    exposed = useUnconfirmedRootSends({
      room,
      roomId: ROOM,
      threadId,
      userId: USER,
      onConfirmedRef,
    });
    const saveDraft = useRoomInputDraft(editor, USER, ROOM, threadId);
    editor.onChange = saveDraft;
    return null;
  };

  const render = async (room: Room, editor: Editor, threadId?: string) => {
    const element = React.createElement(
      Provider,
      { store },
      React.createElement(Harness, { room, editor, threadId })
    );
    await act(async () => {
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
  };

  const type = (editor: Editor, text: string) => {
    Transforms.insertText(editor, text, { at: Editor.end(editor, []) });
    editor.onChange();
  };

  const draftOf = (threadId?: string) =>
    store.get(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(USER, ROOM, threadId)));

  beforeEach(() => {
    renderer = undefined;
    exposed = undefined;
    confirmed.length = 0;
    store = createStore();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    roomIdToMsgDraftAtomFamily.setShouldRemove(() => true);
    roomIdToMsgDraftAtomFamily.setShouldRemove(null);
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it('keeps the text typed while the root waits when the root gets its own ID', async () => {
    const { room, root } = makeRoom();
    const editor = withHistory(createEditor());
    editor.children = paragraph('');
    await render(room, editor);
    await render(room, editor, LOCAL_ID);
    type(editor, 'Only if the migration note is reviewed.');

    room.updatePendingEvent(root, EventStatus.SENT, '$root');
    await render(room, editor, '$root');

    expect(Node.string(editor)).toBe('Only if the migration note is reviewed.');
    expect(draftOf('$root')).toEqual(paragraph('Only if the migration note is reviewed.'));
    expect(draftOf(LOCAL_ID)).toEqual([]);
  });

  it('holds a send until the root has its own ID, then sends it once', async () => {
    const { room, root } = makeRoom();
    const editor = withHistory(createEditor());
    editor.children = paragraph('');
    await render(room, editor, LOCAL_ID);

    let held = false;
    await act(async () => {
      held = exposed!.hold({ kind: 'message' });
      exposed!.hold({ kind: 'message' });
      exposed!.hold({ kind: 'sticker', mxc: 'mxc://example.org/wave', label: 'Wave' });
    });
    expect(held).toBe(true);
    expect(exposed!.waiting).toBe(true);

    // The server answered, but the route still has the local ID: nothing goes out yet.
    await act(async () => room.updatePendingEvent(root, EventStatus.SENT, '$root'));
    await render(room, editor, LOCAL_ID);
    expect(confirmed).toEqual([]);

    await render(room, editor, '$root');
    expect(confirmed).toEqual([
      [{ kind: 'message' }, { kind: 'sticker', mxc: 'mxc://example.org/wave', label: 'Wave' }],
    ]);
    expect(exposed!.waiting).toBe(false);
    expect(exposed!.hold({ kind: 'message' })).toBe(false);
  });

  it('drops the wait when the root fails, and holds nothing for a failed root', async () => {
    const { room, root } = makeRoom();
    const editor = withHistory(createEditor());
    editor.children = paragraph('');
    await render(room, editor, LOCAL_ID);
    await act(async () => void exposed!.hold({ kind: 'message' }));

    await act(async () => room.updatePendingEvent(root, EventStatus.NOT_SENT));
    await render(room, editor, LOCAL_ID);

    expect(exposed!.waiting).toBe(false);
    await act(async () => expect(exposed!.hold({ kind: 'message' })).toBe(true));
    expect(exposed!.waiting).toBe(false);
    expect(confirmed).toEqual([]);
  });

  it('drops the wait when the composer moves to another thread', async () => {
    const { room } = makeRoom();
    const editor = withHistory(createEditor());
    editor.children = paragraph('');
    await render(room, editor, LOCAL_ID);
    await act(async () => void exposed!.hold({ kind: 'message' }));

    await render(room, editor, '$another-thread');

    expect(exposed!.waiting).toBe(false);
    expect(confirmed).toEqual([]);
  });

  it('moves the draft to the room composer, after its own text, when the root is deleted unsent', async () => {
    const { room, root } = makeRoom();
    store.set(
      roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(USER, ROOM)),
      paragraph('Room text.')
    );
    const editor = withHistory(createEditor());
    editor.children = paragraph('');
    await render(room, editor, LOCAL_ID);
    type(editor, 'Reply text.');

    await act(async () => room.updatePendingEvent(root, EventStatus.NOT_SENT));
    await act(async () => room.updatePendingEvent(root, EventStatus.CANCELLED));
    await render(room, editor, undefined);

    expect(Node.string(editor)).toBe('Room text.Reply text.');
    expect(draftOf(undefined)).toEqual([...paragraph('Room text.'), ...paragraph('Reply text.')]);
    expect(draftOf(LOCAL_ID)).toEqual([]);
  });
});

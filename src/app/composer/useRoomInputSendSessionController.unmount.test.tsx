import React, { createRef, useEffect, useMemo, useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createEditor, type Editor } from 'slate';
import { describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import {
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from './roomInputDrafts';
import type { TUploadItem } from '../matrix/state/upload';
import type { UploadResponse } from '../matrix/matrix';
import { ConversationViewContext, composerStateKey } from '../navigation/conversationView';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputSendSessionController } from './useRoomInputSendSessionController';

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

// A send started in a composer goes out even when that composer unmounts before its upload is
// done: the room page's composer as the person opens Settings, a thread view's as its panel closes.
const ME = '@tester:example.org';
const ROOM_ID = '!outlives:example.org';
const THREAD_ID = '$thread:example.org';
const VIEW = 'thread-view';

const stagedFile = (name: string): TUploadItem => {
  const file = new File(['content'], name, { type: 'text/plain' });
  return { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
};

const deferredUpload = () => {
  let resolve!: (value: UploadResponse) => void;
  const promise = new Promise<UploadResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createClient = () => {
  let sent = 0;
  return {
    cancelUpload: vi.fn(),
    getUserId: () => ME,
    makeTxnId: vi.fn(() => `txn-${sent}`),
    sendMessage: vi.fn(async (_roomId: string, _content: unknown) => {
      sent += 1;
      return { event_id: `$sent-${sent}` };
    }),
  };
};

type Client = ReturnType<typeof createClient>;
type Composer = {
  editor: Editor;
  attachments: ReturnType<typeof useRoomInputAttachments>['access'];
  sessions: ReturnType<typeof useRoomInputSendSessionController>;
};

const room = {
  roomId: ROOM_ID,
  getEventForTxnId: () => undefined,
  getLiveTimeline: () => undefined,
  getMembers: () => [],
  hasEncryptionStateEvent: () => false,
} as unknown as Room;

function ComposerHarness({
  mx,
  threadId,
  onRoomMessageSent,
  expose,
}: {
  mx: Client;
  threadId?: string;
  onRoomMessageSent?: (eventId: string) => boolean | void;
  expose: (composer: Composer) => void;
}) {
  const editor = useMemo(() => {
    const created = createEditor();
    created.children = [{ type: 'paragraph', children: [{ text: 'caption' }] }];
    return created;
  }, []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const attachments = useRoomInputAttachments({
    mx: mx as never,
    userId: ME,
    room,
    roomId: ROOM_ID,
    editor,
    isMarkdown: true,
    fileDropContainerRef: createRef<HTMLElement>(),
    createUploadItems: async () => [],
  });
  const sessions = useRoomInputSendSessionController({
    mx: mx as never,
    room,
    roomId: ROOM_ID,
    threadId,
    clearReplyDraft: () => undefined,
    editor,
    sendTypingStatus: () => undefined,
    attachments: attachments.access,
    mountedRef,
    buildUploadMessageContent: async (item, mxc) => ({
      msgtype: 'm.file',
      body: item.file.name,
      url: mxc,
    }),
    onRoomMessageSent,
  });
  expose({ editor, attachments: attachments.access, sessions });
  return null;
}

const mount = (
  store: ReturnType<typeof createStore>,
  mx: Client,
  options: { view?: string; threadId?: string; onRoomMessageSent?: () => void } = {}
) => {
  let composer!: Composer;
  let renderer!: ReactTestRenderer;
  const harness = (
    <ComposerHarness
      mx={mx}
      threadId={options.threadId}
      onRoomMessageSent={options.onRoomMessageSent}
      expose={(exposed) => {
        composer = exposed;
      }}
    />
  );
  act(() => {
    renderer = create(
      <Provider store={store}>
        {options.view === undefined ? (
          harness
        ) : (
          <ConversationViewContext.Provider value={options.view}>
            {harness}
          </ConversationViewContext.Provider>
        )}
      </Provider>
    );
  });
  return { composer: () => composer, renderer };
};

/** Stages `item` in the composer with its upload under way. */
const stageUploading = (
  store: ReturnType<typeof createStore>,
  composer: Composer,
  item: TUploadItem
) => {
  const upload = deferredUpload();
  act(() => composer.attachments.append(ROOM_ID, [item]));
  store.set(roomUploadAtomFamily(item.file), { promise: upload.promise });
  return upload;
};

const finishUpload = async (upload: ReturnType<typeof deferredUpload>, mxc: string) => {
  await act(async () => {
    upload.resolve({ content_uri: mxc });
    await Promise.resolve();
  });
  // The session wakes a microtask after the upload settles, then sends in turn.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

/** The keys the staged-files family holds lists for, read without creating any. */
const stagedListKeys = () => {
  const keys: string[] = [];
  roomIdToUploadItemsAtomFamily.setShouldRemove((_createdAt, key) => {
    keys.push(key);
    return false;
  });
  roomIdToUploadItemsAtomFamily.setShouldRemove(null);
  return keys;
};

const bodies = (mx: Client) =>
  mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body);

describe('a send that outlives its composer', () => {
  it('sends the file and caption of the room page after its composer unmounts', async () => {
    const store = createStore();
    const mx = createClient();
    const opened = vi.fn();
    const page = mount(store, mx, { onRoomMessageSent: opened });
    const item = stagedFile('large.bin');
    const upload = stageUploading(store, page.composer(), item);

    await act(async () => {
      await page.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption' },
      });
    });
    expect(mx.sendMessage).not.toHaveBeenCalled();
    act(() => page.renderer.unmount());
    await finishUpload(upload, 'mxc://example.org/large');

    expect(bodies(mx)).toEqual(['large.bin', 'caption']);
    // The file left the room's staged files as it went; it opened no thread off screen.
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
  });

  it("queues the next message of the room page's composer behind the send its last mount left", async () => {
    const store = createStore();
    const mx = createClient();
    const first = mount(store, mx);
    const item = stagedFile('large.bin');
    const upload = stageUploading(store, first.composer(), item);
    await act(async () => {
      await first.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption' },
      });
    });
    act(() => first.renderer.unmount());

    // Back on the room's page: the file still uploads, and the person sends another message.
    const again = mount(store, mx);
    expect(again.composer().sessions.hasActiveSendSession()).toBe(true);
    expect(again.composer().attachments.snapshot(ROOM_ID).enrolled).toEqual([item]);
    await act(async () => {
      await again.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'next' },
      });
    });
    expect(mx.sendMessage).not.toHaveBeenCalled();
    await finishUpload(upload, 'mxc://example.org/large');

    // In order, and the file once.
    expect(bodies(mx)).toEqual(['large.bin', 'caption', 'next']);
    act(() => again.renderer.unmount());
  });

  it('sends the claimed file of a closed thread view, and drops and cancels the ones no send claimed', async () => {
    const store = createStore();
    const mx = createClient();
    const view = mount(store, mx, { view: VIEW, threadId: THREAD_ID });
    const claimed = stagedFile('claimed.bin');
    const claimedUpload = stageUploading(store, view.composer(), claimed);
    await act(async () => {
      await view.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption' },
      });
    });
    // Staged after the send, so no send claimed it.
    const unclaimed = stagedFile('unclaimed.bin');
    const unclaimedUpload = stageUploading(store, view.composer(), unclaimed);

    act(() => view.renderer.unmount());

    expect(mx.cancelUpload.mock.calls).toEqual([[unclaimedUpload.promise]]);
    // Nothing of the closed view is left staged; the send holds the file it claimed.
    expect(stagedListKeys()).not.toContain(composerStateKey(ROOM_ID, VIEW));
    await finishUpload(claimedUpload, 'mxc://example.org/claimed');

    expect(bodies(mx)).toEqual(['claimed.bin', 'caption']);
    expect(mx.sendMessage.mock.calls.map((call) => call[1]['m.relates_to'])).toEqual([
      expect.objectContaining({ rel_type: 'm.thread', event_id: THREAD_ID }),
      expect.objectContaining({ rel_type: 'm.thread', event_id: THREAD_ID }),
    ]);
    expect(stagedListKeys()).not.toContain(composerStateKey(ROOM_ID, VIEW));
  });
});

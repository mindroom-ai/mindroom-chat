// @vitest-environment jsdom
import { createRef, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Provider, createStore, useStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createEditor, type Editor } from 'slate';
import { describe, expect, it, vi } from 'vitest';
import type { Room, UploadResponse } from 'matrix-js-sdk';
import { toMatrixUploadError } from '../matrix/matrix';
import {
  hasUploadList,
  readKeptFileNames,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from './roomInputDrafts';
import { type TUploadItem, UploadStatus } from '../matrix/state/upload';
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<UploadResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

/** Drops the view's staged files and cancels their uploads in its passive unmount, as `ThreadView`. */
function ClosingView({ mx, view, children }: { mx: Client; view: string; children: ReactNode }) {
  const store = useStore();
  useEffect(
    () => () => {
      const key = composerStateKey(ROOM_ID, view);
      store.get(roomIdToUploadItemsAtomFamily(key)).forEach(({ file }) => {
        const upload = store.get(roomUploadAtomFamily(file));
        if (upload.status === UploadStatus.Loading) mx.cancelUpload(upload.promise);
      });
      roomIdToUploadItemsAtomFamily.remove(key);
    },
    [mx, store, view]
  );
  return <>{children}</>;
}

const mount = (
  store: ReturnType<typeof createStore>,
  mx: Client,
  options: {
    view?: string;
    threadId?: string;
    onRoomMessageSent?: () => void;
    /** Wraps the composer in a parent that drops the view's staged files, as `ThreadView` does. */
    closingView?: boolean;
  } = {}
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
            {options.closingView ? (
              <ClosingView mx={mx} view={options.view}>
                {harness}
              </ClosingView>
            ) : (
              harness
            )}
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

const finishUpload = async (upload: ReturnType<typeof deferredUpload>, mxc?: string) => {
  await act(async () => {
    if (mxc) upload.resolve({ content_uri: mxc });
    else upload.reject(new Error('upload failed'));
    await Promise.resolve();
  });
  // The session wakes a microtask after the upload settles, then sends in turn.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

const bodies = (mx: Client) =>
  mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body);

describe('a send that outlives its composer', () => {
  it('sends the file and caption of the room page after its composer unmounts', async () => {
    const store = createStore();
    const { sub } = store;
    let watches = 0;
    store.sub = (atom, listener) => {
      watches += 1;
      const unsubscribe = sub(atom, listener);
      return () => {
        watches -= 1;
        unsubscribe();
      };
    };
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
    // Staged after the send: it stays for the next message.
    const later = stagedFile('later.bin');
    act(() => page.composer().attachments.append(ROOM_ID, [later]));
    act(() => page.renderer.unmount());
    // A reload now would name only the file left on the board as lost.
    expect(readKeptFileNames(ME, ROOM_ID)).toEqual(['later.bin']);
    await finishUpload(upload, 'mxc://example.org/large');

    expect(bodies(mx)).toEqual(['large.bin', 'caption']);
    // The file left the room's staged files as it went; it opened no thread off screen.
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([later]);
    expect(opened).not.toHaveBeenCalled();
    // Nothing watches its uploads any more.
    expect(watches).toBe(0);
  });

  it("leaves a send under way off the board of the room page's composer that mounts next, which sends on its own", async () => {
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

    // Back on the room's page: the file still uploads, off the board, and the next message goes.
    const again = mount(store, mx);
    expect(again.composer().attachments.snapshot(ROOM_ID).staged).toEqual([]);
    expect(again.composer().sessions.hasActiveSendSession()).toBe(false);
    await act(async () => {
      await again.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'next' },
      });
    });
    expect(bodies(mx)).toEqual(['next']);
    await finishUpload(upload, 'mxc://example.org/large');

    // The file once, with its caption.
    expect(bodies(mx)).toEqual(['next', 'large.bin', 'caption']);
    act(() => again.renderer.unmount());
  });

  it('sends a file the send holds but never staged, such as a voice message, after its composer unmounts', async () => {
    const store = createStore();
    const mx = createClient();
    const first = mount(store, mx);
    const companion = stagedFile('companion.bin');
    act(() => first.composer().attachments.append(ROOM_ID, [companion]));
    const voice = stagedFile('voice.ogg');
    const ready = (item: TUploadItem) => ({
      file: item.file,
      status: UploadStatus.Success as const,
      mxc: `mxc://example.org/${item.file.name}`,
    });
    let answerFirst!: () => void;
    mx.sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = () => resolve({ event_id: '$companion' });
        })
    );
    let sent!: Promise<void>;
    await act(async () => {
      sent = first.composer().sessions.startSendSession({
        batch: { fileItems: [companion, voice], uploads: [ready(companion), ready(voice)] },
        completeWithinCall: true,
      });
      await Promise.resolve();
    });
    expect(bodies(mx)).toEqual(['companion.bin']);

    // The page is left and opened again while the first file's event is still on its way.
    act(() => first.renderer.unmount());
    const again = mount(store, mx);
    await act(async () => {
      answerFirst();
      await sent;
    });

    expect(bodies(mx)).toEqual(['companion.bin', 'voice.ogg']);
    act(() => again.renderer.unmount());
  });

  it('fails the call of a voice message that cannot finish once its composer is gone', async () => {
    const store = createStore();
    const mx = createClient();
    const first = mount(store, mx);
    const companion = stagedFile('companion.bin');
    act(() => first.composer().attachments.append(ROOM_ID, [companion]));
    const voice = stagedFile('voice.ogg');
    let answerFirst!: () => void;
    mx.sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = () => resolve({ event_id: '$companion' });
        })
    );
    let sent!: Promise<void>;
    await act(async () => {
      sent = first.composer().sessions.startSendSession({
        batch: {
          fileItems: [companion, voice],
          uploads: [
            { file: companion.file, status: UploadStatus.Success, mxc: 'mxc://example.org/c' },
            {
              file: voice.file,
              status: UploadStatus.Error,
              error: toMatrixUploadError(new Error('voice upload failed'), 'upload'),
            },
          ],
        },
        completeWithinCall: true,
      });
      sent.catch(() => undefined);
      await Promise.resolve();
    });
    act(() => first.renderer.unmount());
    await act(async () => {
      answerFirst();
      await sent.catch(() => undefined);
    });

    // The recording is not taken as sent: the voice flow keeps it for another try.
    await expect(sent).rejects.toThrow('did not finish within the initiating call');
  });

  it("sends the files of a thread view's send as the view closes, and drops and cancels the others", async () => {
    const store = createStore();
    const mx = createClient();
    const view = mount(store, mx, { view: VIEW, threadId: THREAD_ID, closingView: true });
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
    await finishUpload(claimedUpload, 'mxc://example.org/claimed');

    expect(bodies(mx)).toEqual(['claimed.bin', 'caption']);
    expect(
      mx.sendMessage.mock.calls.map((call) => (call[1] as Record<string, unknown>)['m.relates_to'])
    ).toEqual([
      expect.objectContaining({ rel_type: 'm.thread', event_id: THREAD_ID }),
      expect.objectContaining({ rel_type: 'm.thread', event_id: THREAD_ID }),
    ]);
  });

  it("keeps a thread view's other files staged while only its composer goes", async () => {
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
    const unclaimed = stagedFile('unclaimed.bin');
    stageUploading(store, view.composer(), unclaimed);

    // The account may no longer post: the composer goes, the view stays.
    act(() => view.renderer.unmount());
    expect(mx.cancelUpload).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(composerStateKey(ROOM_ID, VIEW)))).toEqual([
      unclaimed,
    ]);
    await finishUpload(claimedUpload, 'mxc://example.org/claimed');
    expect(bodies(mx)).toEqual(['claimed.bin', 'caption']);
  });

  it('does not send a message queued before the composer went with files staged after', async () => {
    const store = createStore();
    const mx = createClient();
    const first = mount(store, mx);
    const item = stagedFile('large.bin');
    const upload = stageUploading(store, first.composer(), item);
    await act(async () => {
      await first.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption' },
      });
      await first.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'queued' },
      });
    });
    act(() => first.renderer.unmount());
    // The next composer stages a file of its own.
    const again = mount(store, mx);
    const later = stagedFile('later.bin');
    act(() => again.composer().attachments.append(ROOM_ID, [later]));
    await finishUpload(upload, 'mxc://example.org/large');

    expect(bodies(mx)).toEqual(['large.bin', 'caption', 'queued']);
    expect(again.composer().attachments.snapshot(ROOM_ID).staged).toEqual([later]);
    act(() => again.renderer.unmount());
  });

  describe.each([
    ['room page', undefined, undefined],
    ['thread view', VIEW, THREAD_ID],
  ])('in the %s', (_name, viewKey, threadId) => {
    it.each(['before', 'after'])(
      'ends a send that can only go on after a retry, its file failing to send %s its composer unmounts, and puts the file back',
      async (when) => {
        const store = createStore();
        const mx = createClient();
        const first = mount(store, mx, { view: viewKey, threadId });
        const failing = stagedFile('failing.bin');
        const upload = stageUploading(store, first.composer(), failing);
        await act(async () => {
          await first.composer().sessions.startSendSession({
            textContent: { msgtype: 'm.text', body: 'caption' },
          });
        });
        const { sessions } = first.composer();
        mx.sendMessage.mockRejectedValueOnce(new Error('send failed'));
        if (when === 'before') await finishUpload(upload, 'mxc://example.org/failing');
        act(() => first.renderer.unmount());
        if (when === 'after') await finishUpload(upload, 'mxc://example.org/failing');
        await act(async () => {
          await Promise.resolve();
        });

        // The caption does not wait for the file, which goes back on the board for another try.
        expect(bodies(mx)).toEqual(['failing.bin', 'caption']);
        expect(sessions.hasActiveSendSession()).toBe(false);
        expect(
          store.get(roomIdToUploadItemsAtomFamily(composerStateKey(ROOM_ID, viewKey)))
        ).toEqual([failing]);

        const again = mount(store, mx, { view: viewKey, threadId });
        await act(async () => {
          await again.composer().sessions.startSendSession({
            textContent: { msgtype: 'm.text', body: 'next' },
          });
        });
        expect(bodies(mx)).toEqual(['failing.bin', 'caption', 'failing.bin', 'next']);
        act(() => again.renderer.unmount());
      }
    );
  });

  it('drops the unsent files of a closed thread view whose send can only go on after a retry', async () => {
    const store = createStore();
    const mx = createClient();
    const view = mount(store, mx, { view: VIEW, threadId: THREAD_ID, closingView: true });
    const failing = stagedFile('failing.bin');
    const upload = stageUploading(store, view.composer(), failing);
    await act(async () => {
      await view.composer().sessions.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption' },
      });
    });
    act(() => view.renderer.unmount());
    await finishUpload(upload);

    expect(bodies(mx)).toEqual(['caption']);
    expect(hasUploadList(composerStateKey(ROOM_ID, VIEW))).toBe(false);
  });
});

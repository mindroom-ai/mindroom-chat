import React, { MutableRefObject, useEffect, useMemo, useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { EventStatus, MatrixError } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { IReplyDraft, roomUploadAtomFamily } from './roomInputDrafts';
import { TUploadItem, Upload, UploadStatus } from '../matrix/state/upload';
import { TUploadContent, toMatrixUploadError } from '../matrix/matrix';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import { createPasteMarker } from '../matrix/protocol/pasteAttachmentMarker';
import { parseLongTextJsonSidecar } from '../matrix/protocol/longText';
import {
  StartRoomInputSendSessionOptions,
  useRoomInputSendSessionController,
} from './useRoomInputSendSessionController';

const mocks = vi.hoisted(() => ({
  resetEditor: vi.fn(),
  resetEditorHistory: vi.fn(),
  restoreEditorContent: vi.fn(),
}));

vi.mock('../editor/utils', () => ({
  resetEditor: mocks.resetEditor,
  resetEditorHistory: mocks.resetEditorHistory,
  restoreEditorContent: mocks.restoreEditorContent,
}));

type HarnessApi = {
  selectedFilesRef: MutableRefObject<TUploadItem[]>;
  sendSessionFilesRef: MutableRefObject<TUploadContent[]>;
  sendSessionUploadItemsRef: MutableRefObject<TUploadItem[]>;
  uploadsRef: MutableRefObject<Upload[]>;
  mountedRef: MutableRefObject<boolean>;
  hasActiveSendSession: () => boolean;
  joinedSendPending: boolean;
  startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
  processSendSession: () => Promise<void>;
};

const createFile = (name: string) => new File(['content'], name, { type: 'text/plain' });

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const createUploadItem = (file: File, prepError?: MatrixError): TUploadItem => ({
  file,
  // A plain staged file: not encrypted, not a voice message, not a text paste.
  encInfo: undefined, originalFile: file,
  metadata: {
    markedAsSpoiler: false,
  },
  ...(prepError ? { prepError } : {}),
});

const createPasteUploadItem = (file: File, prepError?: MatrixError): TUploadItem => ({
  file,
  // A plain staged file that also carries the marker of a pasted text.
  encInfo: undefined, originalFile: file,
  metadata: {
    markedAsSpoiler: false,
    mindroomPasteAttachment: {
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
    },
  },
  ...(prepError ? { prepError } : {}),
});

const successUpload = (file: File, mxc = `mxc://mindroom/${file.name}`): Upload => ({
  file,
  status: UploadStatus.Success,
  mxc,
});

const loadingUpload = (file: File): Upload => ({
  file,
  status: UploadStatus.Loading,
  promise: Promise.resolve({ content_uri: `mxc://mindroom/${file.name}` }),
  progress: {
    loaded: 0,
    total: file.size,
  },
});

const prepErrorUpload = (file: File): Upload => ({
  file,
  status: UploadStatus.Error,
  error: toMatrixUploadError(new Error(`failed to prepare ${file.name}`), 'create'),
});

const TestHarness = ({
  onReady,
  onRoomMessageSent,
  mx,
  editor,
  sendTypingStatus,
  replyDraft,
  clearReplyDraft,
  restoreComposerFallbackForRoom,
  threadId,
}: {
  onReady: (api: HarnessApi) => void;
  onRoomMessageSent?: (eventId: string) => boolean | void;
  mx: {
    cancelPendingEvent: ReturnType<typeof vi.fn>;
    getEventForTxnId: ReturnType<typeof vi.fn>;
    makeTxnId: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    uploadContent: ReturnType<typeof vi.fn>;
  };
  editor: { children: unknown[] };
  sendTypingStatus: ReturnType<typeof vi.fn>;
  replyDraft?: IReplyDraft;
  clearReplyDraft: ReturnType<typeof vi.fn>;
  restoreComposerFallbackForRoom: ReturnType<typeof vi.fn>;
  threadId?: string;
}) => {
  const selectedFilesRef = useRef<TUploadItem[]>([]);
  const sendSessionFilesRef = useRef<TUploadContent[]>([]);
  const sendSessionUploadItemsRef = useRef<TUploadItem[]>([]);
  const uploadsRef = useRef<Upload[]>([]);
  const mountedRef = useRef(true);

  const attachments = useMemo<RoomInputAttachmentAccess>(
    () => ({
      snapshot: () => ({
        staged: selectedFilesRef.current,
        enrolled: sendSessionUploadItemsRef.current,
        uploads: uploadsRef.current,
      }),
      append: (_roomId, items) => {
        selectedFilesRef.current = [...selectedFilesRef.current, ...items];
      },
      enroll: (items) => {
        sendSessionUploadItemsRef.current = items;
        sendSessionFilesRef.current = items.map((item) => item.file);
      },
      clearEnrollment: () => {
        sendSessionUploadItemsRef.current = [];
        sendSessionFilesRef.current = [];
      },
      protectPasteItems: () => () => {},
      subscribe: () => () => {},
      remove: (_roomId, uploadList) => {
        selectedFilesRef.current = selectedFilesRef.current.filter(
          (item) => !uploadList.includes(item.file)
        );
        sendSessionFilesRef.current = sendSessionFilesRef.current.filter(
          (file) => !uploadList.includes(file)
        );
        sendSessionUploadItemsRef.current = sendSessionUploadItemsRef.current.filter(
          (item) => !uploadList.includes(item.file)
        );
        uploadsRef.current = uploadsRef.current.filter((item) => !uploadList.includes(item.file));
      },
    }),
    []
  );

  const controller = useRoomInputSendSessionController({
    mx: mx as never,
    room: {
      roomId: '!room:example.org',
      getEventForTxnId: mx.getEventForTxnId,
      getLiveTimeline: () => undefined,
      getMembers: () => [],
      hasEncryptionStateEvent: () => false,
    } as never,
    roomId: '!room:example.org',
    threadId,
    replyDraft,
    clearReplyDraft,
    editor: editor as never,
    sendTypingStatus,
    attachments,
    mountedRef,
    buildUploadMessageContent: async (fileItem, mxc) => ({
      msgtype: 'm.file',
      body: fileItem.file.name,
      url: mxc,
    }),
    restoreComposerFallbackForRoom,
    onRoomMessageSent,
  });

  useEffect(() => {
    onReady({
      selectedFilesRef,
      sendSessionFilesRef,
      sendSessionUploadItemsRef,
      uploadsRef,
      mountedRef,
      ...controller,
    });
  }, [controller, onReady]);

  return null;
};

const renderHarness = (
  options: {
    threadId?: string;
    onRoomMessageSent?: (eventId: string) => boolean | void;
    replyDraft?: Parameters<typeof TestHarness>[0]['replyDraft'];
  } = {}
) => {
  let sentEvents = 0;
  let transactionIds = 0;
  const localEvents = new Map<string, { getId: () => string; status?: EventStatus }>();
  const mx = {
    cancelPendingEvent: vi.fn(),
    getEventForTxnId: vi.fn((txnId: string) => localEvents.get(txnId)),
    makeTxnId: vi.fn(() => `txn-${transactionIds++}`),
    sendMessage: vi.fn(async (targetRoomId: string, _content: unknown, txnId?: string) => {
      if (txnId) {
        localEvents.set(txnId, {
          getId: () => `~${targetRoomId}:${txnId}`,
        });
      }
      const eventId = `$event-${sentEvents}`;
      sentEvents += 1;
      return { event_id: eventId };
    }),
    uploadContent: vi.fn(async (_file: Blob) => ({ content_uri: 'mxc://mindroom/sidecar' })),
  };
  const editor = {
    children: [{ type: 'paragraph', children: [{ text: 'caption draft' }] }],
  };
  const sendTypingStatus = vi.fn();
  const clearReplyDraft = vi.fn();
  const restoreComposerFallbackForRoom = vi.fn();
  let api!: HarnessApi;
  let renderer!: ReturnType<typeof create>;
  const props = {
    mx,
    editor,
    sendTypingStatus,
    replyDraft: options.replyDraft,
    clearReplyDraft,
    restoreComposerFallbackForRoom,
    onRoomMessageSent: options.onRoomMessageSent,
    onReady: (nextApi: HarnessApi) => {
      api = nextApi;
    },
  };

  act(() => {
    renderer = create(
      React.createElement(TestHarness, {
        ...props,
        threadId: options.threadId,
      })
    );
  });

  return {
    api,
    mx,
    editor,
    localEvents,
    sendTypingStatus,
    clearReplyDraft,
    restoreComposerFallbackForRoom,
    changeThread: (threadId?: string) => {
      act(() => renderer.update(React.createElement(TestHarness, { ...props, threadId })));
    },
    /** The controller as the composer rendered it last. */
    current: () => api,
    /** Unmounts the composer, as closing a thread's column or leaving the room does. */
    unmount: () => {
      api.mountedRef.current = false;
      act(() => renderer.unmount());
    },
    /** Mounts the same composer again, with refs of its own. */
    mountAgain: () => {
      let next!: HarnessApi;
      act(() => {
        renderer = create(
          React.createElement(TestHarness, {
            ...props,
            threadId: options.threadId,
            onReady: (nextApi: HarnessApi) => {
              next = nextApi;
              api = nextApi;
            },
          })
        );
      });
      return { api: next, current: () => api };
    },
  };
};

describe('useRoomInputSendSessionController after its composer unmounts', () => {
  it('sends the message once its upload finishes after the composer went', async () => {
    const onRoomMessageSent = vi.fn();
    const { api, mx, unmount, current } = renderHarness({ onRoomMessageSent });
    const file = createFile('slow.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [loadingUpload(file)];
    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'caption' } });
    });
    expect(mx.sendMessage).not.toHaveBeenCalled();
    // Its own send shows on its board, not as another composer's.
    expect(current().joinedSendPending).toBe(false);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mx.sendMessage).not.toHaveBeenCalled();
    api.uploadsRef.current = [successUpload(file)];
    await act(async () => {
      getDefaultStore().set(roomUploadAtomFamily(file), { mxc: 'mxc://mindroom/slow.txt' });
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(mx.sendMessage).toHaveBeenCalledTimes(2));
    expect(mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)).toEqual([
      'slow.txt',
      'caption',
    ]);
    expect(api.hasActiveSendSession()).toBe(false);
    // The composer that went opens no thread for the root it sent.
    expect(onRoomMessageSent).not.toHaveBeenCalled();
  });

  it('lets a composer mounted again join the send instead of sending its files twice', async () => {
    const { api, mx, unmount, mountAgain, changeThread } = renderHarness();
    const file = createFile('shared.txt');
    const item = createUploadItem(file);
    const fileSend = createDeferred<{ event_id: string }>();
    mx.sendMessage.mockReturnValueOnce(fileSend.promise);
    api.selectedFilesRef.current = [item];
    api.uploadsRef.current = [successUpload(file)];
    act(() => {
      void api.startSendSession({ textContent: { msgtype: 'm.text', body: 'caption' } });
    });
    await vi.waitFor(() => expect(mx.sendMessage).toHaveBeenCalledTimes(1));

    unmount();
    // The room's page keeps its staged files: the composer mounted again still lists this one.
    const { api: again, current } = mountAgain();
    expect(again.joinedSendPending).toBe(true);
    again.selectedFilesRef.current = [item];
    again.uploadsRef.current = [successUpload(file)];
    await act(async () => {
      await again.startSendSession();
    });
    expect(mx.sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      fileSend.resolve({ event_id: '$file' });
      await fileSend.promise;
    });
    await vi.waitFor(() => expect(again.hasActiveSendSession()).toBe(false));
    expect(current().joinedSendPending).toBe(false);
    expect(mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)).toEqual([
      'shared.txt',
      'caption',
    ]);

    // Its own next send is its own, not the one it took over.
    const next = createFile('next.txt');
    again.selectedFilesRef.current = [createUploadItem(next)];
    again.uploadsRef.current = [loadingUpload(next)];
    await act(async () => {
      await again.startSendSession();
    });
    expect(again.hasActiveSendSession()).toBe(true);
    changeThread(undefined);
    expect(current().joinedSendPending).toBe(false);
  });

  it('ends a session left waiting for a retry once its composer went', async () => {
    const { api, mx, unmount, mountAgain } = renderHarness();
    const file = createFile('broken.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [prepErrorUpload(file)];
    await act(async () => {
      await api.startSendSession();
    });
    expect(api.hasActiveSendSession()).toBe(true);

    unmount();
    await vi.waitFor(() => expect(api.hasActiveSendSession()).toBe(false));
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the sends of two composers mounted at once apart', async () => {
    const { api, mx, mountAgain } = renderHarness();
    // A second view of the same thread, mounted beside the first, with files of its own.
    const other = mountAgain();
    const slow = createFile('slow.txt');
    api.selectedFilesRef.current = [createUploadItem(slow)];
    api.uploadsRef.current = [loadingUpload(slow)];
    await act(async () => {
      await api.startSendSession();
    });
    const own = createFile('own.txt');
    other.api.selectedFilesRef.current = [createUploadItem(own)];
    other.api.uploadsRef.current = [successUpload(own)];
    await act(async () => {
      await other.api.startSendSession();
    });
    expect(mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)).toEqual([
      'own.txt',
    ]);
    expect(other.current().joinedSendPending).toBe(false);
  });

  it('sends a file once when the composer moves to another thread before it goes', async () => {
    const { api, mx, changeThread } = renderHarness({ threadId: '$first' });
    const file = createFile('first.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [loadingUpload(file)];
    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'caption' } });
    });
    changeThread('$second');
    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'second' } });
    });
    api.uploadsRef.current = [successUpload(file)];
    await act(async () => {
      await api.processSendSession();
    });
    await vi.waitFor(() =>
      expect(mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)).toEqual(
        ['first.txt', 'caption', 'second']
      )
    );
  });

  it('lets the composer that took a send over cancel its file, and sends what follows', async () => {
    const { api, mx, unmount, mountAgain } = renderHarness();
    const file = createFile('cancelled.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [loadingUpload(file)];
    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'caption' } });
    });
    unmount();
    const again = mountAgain();
    // The file shows on its board again, claimed by the send it took over.
    expect(again.api.selectedFilesRef.current.map((item) => item.file)).toEqual([file]);
    expect(again.api.sendSessionFilesRef.current).toEqual([file]);

    // Cancelled there, as the card's cancel removes it.
    again.api.selectedFilesRef.current = [];
    again.api.sendSessionUploadItemsRef.current = [];
    again.api.uploadsRef.current = [];
    await act(async () => {
      await again.api.processSendSession();
    });
    await act(async () => {
      await again.api.startSendSession({ textContent: { msgtype: 'm.text', body: 'next' } });
    });
    await vi.waitFor(() =>
      expect(mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)).toEqual(
        ['caption', 'next']
      )
    );
  });
});

describe('useRoomInputSendSessionController active session query', () => {
  it('tracks waiting, failed, retried, and completed sessions', async () => {
    const { api, mx } = renderHarness();
    const root = createFile('root.txt');
    const child = createFile('child.txt');

    expect(api.hasActiveSendSession()).toBe(false);

    api.selectedFilesRef.current = [createUploadItem(root), createUploadItem(child)];
    api.uploadsRef.current = [loadingUpload(root), successUpload(child)];

    await act(async () => {
      await api.startSendSession();
    });

    expect(api.hasActiveSendSession()).toBe(true);
    expect(mx.sendMessage).not.toHaveBeenCalled();

    api.uploadsRef.current = [successUpload(root), successUpload(child)];
    mx.sendMessage.mockRejectedValueOnce(new Error('root send failed'));

    await act(async () => {
      await api.processSendSession();
    });

    expect(api.hasActiveSendSession()).toBe(true);

    await act(async () => {
      await api.startSendSession();
    });

    expect(api.hasActiveSendSession()).toBe(false);
    expect(mx.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('drops the unsent echo of a failed upload that stays staged for another try', async () => {
    const { api, localEvents, mx } = renderHarness();
    const file = createFile('file.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [successUpload(file)];
    mx.sendMessage.mockImplementationOnce(
      async (targetRoomId: string, _content: unknown, txnId: string) => {
        localEvents.set(txnId, {
          getId: () => `~${targetRoomId}:${txnId}`,
          status: EventStatus.NOT_SENT,
        });
        throw new Error('upload send failed');
      }
    );

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(localEvents.get('txn-0'));
    expect(api.selectedFilesRef.current.map((item) => item.file)).toEqual([file]);

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.hasActiveSendSession()).toBe(false);
  });

  it.each([
    ['root', false, ['root.txt']],
    ['child', true, ['root.txt', 'voice.m4a']],
  ] as const)(
    'uses explicit items and surfaces the original lifecycle-complete %s error',
    async (_failedMember, rootSucceeds, expectedBodies) => {
      const { api, mx } = renderHarness();
      const root = createFile('root.txt');
      const voice = createFile('voice.m4a');
      const sendFailure = new Error('send failed');
      const fileItems = [createUploadItem(root), createUploadItem(voice)];
      if (rootSucceeds) {
        mx.sendMessage.mockResolvedValueOnce({ event_id: '$root' });
      }
      mx.sendMessage.mockRejectedValueOnce(sendFailure);

      let failure: unknown;
      await act(async () => {
        try {
          await api.startSendSession({
            batch: { fileItems, uploads: [successUpload(root), successUpload(voice)] },
            completeWithinCall: true,
          });
        } catch (error) {
          failure = error;
        }
      });

      expect(failure).toBe(sendFailure);
      expect(mx.sendMessage).toHaveBeenCalledTimes(expectedBodies.length);
      expect(mx.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)).toEqual([
        ...expectedBodies,
      ]);
      expect(api.hasActiveSendSession()).toBe(false);
      expect(api.sendSessionFilesRef.current).toEqual([]);
      expect(api.sendSessionUploadItemsRef.current).toEqual([]);
    }
  );

  it('clears a consumed reply through the captured room context', async () => {
    const replyDraft: IReplyDraft = {
      userId: '@alice:example.org',
      eventId: '$reply',
      body: 'Original reply',
    };
    const { api, clearReplyDraft } = renderHarness({ replyDraft });
    const file = createFile('reply.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [successUpload(file)];

    await act(async () => {
      await api.startSendSession();
    });

    expect(clearReplyDraft).toHaveBeenCalledWith({
      roomId: '!room:example.org',
      replyDraft,
    });
  });
});

describe('useRoomInputSendSessionController prep-error uploads', () => {
  beforeEach(() => {
    mocks.resetEditor.mockReset();
    mocks.resetEditorHistory.mockReset();
  });

  it('does not deadlock later sends after a single prep-error attachment', async () => {
    const { api, mx } = renderHarness();
    const failed = createFile('failed.txt');
    const later = createFile('later.txt');

    api.selectedFilesRef.current = [createUploadItem(failed, prepErrorUpload(failed).error)];
    api.uploadsRef.current = [prepErrorUpload(failed)];

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).not.toHaveBeenCalled();

    api.selectedFilesRef.current = [createUploadItem(later)];
    api.uploadsRef.current = [successUpload(later)];

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    expect(mx.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'later.txt',
      url: 'mxc://mindroom/later.txt',
    });
  });

  it('sends text without waiting on a prep-error attachment', async () => {
    const { api, mx } = renderHarness();
    const failed = createFile('failed.txt');

    api.selectedFilesRef.current = [createUploadItem(failed, prepErrorUpload(failed).error)];
    api.uploadsRef.current = [prepErrorUpload(failed)];

    await act(async () => {
      await api.startSendSession({
        textContent: {
          msgtype: 'm.text',
          body: 'text survives prep failure',
        },
      });
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    expect(mx.sendMessage.mock.calls[0][1]).toMatchObject({
      msgtype: 'm.text',
      body: 'text survives prep failure',
    });
    expect(api.sendSessionFilesRef.current).toEqual([]);
  });

  it('blocks text containing a failed paste marker until the failed paste upload is removed', async () => {
    const { api, mx } = renderHarness();
    const failed = createFile('mindroom-paste-a3f19c.txt');
    const marker = createPasteMarker({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
    });

    api.selectedFilesRef.current = [createPasteUploadItem(failed, prepErrorUpload(failed).error)];
    api.uploadsRef.current = [prepErrorUpload(failed)];

    await act(async () => {
      await api.startSendSession({
        textContent: {
          msgtype: 'm.text',
          body: `${marker}\n\ntext after paste`,
        },
      });
    });

    expect(mx.sendMessage).not.toHaveBeenCalled();

    api.selectedFilesRef.current = [];
    api.uploadsRef.current = [];

    await act(async () => {
      await api.startSendSession({
        textContent: {
          msgtype: 'm.text',
          body: `${marker}\n\ntext after paste`,
        },
      });
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    expect(mx.sendMessage.mock.calls[0][1]).toMatchObject({
      body: `${marker}\n\ntext after paste`,
    });
  });

  it('promotes the first prepared file to auto-thread root when the first attachment has a prep error', async () => {
    const { api, mx } = renderHarness();
    const failed = createFile('failed.txt');
    const root = createFile('root.txt');
    const child = createFile('child.txt');

    api.selectedFilesRef.current = [
      createUploadItem(failed, prepErrorUpload(failed).error),
      createUploadItem(root),
      createUploadItem(child),
    ];
    api.uploadsRef.current = [
      prepErrorUpload(failed),
      successUpload(root, 'mxc://mindroom/root'),
      successUpload(child, 'mxc://mindroom/child'),
    ];

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    expect(mx.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'root.txt',
      url: 'mxc://mindroom/root',
    });
    expect(mx.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(mx.sendMessage.mock.calls[1][1]).toMatchObject({
      body: 'child.txt',
      url: 'mxc://mindroom/child',
      'm.relates_to': {
        event_id: '$event-0',
        rel_type: 'm.thread',
        is_falling_back: true,
      },
    });
  });

  it('notifies the auto-thread upload root once and skips child uploads', async () => {
    const notificationSnapshots: Array<{ selectedFiles: string[]; uploadFiles: string[] }> = [];
    const onRoomMessageSent = vi.fn();
    const apiRef: { current?: HarnessApi } = {};
    const { api } = renderHarness({
      onRoomMessageSent: (eventId) => {
        onRoomMessageSent(eventId);
        notificationSnapshots.push({
          selectedFiles:
            apiRef.current?.selectedFilesRef.current.map((item) => item.file.name) ?? [],
          uploadFiles: apiRef.current?.uploadsRef.current.map((upload) => upload.file.name) ?? [],
        });
      },
    });
    apiRef.current = api;
    const root = createFile('root.txt');
    const child = createFile('child.txt');

    api.selectedFilesRef.current = [createUploadItem(root), createUploadItem(child)];
    api.uploadsRef.current = [
      successUpload(root, 'mxc://mindroom/root'),
      successUpload(child, 'mxc://mindroom/child'),
    ];

    await act(async () => {
      await api.startSendSession();
    });

    expect(onRoomMessageSent).toHaveBeenCalledTimes(1);
    expect(onRoomMessageSent).toHaveBeenCalledWith('$event-0');
    expect(notificationSnapshots).toEqual([
      {
        selectedFiles: ['child.txt'],
        uploadFiles: ['child.txt'],
      },
    ]);
  });
});

describe('useRoomInputSendSessionController caption send failures', () => {
  it('keeps caption recovery scoped to its composer when retry destination differs', async () => {
    const { api, mx, restoreComposerFallbackForRoom } = renderHarness({ threadId: '$composer' });
    const attachment = createFile('retry.txt');
    const failure = new Error('Offline retry');
    mx.sendMessage.mockRejectedValueOnce(failure);
    api.mountedRef.current = false;
    const composerFallback = [{ type: 'paragraph', children: [{ text: 'New caption' }] }] as never;
    await act(async () => {
      await expect(
        api.startSendSession({
          textContent: { msgtype: 'm.text', body: 'New caption' },
          batch: {
            fileItems: [createUploadItem(attachment)],
            uploads: [successUpload(attachment)],
          },
          context: {
            roomId: '!room:example.org',
            room: { getEventForTxnId: () => undefined } as never,
            threadId: '$retry',
            replyDraft: undefined,
            threadingEnabled: true,
            signalBridgedRoom: false,
          },
          completeWithinCall: true,
          composerFallback,
          composerAlreadyReset: true,
        })
      ).rejects.toBe(failure);
    });
    expect(restoreComposerFallbackForRoom).toHaveBeenCalledWith(
      '!room:example.org',
      composerFallback,
      '$composer'
    );
  });

  it('returns a failed caption to its original thread after composer navigation', async () => {
    const { api, mx, restoreComposerFallbackForRoom, changeThread } = renderHarness({
      threadId: '$original',
    });
    const send = createDeferred<{ event_id: string }>();
    mx.sendMessage.mockReturnValueOnce(send.promise);
    const attachment = createFile('attachment.txt');
    const composerFallback = [
      { type: 'paragraph', children: [{ text: 'Original caption' }] },
    ] as never;
    let sending!: Promise<void>;
    act(() => {
      sending = api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'Original caption' },
        batch: { fileItems: [createUploadItem(attachment)], uploads: [successUpload(attachment)] },
        completeWithinCall: true,
        composerFallback,
        composerAlreadyReset: true,
      });
    });
    changeThread('$other');
    const failure = new Error('Offline');
    await act(async () => {
      send.reject(failure);
      await expect(sending).rejects.toBe(failure);
    });
    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(restoreComposerFallbackForRoom).toHaveBeenCalledWith(
      '!room:example.org',
      composerFallback,
      '$original'
    );
  });

  beforeEach(() => {
    mocks.resetEditor.mockReset();
    mocks.resetEditorHistory.mockReset();
    mocks.restoreEditorContent.mockReset();
  });

  it('restores the caption and clears the session when lifecycle-complete sending fails', async () => {
    const { api, mx, editor } = renderHarness();
    const image = createFile('image.png');
    const textFailure = new Error('caption send failed');

    api.selectedFilesRef.current = [createUploadItem(image)];
    api.uploadsRef.current = [successUpload(image)];

    mx.sendMessage.mockImplementationOnce(async () => ({ event_id: '$root' }));
    mx.sendMessage.mockRejectedValueOnce(textFailure);

    let failure: unknown;
    await act(async () => {
      try {
        await api.startSendSession({
          textContent: { msgtype: 'm.text', body: 'caption draft' },
          completeWithinCall: true,
        });
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBe(textFailure);
    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    expect(mx.sendMessage.mock.calls[0][1]).toMatchObject({
      url: 'mxc://mindroom/image.png',
    });
    expect(mocks.resetEditor).toHaveBeenCalledWith(editor);
    expect(mocks.restoreEditorContent).toHaveBeenCalledWith(editor, [
      { type: 'paragraph', children: [{ text: 'caption draft' }] },
    ]);

    // The failed caption must not piggyback onto a later unrelated send.
    const later = createFile('later.txt');
    api.selectedFilesRef.current = [createUploadItem(later)];
    api.uploadsRef.current = [successUpload(later)];

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(3);
    expect(mx.sendMessage.mock.calls[2][1]).toMatchObject({
      body: 'later.txt',
      url: 'mxc://mindroom/later.txt',
    });
  });

  it('restores an already-cleared caption when an earlier lifecycle upload fails', async () => {
    const { api, mx, editor } = renderHarness();
    const root = createFile('root.txt');
    const failed = createFile('failed.txt');
    const voice = createFile('voice.m4a');
    const sendFailure = new Error('companion send failed');
    const composerFallback = [
      { type: 'paragraph', children: [{ text: 'captured caption' }] },
    ] as never;
    const onUploadSent = vi.fn();

    mx.sendMessage.mockResolvedValueOnce({ event_id: '$root' });
    mx.sendMessage.mockRejectedValueOnce(sendFailure);

    let failure: unknown;
    await act(async () => {
      try {
        await api.startSendSession({
          textContent: { msgtype: 'm.text', body: 'captured caption' },
          batch: {
            fileItems: [createUploadItem(root), createUploadItem(failed), createUploadItem(voice)],
            uploads: [successUpload(root), successUpload(failed), successUpload(voice)],
          },
          completeWithinCall: true,
          composerFallback,
          composerAlreadyReset: true,
          onUploadSent,
        });
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBe(sendFailure);
    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    // By identity: on Node 22, Files with the same content and type are deeply equal whatever
    // their names, so `not.toHaveBeenCalledWith(voice)` failed for the call with root.
    expect(onUploadSent).toHaveBeenCalledTimes(1);
    expect(onUploadSent.mock.calls[0]?.[0]).toBe(root);
    expect(mocks.resetEditor).not.toHaveBeenCalledWith(editor);
    expect(mocks.restoreEditorContent).toHaveBeenCalledWith(editor, composerFallback);
    expect(api.hasActiveSendSession()).toBe(false);
  });

  it('restores a lifecycle caption through room draft storage after unmount', async () => {
    const { api, mx, restoreComposerFallbackForRoom } = renderHarness();
    const attachment = createFile('attachment.txt');
    const sendFailure = new Error('attachment send failed');
    const composerFallback = [
      { type: 'paragraph', children: [{ text: 'durable caption' }] },
    ] as never;
    api.mountedRef.current = false;
    mx.sendMessage.mockRejectedValueOnce(sendFailure);

    await act(async () => {
      await expect(
        api.startSendSession({
          textContent: { msgtype: 'm.text', body: 'durable caption' },
          batch: {
            fileItems: [createUploadItem(attachment)],
            uploads: [successUpload(attachment)],
          },
          completeWithinCall: true,
          composerFallback,
          composerAlreadyReset: true,
        })
      ).rejects.toBe(sendFailure);
    });

    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(restoreComposerFallbackForRoom).toHaveBeenCalledWith(
      '!room:example.org',
      composerFallback,
      undefined
    );
  });

  it('restores a failed text snapshot without erasing newer composer input', async () => {
    const { api, mx, editor, sendTypingStatus } = renderHarness();
    const send = createDeferred<{ event_id: string }>();
    mx.sendMessage.mockReturnValueOnce(send.promise);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption draft' },
      });
      await Promise.resolve();
    });

    expect(mocks.resetEditor).toHaveBeenCalledWith(editor);
    editor.children = [
      {
        type: 'paragraph',
        children: [{ text: 'newer composer input' }],
      },
    ];
    sendTypingStatus.mockClear();
    await act(async () => {
      send.reject(new Error('text send failed'));
      await sendPromise;
    });

    expect(mocks.restoreEditorContent).toHaveBeenCalledWith(editor, [
      { type: 'paragraph', children: [{ text: 'caption draft' }] },
    ]);
    expect(editor.children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'newer composer input' }],
      },
    ]);
    expect(sendTypingStatus).not.toHaveBeenCalled();

    // The failed text must not piggyback onto a later unrelated send.
    const later = createFile('later.txt');
    api.selectedFilesRef.current = [createUploadItem(later)];
    api.uploadsRef.current = [successUpload(later)];

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    expect(mx.sendMessage.mock.calls[1][1]).toMatchObject({
      body: 'later.txt',
      url: 'mxc://mindroom/later.txt',
    });
  });

  it('keeps upload retries resumable after a failed caption without resending the caption', async () => {
    const { api, mx } = renderHarness();
    const first = createFile('first.png');
    const second = createFile('second.png');

    api.selectedFilesRef.current = [createUploadItem(first), createUploadItem(second)];
    api.uploadsRef.current = [successUpload(first), successUpload(second)];

    mx.sendMessage.mockImplementationOnce(async () => ({ event_id: '$root' }));
    mx.sendMessage.mockImplementationOnce(async () => {
      throw new Error('upload send failed');
    });
    mx.sendMessage.mockImplementationOnce(async () => {
      throw new Error('caption send failed');
    });

    await act(async () => {
      await api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption draft' },
      });
    });

    // Root upload sent, the second upload send failed, then the caption failed and was
    // restored to the composer.
    expect(mx.sendMessage).toHaveBeenCalledTimes(3);
    expect(mocks.restoreEditorContent).toHaveBeenCalledTimes(1);

    // Send-again resumes the failed upload but must not resend the restored caption.
    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(4);
    expect(mx.sendMessage.mock.calls[3][1]).toMatchObject({
      body: 'second.png',
      url: 'mxc://mindroom/second.png',
      'm.relates_to': {
        event_id: '$root',
        rel_type: 'm.thread',
      },
    });
    const textSends = mx.sendMessage.mock.calls.filter(
      (call) => (call[1] as { msgtype?: string }).msgtype === 'm.text'
    );
    expect(textSends).toHaveLength(1);
  });
});

describe('useRoomInputSendSessionController long messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // About 50 KB: over the one-event budget, but short enough that the composer kept it inline.
  const longBody = 'word '.repeat(10_000).trim();

  it('sends a message too large for one event as a long-text sidecar', async () => {
    const { api, mx } = renderHarness({ threadId: '$thread' });
    const mentions = { user_ids: ['@mindroom_writer:example.org'] };

    await act(async () => {
      await api.startSendSession({
        textContent: { msgtype: 'm.text', body: longBody, 'm.mentions': mentions },
      });
    });

    // The whole message, relation included, is uploaded as the file MindRoom reads back.
    expect(mx.uploadContent).toHaveBeenCalledTimes(1);
    const uploaded = parseLongTextJsonSidecar(
      await (mx.uploadContent.mock.calls[0][0] as Blob).text()
    );
    expect(uploaded).toMatchObject({
      msgtype: 'm.text',
      body: longBody,
      'm.mentions': mentions,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
    });

    // The event is a preview that points at the file and keeps the routing.
    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    const sent = mx.sendMessage.mock.calls[0][1] as Record<string, unknown>;
    expect(sent).toMatchObject({
      msgtype: 'm.file',
      url: 'mxc://mindroom/sidecar',
      'm.mentions': mentions,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    });
    expect(sent.body).toMatch(/^word word /);
    expect(sent.body).toMatch(/\[Message continues in attached file\]$/);
    expect(new TextEncoder().encode(JSON.stringify(sent)).length).toBeLessThan(10_000);
    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();
  });

  it('sends a message that fits one event as it is', async () => {
    const { api, mx } = renderHarness();

    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'short' } });
    });

    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(mx.sendMessage.mock.calls[0][1]).toEqual({ msgtype: 'm.text', body: 'short' });
  });

  it('returns a long message to the composer when its file upload fails', async () => {
    const { api, mx, editor } = renderHarness();
    mx.uploadContent.mockRejectedValueOnce(new Error('offline'));
    const composed = structuredClone(editor.children);

    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: longBody } });
    });

    expect(mx.sendMessage).not.toHaveBeenCalled();
    expect(mocks.restoreEditorContent).toHaveBeenCalledWith(editor, composed);
    expect(api.hasActiveSendSession()).toBe(false);
  });
});

describe('useRoomInputSendSessionController optimistic room roots', () => {
  beforeEach(() => {
    mocks.resetEditor.mockReset();
    mocks.resetEditorHistory.mockReset();
    mocks.restoreEditorContent.mockReset();
  });

  it('opens the local root before acknowledgement and leaves a failed owned root in the timeline', async () => {
    const send = createDeferred<{ event_id: string }>();
    const onRoomMessageSent = vi.fn(() => true);
    const { api, editor, localEvents, mx } = renderHarness({ onRoomMessageSent });
    mx.sendMessage.mockImplementationOnce(
      (targetRoomId: string, _content: unknown, txnId?: string) => {
        if (!txnId) throw new Error('Expected a transaction id');
        localEvents.set(txnId, {
          getId: () => `~${targetRoomId}:${txnId}`,
        });
        return send.promise;
      }
    );

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'root message' },
      });
      await Promise.resolve();
    });

    expect(onRoomMessageSent).toHaveBeenCalledWith('~!room:example.org:txn-0');
    expect(mocks.resetEditor).toHaveBeenCalledWith(editor);
    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();

    await act(async () => {
      localEvents.get('txn-0')!.status = EventStatus.NOT_SENT;
      send.reject(new Error('root send failed'));
      await sendPromise;
    });

    // The unsent root stays in the timeline, where it can be retried or deleted.
    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(mx.cancelPendingEvent).not.toHaveBeenCalled();

    await act(async () => {
      await api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'later message' },
      });
    });

    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('falls back to the confirmed event when no exact local echo is available', async () => {
    const send = createDeferred<{ event_id: string }>();
    const onRoomMessageSent = vi.fn(() => true);
    const { api, mx } = renderHarness({ onRoomMessageSent });
    mx.sendMessage.mockReturnValueOnce(send.promise);

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'root message' },
      });
      await Promise.resolve();
    });

    expect(onRoomMessageSent).not.toHaveBeenCalled();

    await act(async () => {
      send.resolve({ event_id: '$confirmed-root' });
      await sendPromise;
    });

    expect(onRoomMessageSent).toHaveBeenCalledOnce();
    expect(onRoomMessageSent).toHaveBeenCalledWith('$confirmed-root');
  });

  it('leaves a failed root in the timeline when the view does not open its thread', async () => {
    const send = createDeferred<{ event_id: string }>();
    const onRoomMessageSent = vi.fn(() => false);
    const { api, localEvents, mx, restoreComposerFallbackForRoom } = renderHarness({
      onRoomMessageSent,
    });
    mx.sendMessage.mockImplementationOnce(
      (targetRoomId: string, _content: unknown, txnId?: string) => {
        if (!txnId) throw new Error('Expected a transaction id');
        localEvents.set(txnId, {
          getId: () => `~${targetRoomId}:${txnId}`,
        });
        return send.promise;
      }
    );

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'root message' },
      });
      await Promise.resolve();
      localEvents.get('txn-0')!.status = EventStatus.NOT_SENT;
      send.reject(new Error('root send failed'));
      await sendPromise;
    });

    expect(onRoomMessageSent).toHaveBeenCalledWith('~!room:example.org:txn-0');
    // The unsent message keeps its row, with Retry and Delete; the composer is left alone.
    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(restoreComposerFallbackForRoom).not.toHaveBeenCalled();
    expect(mx.cancelPendingEvent).not.toHaveBeenCalled();
    expect(api.hasActiveSendSession()).toBe(false);
  });
});

describe('useRoomInputSendSessionController sends that cannot go out yet', () => {
  beforeEach(() => {
    mocks.resetEditor.mockReset();
    mocks.resetEditorHistory.mockReset();
    mocks.restoreEditorContent.mockReset();
  });

  /** Sends that create their local echo and then wait for the server until settled by hand. */
  const holdSends = (
    mx: ReturnType<typeof renderHarness>['mx'],
    localEvents: ReturnType<typeof renderHarness>['localEvents']
  ) => {
    const held: ReturnType<typeof createDeferred<{ event_id: string }>>[] = [];
    mx.sendMessage.mockImplementation(
      (targetRoomId: string, _content: unknown, txnId?: string) => {
        if (!txnId) throw new Error('Expected a transaction id');
        localEvents.set(txnId, { getId: () => `~${targetRoomId}:${txnId}` });
        const send = createDeferred<{ event_id: string }>();
        held.push(send);
        return send.promise;
      }
    );
    return held;
  };

  const textBodies = (mx: ReturnType<typeof renderHarness>['mx']) =>
    mx.sendMessage.mock.calls
      .map((call) => call[1] as { msgtype?: string; body?: string })
      .filter((content) => content.msgtype === 'm.text')
      .map((content) => content.body);

  it('gives each text its own row at once while the one before it is still going out', async () => {
    const { api, mx, localEvents, restoreComposerFallbackForRoom } = renderHarness({
      threadId: '$thread',
    });
    const held = holdSends(mx, localEvents);

    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'first' } });
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'second' } });
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'third' } });
    });

    // The client's queue sends them in this order; none waits for the server's answer.
    expect(textBodies(mx)).toEqual(['first', 'second', 'third']);
    expect(mocks.resetEditor).toHaveBeenCalledTimes(3);
    expect(api.hasActiveSendSession()).toBe(false);

    // All three fail: each keeps its row, and nothing comes back into the composer.
    await act(async () => {
      for (const [index, send] of held.entries()) {
        localEvents.get(`txn-${index}`)!.status = EventStatus.NOT_SENT;
        send.reject(new Error('offline'));
      }
      await Promise.resolve();
    });
    expect(mocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(restoreComposerFallbackForRoom).not.toHaveBeenCalled();
    expect(mx.cancelPendingEvent).not.toHaveBeenCalled();
  });

  it('sends a text at once while an attachment waits for a retry of its failed upload', async () => {
    const { api, mx } = renderHarness({ threadId: '$thread' });
    const file = createFile('tide-table.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [prepErrorUpload(file)];

    // Send with only the failed file staged: it waits for its upload's Retry.
    await act(async () => {
      await api.startSendSession();
    });
    expect(api.hasActiveSendSession()).toBe(true);
    expect(mx.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'after the file' } });
    });
    expect(textBodies(mx)).toEqual(['after the file']);
    expect(mx.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
    });
    expect(mocks.resetEditor).toHaveBeenCalledTimes(1);

    // The retried upload resumes the waiting session, which sends the file once.
    api.uploadsRef.current = [successUpload(file)];
    await act(async () => {
      await api.processSendSession();
    });
    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    expect(mx.sendMessage.mock.calls[1][1]).toMatchObject({ body: 'tide-table.txt' });
    expect(api.hasActiveSendSession()).toBe(false);
  });

  it('sends the texts held behind an upload in progress, in order, once that upload fails', async () => {
    const { api, mx } = renderHarness({ threadId: '$thread' });
    const file = createFile('tide-table.txt');
    api.selectedFilesRef.current = [createUploadItem(file)];
    api.uploadsRef.current = [loadingUpload(file)];

    await act(async () => {
      await api.startSendSession();
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'one' } });
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'two' } });
    });
    // They follow the file, which is still uploading.
    expect(mx.sendMessage).not.toHaveBeenCalled();

    api.uploadsRef.current = [prepErrorUpload(file)];
    await act(async () => {
      await api.processSendSession();
    });
    expect(textBodies(mx)).toEqual(['one', 'two']);
    expect(api.hasActiveSendSession()).toBe(true);
  });
});

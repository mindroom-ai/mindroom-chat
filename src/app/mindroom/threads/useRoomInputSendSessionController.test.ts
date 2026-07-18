import React, { MutableRefObject, useEffect, useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { MatrixError } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TUploadItem } from '../../state/room/roomInputDrafts';
import { Upload, UploadStatus } from '../../state/upload';
import { TUploadContent, toMatrixUploadError } from '../../utils/matrix';
import { createMindroomPasteMarker } from '../messages/pasteAttachmentMarker';
import {
  StartRoomInputSendSessionOptions,
  useRoomInputSendSessionController,
} from './useRoomInputSendSessionController';

const mocks = vi.hoisted(() => ({
  resetEditor: vi.fn(),
  resetEditorHistory: vi.fn(),
  restoreEditorContent: vi.fn(),
}));

vi.mock('../../components/editor/utils', () => ({
  resetEditor: mocks.resetEditor,
  resetEditorHistory: mocks.resetEditorHistory,
  restoreEditorContent: mocks.restoreEditorContent,
}));

type HarnessApi = {
  selectedFilesRef: MutableRefObject<TUploadItem[]>;
  sendSessionFilesRef: MutableRefObject<TUploadContent[]>;
  sendSessionUploadItemsRef: MutableRefObject<TUploadItem[]>;
  uploadsRef: MutableRefObject<Upload[]>;
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
  originalFile: file,
  encInfo: undefined,
  metadata: {
    markedAsSpoiler: false,
  },
  ...(prepError ? { prepError } : {}),
});

const createPasteUploadItem = (file: File, prepError?: MatrixError): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
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
  room,
  threadId,
  sendTypingStatus,
}: {
  onReady: (api: HarnessApi) => void;
  onRoomMessageSent?: (eventId: string) => boolean;
  mx: {
    getRoom: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  editor: { children: unknown[] };
  room: {
    roomId: string;
  };
  threadId?: string;
  sendTypingStatus: ReturnType<typeof vi.fn>;
}) => {
  const selectedFilesRef = useRef<TUploadItem[]>([]);
  const sendSessionFilesRef = useRef<TUploadContent[]>([]);
  const sendSessionUploadItemsRef = useRef<TUploadItem[]>([]);
  const uploadsRef = useRef<Upload[]>([]);

  const controller = useRoomInputSendSessionController({
    mx: mx as never,
    room: room as never,
    roomId: '!room:example.org',
    threadId,
    replyDraft: undefined,
    setReplyDraft: vi.fn(),
    editor: editor as never,
    sendTypingStatus,
    selectedFilesRef,
    sendSessionFilesRef,
    sendSessionUploadItemsRef,
    uploadsRef,
    buildUploadMessageContent: async (fileItem, mxc) => ({
      msgtype: 'm.file',
      body: fileItem.file.name,
      url: mxc,
    }),
    removeUploadsFromBoard: (upload) => {
      const uploadList = Array.isArray(upload) ? upload : [upload];
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
    onRoomMessageSent,
  });

  useEffect(() => {
    onReady({
      selectedFilesRef,
      sendSessionFilesRef,
      sendSessionUploadItemsRef,
      uploadsRef,
      ...controller,
    });
  }, [controller, onReady]);

  return null;
};

const renderHarness = (
  options: {
    encryptedRoom?: boolean;
    isEncrypted?: () => boolean;
    onRoomMessageSent?: (eventId: string) => boolean;
    threadId?: string;
  } = {}
) => {
  let sentEvents = 0;
  const room = {
    roomId: '!room:example.org',
    getEventForTxnId: () => undefined,
    getLiveTimeline: () => ({
      getEvents: () => [],
    }),
    getThreads: () => [],
    getMembers: () => [],
    hasEncryptionStateEvent: () => options.isEncrypted?.() ?? options.encryptedRoom ?? false,
  };
  const mx = {
    getRoom: vi.fn(() => room),
    sendMessage: vi.fn(async () => {
      const eventId = `$event-${sentEvents}`;
      sentEvents += 1;
      return { event_id: eventId };
    }),
  };
  const editor = {
    children: [{ type: 'paragraph', children: [{ text: 'caption draft' }] }],
  };
  const sendTypingStatus = vi.fn();
  let api!: HarnessApi;

  act(() => {
    create(
      React.createElement(TestHarness, {
        mx,
        editor,
        room,
        threadId: options.threadId,
        sendTypingStatus,
        onRoomMessageSent: options.onRoomMessageSent,
        onReady: (nextApi) => {
          api = nextApi;
        },
      })
    );
  });

  return { api, mx, editor, sendTypingStatus };
};

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
    const marker = createMindroomPasteMarker({
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
        return true;
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

describe('useRoomInputSendSessionController encrypted local-target ownership', () => {
  beforeEach(() => {
    mocks.resetEditor.mockReset();
    mocks.resetEditorHistory.mockReset();
  });

  it.each([
    ['attachment-only', undefined],
    ['caption plus attachment', { msgtype: 'm.text', body: 'caption draft' }],
  ])(
    'keeps an encrypted %s send on the board while its thread root is local',
    async (_label, textContent) => {
      const { api, mx } = renderHarness({
        encryptedRoom: true,
        threadId: '~!room:example.org:pending-root',
      });
      const file = createFile('pending.txt');
      const item = createUploadItem(file);
      api.selectedFilesRef.current = [item];
      api.uploadsRef.current = [successUpload(file)];

      await act(async () => {
        await api.startSendSession({ textContent });
      });

      expect(mx.sendMessage).not.toHaveBeenCalled();
      expect(api.selectedFilesRef.current).toEqual([item]);
      expect(api.sendSessionFilesRef.current).toEqual([]);
      expect(mocks.resetEditor).not.toHaveBeenCalled();
    }
  );

  it('keeps a plaintext upload on the board when the room becomes encrypted', async () => {
    let encrypted = false;
    const { api, mx } = renderHarness({
      isEncrypted: () => encrypted,
    });
    const file = createFile('plaintext.txt');
    const item = createUploadItem(file);
    api.selectedFilesRef.current = [item];
    api.uploadsRef.current = [successUpload(file)];
    encrypted = true;

    await act(async () => {
      await api.startSendSession();
    });

    expect(mx.sendMessage).not.toHaveBeenCalled();
    expect(api.selectedFilesRef.current).toEqual([item]);
    expect(api.uploadsRef.current).toEqual([successUpload(file)]);
  });
});

describe('useRoomInputSendSessionController caption send failures', () => {
  beforeEach(() => {
    mocks.resetEditor.mockReset();
    mocks.resetEditorHistory.mockReset();
    mocks.restoreEditorContent.mockReset();
  });

  it('restores the caption to the composer and completes the session when the caption fails', async () => {
    const { api, mx, editor } = renderHarness();
    const image = createFile('image.png');

    api.selectedFilesRef.current = [createUploadItem(image)];
    api.uploadsRef.current = [successUpload(image)];

    mx.sendMessage.mockImplementationOnce(async () => ({ event_id: '$root' }));
    mx.sendMessage.mockImplementationOnce(async () => {
      throw new Error('caption send failed');
    });

    await act(async () => {
      await api.startSendSession({
        textContent: { msgtype: 'm.text', body: 'caption draft' },
      });
    });

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

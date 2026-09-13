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
}));

vi.mock('../../components/editor/utils', () => ({
  resetEditor: mocks.resetEditor,
  resetEditorHistory: mocks.resetEditorHistory,
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
  mx,
}: {
  onReady: (api: HarnessApi) => void;
  mx: {
    sendMessage: ReturnType<typeof vi.fn>;
  };
}) => {
  const selectedFilesRef = useRef<TUploadItem[]>([]);
  const sendSessionFilesRef = useRef<TUploadContent[]>([]);
  const sendSessionUploadItemsRef = useRef<TUploadItem[]>([]);
  const uploadsRef = useRef<Upload[]>([]);

  const controller = useRoomInputSendSessionController({
    mx: mx as never,
    room: {
      roomId: '!room:example.org',
      getLiveTimeline: () => undefined,
      getMembers: () => [],
    } as never,
    roomId: '!room:example.org',
    threadId: undefined,
    replyDraft: undefined,
    setReplyDraft: vi.fn(),
    editor: {} as never,
    sendTypingStatus: vi.fn(),
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

const renderHarness = () => {
  let sentEvents = 0;
  const mx = {
    sendMessage: vi.fn(async () => {
      const eventId = `$event-${sentEvents}`;
      sentEvents += 1;
      return { event_id: eventId };
    }),
  };
  let api!: HarnessApi;

  act(() => {
    create(
      React.createElement(TestHarness, {
        mx,
        onReady: (nextApi) => {
          api = nextApi;
        },
      })
    );
  });

  return { api, mx };
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
});

// @vitest-environment jsdom
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { act, create } from 'react-test-renderer';
import { createClient, Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { expect, it, vi } from 'vitest';
import { RoomView } from '../room/RoomView';
import { useRoomInputSendSessionController } from '../composer/useRoomInputSendSessionController';
import type { TUploadItem } from '../matrix/state/upload';
import { Upload, UploadStatus } from '../matrix/state/upload';
import type { RoomInputAttachmentAccess } from '../composer/roomInputAttachmentAccess';
import { useThreadApprovals } from '../approvals/ThreadApprovalProvider';

const approvalHistory = vi.hoisted(() => ({
  load: vi.fn(async (..._args: unknown[]) => ({ events: [], repairedEventIds: [] })),
}));
let approvalState: ReturnType<typeof useThreadApprovals>;

const jobsBar = vi.hoisted(() => ({
  canCancel: true,
  props: [] as { threadId: string | null; canCancel: boolean }[],
}));
const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
mx.store.storeRoom(room);
const editor = createEditor();
const ignored: string[] = [];
const scheduler = { abort: vi.fn() };
const noop = () => undefined;
let navigate: (id: string) => void;
let completeUpload: () => void;
let api: ReturnType<typeof useRoomInputSendSessionController>;
let mounts = 0;
const first = new File(['first'], 'first.png');
const second = new File(['second'], 'second.png');
const item = (file: File): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
  metadata: { markedAsSpoiler: false },
});
const ready = (file: File): Upload => ({
  file,
  status: UploadStatus.Success,
  mxc: `mxc://example.org/${file.name}`,
});

vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  Box: 'div',
  Text: 'span',
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useIgnoredUsers', () => ({ useIgnoredUsers: () => ignored }));
vi.mock('../event-store/engine', () => ({
  enqueueThreadApprovalBackfill: approvalHistory.load,
  useSyncEngine: () => ({ scheduler }),
}));
vi.mock('../event-store/timeline/roomLiveEventArrive', () => ({ useLiveEventArrive: () => undefined }));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../matrix/hooks/usePowerLevels', () => {
  // The thread column's view reads the room's levels itself, the same ones every render.
  const levels = {};
  return {
    usePowerLevelsContext: () => ({}),
    usePowerLevels: () => levels,
    PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => [] }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: (type: string) => type !== 'io.mindroom.background_job_cancel' || jobsBar.canCancel,
  }),
}));
vi.mock('../lib/hooks/useKeyDown', () => ({ useKeyDown: () => undefined }));
vi.mock('../preferences/useSetting', () => ({ useSetting: () => [false] }));
vi.mock('../editor/Editor', () => ({ useEditor: () => editor }));
vi.mock('../editor/utils', () => ({
  resetEditor: vi.fn(),
  resetEditorHistory: vi.fn(),
  restoreEditorContent: vi.fn(),
}));
vi.mock('../ui/page/Page', () => ({ Page: 'div' }));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({
  RoomViewFollowing: () => null,
  RoomViewFollowingPlaceholder: () => null,
}));
vi.mock('../room/RoomTombstone', () => ({ RoomTombstone: () => null }));
vi.mock('../room/RoomViewHeader', () => ({ RoomViewHeader: () => null }));
vi.mock('./ThreadContextBanner', () => ({ ThreadContextBanner: () => null }));
vi.mock('../timeline/RoomTimeline', () => ({ RoomTimeline: () => null }));
vi.mock('../approvals/ThreadApprovalControls', () => ({
  ThreadApprovalQueue: () => {
    approvalState = useThreadApprovals();
    return null;
  },
}));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({
  BackgroundJobsBar: (props: { threadId: string | null; canCancel: boolean }) => {
    jobsBar.props.push({ threadId: props.threadId, canCancel: props.canCancel });
    return null;
  },
}));
vi.mock('../room/useRoomViewThreadState', () => ({
  useRoomViewThreadState: ({ threadId }: { threadId?: string }) => ({
    effectiveThreadId: threadId,
    viewMode: 'compact',
    // As the room's handler, it says whether it opened the sent message's thread.
    handleRoomMessageSent: (id: string) => {
      if (threadId) return false;
      navigate(id);
      return true;
    },
  }),
}));
vi.mock('../composer/RoomInput', () => ({ RoomInput: React.forwardRef(Composer) }));

function Composer(
  {
    threadId,
    onRoomMessageSent,
  }: { threadId?: string; onRoomMessageSent?: (id: string) => boolean | void },
  _ref: React.ForwardedRef<HTMLDivElement>
) {
  const selectedFilesRef = useRef([item(first), item(second)]);
  const uploadsRef = useRef<Upload[]>([
    ready(first),
    {
      file: second,
      status: UploadStatus.Loading,
      promise: Promise.resolve({ content_uri: 'mxc://example.org/second.png' }),
      progress: { loaded: 0, total: second.size },
    },
  ]);
  const [version, setVersion] = useState(0);
  const enrolledRef = useRef<TUploadItem[]>([]);
  const listenersRef = useRef(new Set<() => void>());
  const attachments = useMemo<RoomInputAttachmentAccess>(
    () => ({
      snapshot: () => ({
        staged: [...selectedFilesRef.current],
        enrolled: [...enrolledRef.current],
        uploads: [...uploadsRef.current],
      }),
      append: (_roomId, items) => {
        selectedFilesRef.current = [...selectedFilesRef.current, ...items];
        setVersion((value) => value + 1);
      },
      remove: (_roomId, files) => {
        selectedFilesRef.current = selectedFilesRef.current.filter(
          (value) => !files.includes(value.file)
        );
        enrolledRef.current = enrolledRef.current.filter((value) => !files.includes(value.file));
        uploadsRef.current = uploadsRef.current.filter((value) => !files.includes(value.file));
        setVersion((value) => value + 1);
      },
      enroll: (items) => {
        enrolledRef.current = [...items];
        setVersion((value) => value + 1);
      },
      clearEnrollment: () => {
        enrolledRef.current = [];
        setVersion((value) => value + 1);
      },
      protectPasteItems: () => noop,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    []
  );
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) listenersRef.current.forEach((listener) => listener());
    });
    return () => {
      disposed = true;
    };
  }, [version]);
  const controller = useRoomInputSendSessionController({
    mx,
    room,
    roomId: room.roomId,
    threadId,
    editor,
    clearReplyDraft: noop,
    sendTypingStatus: noop,
    attachments,
    buildUploadMessageContent: async (fileItem, url) => ({
      msgtype: 'm.file',
      body: fileItem.file.name,
      url,
    }),
    onRoomMessageSent,
  });
  useEffect(() => {
    mounts += 1;
  }, []);
  useEffect(() => {
    api = controller;
    completeUpload = () => {
      uploadsRef.current = [ready(second)];
      setVersion((value) => value + 1);
    };
  }, [controller]);
  return null;
}

it('continues the pending second upload and caption when the first upload opens its thread', async () => {
  let sent = 0;
  const send = vi
    .spyOn(mx, 'sendMessage')
    .mockImplementation(async () => ({ event_id: `$sent-${++sent}` }));
  function Conversation() {
    const [threadId, setThreadId] = useState<string>();
    navigate = setThreadId;
    return <RoomView room={room} threadId={threadId} />;
  }
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(<Conversation />);
    });
    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'caption' } });
    });
    expect(send.mock.calls.map((call) => call[1].body)).toEqual(['first.png']);
    await act(async () => completeUpload());
    expect(send.mock.calls.map((call) => call[1].body)).toEqual([
      'first.png',
      'second.png',
      'caption',
    ]);
    // The room's composer goes as the thread fills the page; the thread's takes the send over.
    expect(mounts).toBe(2);
    expect(send.mock.calls[1][1]['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
      event_id: '$sent-1',
    });
    expect(send.mock.calls[2][1]['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
      event_id: '$sent-1',
    });
  } finally {
    act(() => renderer?.unmount());
    send.mockRestore();
  }
});

it('gives the jobs bar the open thread and whether the viewer may send a cancel', async () => {
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(<RoomView room={room} threadId="$thread" />);
    });
    expect(jobsBar.props.at(-1)).toEqual({ threadId: '$thread', canCancel: true });
    jobsBar.canCancel = false;
    await act(async () => {
      renderer.update(<RoomView room={room} />);
    });
    expect(jobsBar.props.at(-1)).toEqual({ threadId: null, canCancel: false });
  } finally {
    jobsBar.canCancel = true;
    act(() => renderer?.unmount());
  }
});

vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({
    noteRoomFocused: () => undefined,
    clearRoomFocus: () => undefined,
  }),
}));

it('loads approval history only after a local thread root gets its server ID', async () => {
  approvalHistory.load.mockClear();
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(<RoomView room={room} threadId="~!room:example.org:pending-root" />);
    });
    expect(approvalHistory.load).not.toHaveBeenCalled();
    expect(approvalState).toBeUndefined();
    await act(async () => {
      renderer.update(<RoomView room={room} threadId="$confirmed-root" />);
    });
    expect(approvalHistory.load).toHaveBeenCalledTimes(1);
    expect(approvalHistory.load.mock.calls[0]?.slice(2, 4)).toEqual([
      '!room:example.org',
      '$confirmed-root',
    ]);
    expect(approvalState?.loading).toBe(false);
    expect(approvalState?.error).toBeUndefined();
    expect(approvalState?.threadId).toBe('$confirmed-root');
  } finally {
    act(() => renderer?.unmount());
  }
});

// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { createEditor, Node, Transforms, type Descendant, type Editor } from 'slate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMentionElement, withInlineElements } from '../../editor/utils';
import { MID_TURN_MODE_KEY } from '../../matrix/protocol/midTurn';
import { threadModelContent } from '../../matrix/protocol/threadModel';
import { UploadStatus, type TUploadItem } from '../../matrix/state/upload';
import type { SlashCommand } from '../commands/useCommands';
import type { RoomInputAttachmentAccess } from '../roomInputAttachmentAccess';
import { useRoomInputSendSessionController, type StartRoomInputSendSessionOptions } from '../useRoomInputSendSessionController';
import { liveCaptureAtom } from '../capture/liveCapture';
import {
  detachedDictationErrorAtom,
  detachedDictationSendsAtom,
  forgetComposerStateOfSession,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
  roomUploadAtomFamily,
  type IReplyDraft,
} from '../roomInputDrafts';
import { createBrowserCaptureFactory } from './dictationAudioCapture';
import { DictationSendErrorNotice } from './DictationSendErrorNotice';
import {
  handoffComposerDictationSend,
  mergeDictatedDoc,
  startDetachedDictationSend,
  type StartDetachedDictationSendInput,
} from './dictationSendHandoff';
import type {
  DictationFinishResult,
  DictationSession,
  DictationSnapshot,
} from './dictationSession';
import { useRoomInputDictation, type RoomInputDictationFeature } from './useRoomInputDictation';

const mocks = vi.hoisted(() => ({
  sessionsList: [{ userId: '@alice:example.org' }] as Array<{ userId: string }>,
  dictationServer: {
    available: true,
    confirmed: true,
    apiUrl: 'https://mr.test',
    sessions: {
      baseUrl: 'https://mr.test',
      getToken: vi.fn(async () => 'tok'),
      invalidate: vi.fn(),
    },
  },
  deleteCapture: vi.fn(async (_id: string) => undefined),
  releaseCapture: vi.fn((_id: string) => undefined),
}));

vi.mock('../capture/captureJournal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../capture/captureJournal')>()),
  deleteCapture: (id: string) => mocks.deleteCapture(id),
  releaseCapture: (id: string) => mocks.releaseCapture(id),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(':')}` : key,
  }),
}));
vi.mock('../../matrix/session/sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/session/sessions')>()),
  listSessions: () => mocks.sessionsList,
}));
vi.mock('./useDictationServer', () => ({ useDictationServer: () => mocks.dictationServer }));
vi.mock('../../messages/content/voice/VoiceWaveform', () => ({
  VoiceWaveform: () => <div data-testid="waveform" />,
}));
vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({
  useLiquidGlass: () => ({ current: null }),
}));
vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const makeDoc = (text = ''): Descendant[] => [
  { type: 'paragraph', children: [{ text }] } as unknown as Descendant,
];
const readEditorText = (editor: Editor): string =>
  editor.children.map((n) => Node.string(n)).join('\n');
const makeRoom = (roomId = '!room:example.org', name = 'General'): Room =>
  ({ roomId, name, hasEncryptionStateEvent: () => false, getMembers: () => [] } as unknown as Room);

const makeMockSession = (
  initialPhase: DictationSnapshot['phase'] = 'recording',
  journalId?: string
) => {
  const listeners = new Set<() => void>();
  let snap: DictationSnapshot = {
    phase: initialPhase,
    elapsedMs: 1200,
    waveform: [],
    sampleCount: 0,
    pendingUploads: 0,
    failedSegments: 0,
    completedSegments: 0,
    hasPartialText: false,
    previewText: '',
    capReached: false,
    interrupted: false,
    recovered: false,
    hasClient: true,
  };
  const setSnap = (patch: Partial<DictationSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((fn) => fn());
  };
  const finishDef = deferred<DictationFinishResult>();
  let retryDef = deferred<DictationFinishResult>();
  const partial = 'partial spoken';

  const session: DictationSession = {
    getSnapshot: () => snap,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start: vi.fn(async () => {
      setSnap({ phase: 'recording' });
      return true;
    }),
    pause: vi.fn(async () => setSnap({ phase: 'paused' })),
    resume: vi.fn(async () => {
      setSnap({ phase: 'recording' });
      return true;
    }),
    finish: vi.fn(() => {
      setSnap({ phase: 'finishing' });
      return finishDef.promise;
    }),
    retryFailed: vi.fn(() => {
      retryDef = deferred<DictationFinishResult>();
      setSnap({ phase: 'finishing' });
      return retryDef.promise;
    }),
    takePartialText: vi.fn(() => {
      setSnap({ phase: 'idle' });
      return { text: partial, ...(journalId ? { journalId } : {}) };
    }),
    park: vi.fn(),
    reset: vi.fn(() => setSnap({ phase: 'idle' })),
    discard: vi.fn(async () => setSnap({ phase: 'idle' })),
    attachClient: vi.fn(),
    hasClient: vi.fn(() => true),
    getOriginApiUrl: vi.fn(() => undefined),
    getJournalId: vi.fn(() => journalId),
    clearError: vi.fn(() => setSnap({ errorMessage: undefined })),
  };

  return {
    session,
    resolveFinish: (res: DictationFinishResult) => {
      setSnap(
        res.status === 'failed'
          ? {
              phase: 'failed',
              failedSegments: res.failedSegments,
              completedSegments: res.completedSegments,
              hasPartialText: res.completedSegments > 0,
              previewText: res.completedSegments > 0 ? partial : '',
              errorMessage: res.errorMessage,
            }
          : { phase: 'idle' }
      );
      finishDef.resolve(res);
    },
    resolveRetry: (res: DictationFinishResult) => {
      setSnap({ phase: res.status === 'failed' ? 'failed' : 'idle' });
      retryDef.resolve(res);
    },
  };
};

const makeAttachmentAccess = (staged: TUploadItem[] = []) => {
  let enrolled: TUploadItem[] = [];
  const access: RoomInputAttachmentAccess = {
    snapshot: () => ({
      staged,
      enrolled: [...enrolled],
      uploads: staged.map((i) => ({ file: i.file, status: UploadStatus.Idle })),
    }),
    append: vi.fn((_roomId, items) => {
      staged = [...staged, ...items];
    }),
    remove: vi.fn(),
    release: vi.fn(),
    enroll: vi.fn((items) => {
      enrolled = [...enrolled, ...items];
    }),
    clearEnrollment: vi.fn((files) => {
      enrolled = enrolled.filter((i) => !files.includes(i.file));
    }),
    protectPasteItems: () => () => undefined,
    subscribe: () => () => undefined,
  };
  return { access, getEnrolled: () => enrolled };
};

const makeStartInput = (
  overrides: Partial<StartDetachedDictationSendInput> & {
    store: ReturnType<typeof createStore>;
    session: DictationSession;
    room?: Room;
  }
): StartDetachedDictationSendInput => {
  const room = overrides.room ?? makeRoom();
  const threadId = overrides.sendContext?.threadId;
  const ownerKey =
    overrides.ownerKey ?? getRoomInputDraftKey('@alice:example.org', room.roomId, threadId);
  return {
    mx: { getRoom: vi.fn(() => room) } as unknown as MatrixClient,
    ownerKey,
    draftKey: ownerKey,
    roomName: room.name,
    sendContext: {
      roomId: room.roomId,
      room,
      threadId,
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom: false,
    },
    composerContext: { roomId: room.roomId, threadId },
    docSnapshot: makeDoc(),
    savedSelection: null,
    pendingMarks: null,
    stagedSnapshot: [],
    tracksEnrollment: false,
    midTurnMode: 'auto',
    explicitMidTurnMode: false,
    isMarkdown: true,
    ownUserId: '@alice:example.org',
    parseCommands: true,
    commandsSnapshot: {},
    attachments: makeAttachmentAccess().access,
    sessions: { startSendSession: vi.fn(async () => undefined), restoreText: vi.fn() },
    restoreReplyDraft: vi.fn(),
    ...overrides,
  };
};

beforeEach(() => {
  mocks.sessionsList = [{ userId: '@alice:example.org' }];
  mocks.deleteCapture.mockClear();
  mocks.releaseCapture.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
    this: HTMLElement
  ) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  });
});

afterEach(() => cleanup());

describe('dictationAudioCapture immediate mic release', () => {
  it('stops media stream tracks synchronously in stopAndFlush before worklet ack', async () => {
    const trackStop = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
      getAudioTracks: () => [
        { addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: trackStop },
      ],
    } as unknown as MediaStream;

    let workletPortOnMessage: ((e: MessageEvent) => void) | null = null;
    const postMessage = vi.fn();
    class FakeWorkletNode {
      port = {
        get onmessage() {
          return workletPortOnMessage;
        },
        set onmessage(fn: ((e: MessageEvent) => void) | null) {
          workletPortOnMessage = fn;
        },
        postMessage,
      };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    const prevWorklet = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: FakeWorkletNode,
    });
    const fakeContext = {
      state: 'running',
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createAnalyser: () => ({ fftSize: 2048, getByteTimeDomainData: vi.fn() }),
      createGain: () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }),
      destination: {},
      audioWorklet: { addModule: vi.fn(async () => undefined) },
    } as unknown as AudioContext;

    try {
      const factory = createBrowserCaptureFactory({
        getUserMedia: async () => fakeStream,
        createAudioContext: () => fakeContext,
        workletUrl: '/worklet.js',
      });
      const handle = await factory({ onFrame: vi.fn(), onTrackEnded: vi.fn() });
      const stopPromise = handle.stopAndFlush();
      expect(trackStop).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({ type: 'stop' });
      const deliver = workletPortOnMessage as ((e: MessageEvent) => void) | null;
      deliver?.({ data: { type: 'stopped' } } as MessageEvent);
      await stopPromise;
    } finally {
      Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: prevWorklet,
      });
    }
  });
});

describe('dictationSendHandoff', () => {
  it('merges text + mention pill + pending bold mark + staged file off-DOM and sends after switching threads', async () => {
    const store = createStore();
    const room = makeRoom();
    const editor = withInlineElements(createEditor());
    editor.children = [
      {
        type: 'paragraph',
        children: [
          { text: 'Hey ' },
          createMentionElement('@bob:example.org', 'Bob', false),
          { text: '' },
        ],
      } as unknown as Descendant,
    ];
    Transforms.select(editor, { path: [0, 2], offset: 0 });
    editor.marks = { bold: true };

    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    const fileItem: TUploadItem = {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access } = makeAttachmentAccess([fileItem]);
    const uploadItem = vi.fn(async () => 'mxc://x/photo');
    const resetComposer = vi.fn();
    const stopTyping = vi.fn();
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const { session, resolveFinish } = makeMockSession();
    const keyA = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadA');
    handoffComposerDictationSend({
      store,
      mx: { getRoom: vi.fn(() => room) } as unknown as MatrixClient,
      editor,
      room,
      roomId: room.roomId,
      roomName: 'General',
      threadId: '$threadA',
      threadingEnabled: true,
      ownerKey: keyA,
      draftKey: keyA,
      composerContext: { roomId: room.roomId, threadId: '$threadA' },
      session,
      savedSelection: null,
      midTurnMode: 'steer',
      explicitMidTurnMode: true,
      isMarkdown: true,
      ownUserId: '@alice:example.org',
      parseCommands: true,
      commands: {},
      attachments: access,
      sessions: { startSendSession, restoreText: vi.fn() },
      takeRootModelDraft: () => undefined,
      uploadItem,
      clearReplyDraft: vi.fn(),
      restoreReplyDraft: vi.fn(),
      resetComposer,
      stopTyping,
    });

    expect(session.finish).toHaveBeenCalledTimes(1);
    expect(store.get(detachedDictationSendsAtom).get(keyA)?.status).toBe('sending');
    expect(access.enroll).toHaveBeenCalledWith([fileItem]);
    expect(uploadItem).toHaveBeenCalledWith(fileItem);
    expect(resetComposer).toHaveBeenCalledTimes(1);
    expect(stopTyping).toHaveBeenCalledTimes(1);

    // Thread B immediately starts another live dictation while Thread A finishes in background.
    const threadBSession = makeMockSession('recording').session;
    store.set(liveCaptureAtom, { kind: 'dictation', session: threadBSession });
    await act(async () => {
      resolveFinish({ status: 'completed', text: 'check this photo' });
      await Promise.resolve();
    });

    expect(store.get(detachedDictationSendsAtom).size).toBe(0);
    expect(store.get(liveCaptureAtom)).toEqual({ kind: 'dictation', session: threadBSession });
    const call = startSendSession.mock.calls[0]![0]!;
    expect(call.textContent?.body).toContain('check this photo');
    expect(call.textContent?.formatted_body).toContain('<strong>check this photo</strong>');
    expect(call.textContent?.['m.mentions']?.user_ids).toContain('@bob:example.org');
    expect(call.textContent?.[MID_TURN_MODE_KEY]).toBe('steer');
    expect(call.batch?.fileItems).toEqual([fileItem]);
    expect(call.context?.threadId).toBe('$threadA');
  });

  it('handles off-thread failure notice, remounted Retry & send, Insert partial, and Discard', async () => {
    const store = createStore();
    const room = makeRoom('!r1:example.org', 'Design');
    const keyA = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadA');
    const replyDraft: IReplyDraft = { userId: '@bob:example.org', eventId: '$ev1', body: 'Orig' };
    const file = new File(['a'], 'doc.txt', { type: 'text/plain' });
    const fileItem: TUploadItem = {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };

    // 1. Off-thread failure renders DictationSendErrorNotice; reopening on a new view clears it and retries.
    const s1 = makeMockSession();
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const acc1 = makeAttachmentAccess([fileItem]);
    acc1.access.enroll([fileItem]);
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s1.session,
        ownerKey: keyA,
        sendContext: {
          roomId: room.roomId,
          room,
          threadId: '$threadA',
          replyDraft,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        composerContext: { roomId: room.roomId, threadId: '$threadA' },
        docSnapshot: makeDoc('Intro'),
        stagedSnapshot: [fileItem],
        tracksEnrollment: true,
        attachments: acc1.access,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    const notice = render(
      <Provider store={store}>
        <DictationSendErrorNotice />
      </Provider>
    );
    await act(async () => {
      s1.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 1,
        errorMessage: 'Timeout',
      });
      await Promise.resolve();
    });
    expect(startSendSession).not.toHaveBeenCalled();
    expect(store.get(detachedDictationErrorAtom)).toEqual({
      ownerKey: keyA,
      roomName: 'Design',
      kind: 'failed',
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'composer.dictation.sendFailedOffThread:Design'
    );

    const editor2 = withInlineElements(createEditor());
    editor2.children = makeDoc();
    const restoreReply = vi.fn();
    const restoreAttachments = vi.fn();
    function Reopened({ viewId }: { viewId: string }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      const feat = useRoomInputDictation({
        editor: editor2,
        roomId: room.roomId,
        threadId: '$threadA',
        ownerKey: `${keyA}:${viewId}`,
        sendKey: keyA,
        rootRef,
        createSession: () => makeMockSession('idle').session,
        restoreReplyDraft: restoreReply,
        restoreAttachments,
      });
      return <div ref={rootRef}>{feat.capsule}</div>;
    }
    const reopened = render(
      <Provider store={store}>
        <Reopened viewId="view-2" />
      </Provider>
    );
    expect(store.get(detachedDictationErrorAtom)).toBeUndefined();
    fireEvent.click(screen.getByText('composer.dictation.retryAndSend'));
    await act(async () => {
      s1.resolveRetry({ status: 'completed', text: 'retried body' });
      await Promise.resolve();
    });
    expect(startSendSession).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: expect.objectContaining({ body: 'Intro retried body' }),
        batch: { fileItems: [fileItem] },
      })
    );

    // 2. Insert partial merges partial speech into original draft and restores into live editor.
    const s2 = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s2.session,
        ownerKey: keyA,
        docSnapshot: makeDoc('Base'),
      })
    );
    await act(async () => {
      s2.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 1,
        errorMessage: 'Down',
      });
      await Promise.resolve();
    });
    expect(store.get(detachedDictationErrorAtom)).toBeUndefined();
    fireEvent.click(screen.getByText('composer.dictation.insertPartial'));
    expect(readEditorText(editor2)).toBe('Base partial spoken');

    // 3. Discard restores original draft, replyDraft, and staged files, releasing enrollments.
    editor2.children = makeDoc();
    const s3 = makeMockSession();
    const acc3 = makeAttachmentAccess([fileItem]);
    acc3.access.enroll([fileItem]);
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s3.session,
        ownerKey: keyA,
        sendContext: {
          roomId: room.roomId,
          room,
          threadId: '$threadA',
          replyDraft,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        docSnapshot: makeDoc('Original draft'),
        stagedSnapshot: [fileItem],
        tracksEnrollment: true,
        attachments: acc3.access,
        restoreReplyDraft: restoreReply,
      })
    );
    await act(async () => {
      s3.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'Down',
      });
      await Promise.resolve();
    });
    // Clicking Discard on a detached failed bar opens DiscardCaptureDialog first.
    fireEvent.click(screen.getByText('composer.dictation.discard'));
    const confirmDialog = screen.getByRole('dialog');
    expect(s3.session.discard).not.toHaveBeenCalled();
    // Cancelling leaves the failed bar intact.
    fireEvent.click(
      within(confirmDialog).getByRole('button', {
        name: 'mindroomUi.voice.voiceRecorderDialog.cancel',
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.get(detachedDictationSendsAtom).get(keyA)?.status).toBe('failed');

    // Confirming Discard awaits session.discard() and restores original draft/reply/attachments.
    fireEvent.click(screen.getByText('composer.dictation.discard'));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'mindroomUi.voice.voiceRecorderDialog.discard',
        })
      );
      await Promise.resolve();
    });
    expect(s3.session.discard).toHaveBeenCalledTimes(1);
    expect(readEditorText(editor2)).toBe('Original draft');
    expect(restoreReply).toHaveBeenCalledWith(replyDraft);
    expect(restoreAttachments).toHaveBeenCalledWith(room.roomId, [fileItem]);
    expect(acc3.getEnrolled()).toEqual([]);
    reopened.unmount();
    notice.unmount();
  });

  it('aborts on account switch by resetting and releasing (not deleting) journal, restoring draft to old account only', async () => {
    const store = createStore();
    const room = makeRoom();
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const s = makeMockSession('recording', 'journal-switch');
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        docSnapshot: makeDoc('Saved before switch'),
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );

    forgetComposerStateOfSession(store);
    expect(s.session.reset).toHaveBeenCalledTimes(1);
    expect(s.session.discard).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(store.get(detachedDictationSendsAtom).size).toBe(0);
    expect(store.get(roomIdToMsgDraftAtomFamily(key))).toEqual(makeDoc('Saved before switch'));

    await act(async () => {
      s.resolveFinish({
        status: 'completed',
        text: 'should never send',
        journalId: 'journal-switch',
      });
      await Promise.resolve();
    });
    expect(startSendSession).not.toHaveBeenCalled();
    expect(s.session.discard).not.toHaveBeenCalled();
    expect(mocks.releaseCapture).toHaveBeenCalledWith('journal-switch');
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
  });

  it('handles no-speech, existing text, acting/unknown commands, Home ask, and non-collapsed selection', async () => {
    const store = createStore();
    const room = makeRoom();
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const editor = withInlineElements(createEditor());
    editor.children = makeDoc();
    const onCommandProblem = vi.fn();

    function MountedComposer() {
      const rootRef = useRef<HTMLDivElement | null>(null);
      const feat = useRoomInputDictation({
        editor,
        roomId: room.roomId,
        ownerKey: key,
        rootRef,
        createSession: () => makeMockSession('idle').session,
        onCommandProblem,
      });
      return <div ref={rootRef}>{feat.capsule}</div>;
    }
    render(
      <Provider store={store}>
        <MountedComposer />
      </Provider>
    );

    // Empty speech + empty composer -> no send + no-speech banner.
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const sEmpty = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sEmpty.session,
        ownerKey: key,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sEmpty.resolveFinish({ status: 'completed', text: '   ' });
      await Promise.resolve();
    });
    expect(startSendSession).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('composer.dictation.noSpeech');

    // Empty speech + existing text -> sends existing text normally.
    const sExisting = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sExisting.session,
        ownerKey: key,
        docSnapshot: makeDoc('Existing text'),
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sExisting.resolveFinish({ status: 'completed', text: '' });
      await Promise.resolve();
    });
    expect(startSendSession).toHaveBeenCalledWith(
      expect.objectContaining({ textContent: expect.objectContaining({ body: 'Existing text' }) })
    );

    // Acting (/leave) and unknown (/bogus) commands restore for review instead of running silently.
    const leaveRun = vi.fn(async () => undefined);
    const commandsSnapshot: Record<string, SlashCommand> = {
      leave: { name: 'leave', description: 'Leave', source: 'app', run: leaveRun },
    };
    startSendSession.mockClear();
    const sActing = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sActing.session,
        ownerKey: key,
        docSnapshot: makeDoc('/leave'),
        commandsSnapshot,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sActing.resolveFinish({ status: 'completed', text: 'now' });
      await Promise.resolve();
    });
    expect(leaveRun).not.toHaveBeenCalled();
    expect(startSendSession).not.toHaveBeenCalled();
    expect(readEditorText(editor)).toBe('/leave now');

    const sUnknown = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sUnknown.session,
        ownerKey: key,
        docSnapshot: makeDoc('/bogus'),
        commandsSnapshot,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sUnknown.resolveFinish({ status: 'completed', text: 'arg' });
      await Promise.resolve();
    });
    expect(onCommandProblem).toHaveBeenCalledWith(
      'featureUi.room.commandAutocomplete.unknown:/bogus'
    );
    expect(startSendSession).not.toHaveBeenCalled();

    // Home ask wraps mention, passes beforeSend/onLocalEcho, and clears onSendingChange.
    const onSendingChange = vi.fn();
    const onLocalEcho = vi.fn();
    const sAsk = makeMockSession();
    startSendSession.mockImplementationOnce(async (opts) => {
      expect(opts?.beforeSend?.(room)).toBe(true);
      opts?.onLocalEchoCreated?.('~!room:txn1', room);
    });
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sAsk.session,
        ownerKey: key,
        parseCommands: false,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
          onSendingChange,
          onLocalEcho,
        },
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sAsk.resolveFinish({ status: 'completed', text: 'summarize today' });
      await Promise.resolve();
    });
    expect(startSendSession.mock.calls[0]![0]!.textContent?.['m.mentions']?.user_ids).toContain(
      '@mindroom_helper:example.org'
    );
    expect(onLocalEcho).toHaveBeenCalledWith('~!room:txn1', room);
    expect(onSendingChange).toHaveBeenCalledWith(false);

    // Non-collapsed selection replacement off-DOM does not apply pending marks.
    const merged = mergeDictatedDoc(
      makeDoc('Hello world'),
      'there',
      { anchor: { path: [0, 0], offset: 6 }, focus: { path: [0, 0], offset: 11 } },
      { bold: true }
    );
    expect(readEditorText(merged)).toBe('Hello there');
    expect([...Node.texts(merged)].map(([t]) => t)).toEqual([{ text: 'Hello there' }]);
  });

  it('blocks follow-up sends on the same thread while sending without blocking another thread, pins empty batch, and restores rootModel on recovery/no-speech', async () => {
    const store = createStore();
    const room = makeRoom();
    const keyA = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadA');
    const keyB = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadB');
    const editor = withInlineElements(createEditor());
    editor.children = makeDoc();
    let latest!: RoomInputDictationFeature;

    function ThreadComposer({ threadId, sendKey }: { threadId: string; sendKey: string }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId: room.roomId,
        threadId,
        ownerKey: `${sendKey}:view-1`,
        sendKey,
        rootRef,
        createSession: () => makeMockSession('idle').session,
      });
      return <div ref={rootRef}>{latest.capsule}</div>;
    }

    const view = render(
      <Provider store={store}>
        <ThreadComposer threadId="$threadA" sendKey={keyA} />
      </Provider>
    );
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const s1 = makeMockSession();
    act(() => {
      startDetachedDictationSend(
        makeStartInput({
          store,
          room,
          session: s1.session,
          ownerKey: keyA,
          sessions: { startSendSession, restoreText: vi.fn() },
        })
      );
    });

    // Thread A blocks follow-up sends while its detached dictation is still finishing.
    expect(latest.blocksSubmit).toBe(true);
    expect(latest.getLiveStatus()).toBe('blocked');

    // Switching to Thread B is completely unblocked.
    view.rerender(
      <Provider store={store}>
        <ThreadComposer threadId="$threadB" sendKey={keyB} />
      </Provider>
    );
    expect(latest.blocksSubmit).toBe(false);
    expect(latest.getLiveStatus()).toBe('idle');

    // Switch back to Thread A and finish: sends explicit empty batch (never rescans newly staged files) and unblocks.
    view.rerender(
      <Provider store={store}>
        <ThreadComposer threadId="$threadA" sendKey={keyA} />
      </Provider>
    );
    await act(async () => {
      s1.resolveFinish({ status: 'completed', text: 'first message' });
      await Promise.resolve();
    });
    expect(startSendSession).toHaveBeenCalledWith(
      expect.objectContaining({ batch: { fileItems: [] } })
    );
    expect(latest.blocksSubmit).toBe(false);
    expect(latest.getLiveStatus()).toBe('idle');

    // Root model draft is restored on Insert partial, No speech, and skipsRootModel command sends.
    const rootModel = threadModelContent('@router:example.org', 'DEV1', 'fast@high');
    const restoreRootModelDraft = vi.fn();

    const sPartial = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sPartial.session,
        ownerKey: keyA,
        rootModel,
        restoreRootModelDraft,
      })
    );
    await act(async () => {
      sPartial.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 1,
        errorMessage: 'Err',
      });
      await Promise.resolve();
    });
    expect(restoreRootModelDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('composer.dictation.insertPartial'));
    expect(restoreRootModelDraft).toHaveBeenCalledWith(room, rootModel);

    restoreRootModelDraft.mockClear();
    const sNoSpeech = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sNoSpeech.session,
        ownerKey: keyA,
        rootModel,
        restoreRootModelDraft,
      })
    );
    await act(async () => {
      sNoSpeech.resolveFinish({ status: 'completed', text: '' });
      await Promise.resolve();
    });
    expect(restoreRootModelDraft).toHaveBeenCalledWith(room, rootModel);

    startSendSession.mockClear();
    restoreRootModelDraft.mockClear();
    const sCmd = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sCmd.session,
        ownerKey: keyA,
        commandsSnapshot: {
          me: { name: 'me', description: 'Send an action.', source: 'app' },
        },
        rootModel,
        restoreRootModelDraft,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sCmd.resolveFinish({ status: 'completed', text: '/me waves' });
      await Promise.resolve();
    });
    expect(startSendSession).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: expect.objectContaining({ msgtype: 'm.emote', body: 'waves' }),
        rootModel: null,
      })
    );
    expect(restoreRootModelDraft).toHaveBeenCalledWith(room, rootModel);
    view.unmount();
  });

  it('excludes files already enrolled by a failed Thread A Finish & Send from Thread B Finish & Send', async () => {
    const store = createStore();
    const room = makeRoom('!r1:example.org', 'General');
    const fileA = new File(['pdf'], 'A-only.pdf', { type: 'application/pdf' });
    const fileItemA: TUploadItem = {
      file: fileA,
      originalFile: fileA,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access, getEnrolled } = makeAttachmentAccess([fileItemA]);
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const uploadItem = vi.fn(async () => 'mxc://test/a-only');
    const keyA = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadA');
    const keyB = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadB');

    const editorA = withInlineElements(createEditor());
    editorA.children = makeDoc();
    const sessionA = makeMockSession();
    const entryA = handoffComposerDictationSend({
      store,
      mx: { getRoom: vi.fn(() => room) } as unknown as MatrixClient,
      editor: editorA,
      room,
      roomId: room.roomId,
      roomName: 'General',
      threadId: '$threadA',
      threadingEnabled: true,
      ownerKey: keyA,
      draftKey: keyA,
      composerContext: { roomId: room.roomId, threadId: '$threadA' },
      session: sessionA.session,
      savedSelection: null,
      midTurnMode: 'auto',
      explicitMidTurnMode: false,
      isMarkdown: true,
      ownUserId: '@alice:example.org',
      parseCommands: true,
      commands: {},
      attachments: access,
      sessions: { startSendSession, restoreText: vi.fn() },
      takeRootModelDraft: () => undefined,
      uploadItem,
      clearReplyDraft: vi.fn(),
      restoreReplyDraft: vi.fn(),
      resetComposer: vi.fn(),
      stopTyping: vi.fn(),
    });

    await act(async () => {
      sessionA.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'Transient error',
      });
      await Promise.resolve();
    });
    expect(getEnrolled()).toEqual([fileItemA]);

    // Thread B in the same room finishes and sends while A-only.pdf is still enrolled by Thread A.
    const editorB = withInlineElements(createEditor());
    editorB.children = makeDoc();
    const sessionB = makeMockSession();
    handoffComposerDictationSend({
      store,
      mx: { getRoom: vi.fn(() => room) } as unknown as MatrixClient,
      editor: editorB,
      room,
      roomId: room.roomId,
      roomName: 'General',
      threadId: '$threadB',
      threadingEnabled: true,
      ownerKey: keyB,
      draftKey: keyB,
      composerContext: { roomId: room.roomId, threadId: '$threadB' },
      session: sessionB.session,
      savedSelection: null,
      midTurnMode: 'auto',
      explicitMidTurnMode: false,
      isMarkdown: true,
      ownUserId: '@alice:example.org',
      parseCommands: true,
      commands: {},
      attachments: access,
      sessions: { startSendSession, restoreText: vi.fn() },
      takeRootModelDraft: () => undefined,
      uploadItem,
      clearReplyDraft: vi.fn(),
      restoreReplyDraft: vi.fn(),
      resetComposer: vi.fn(),
      stopTyping: vi.fn(),
    });

    await act(async () => {
      sessionB.resolveFinish({ status: 'completed', text: 'Thread B message only' });
      await Promise.resolve();
    });

    expect(startSendSession).toHaveBeenCalledTimes(1);
    expect(startSendSession).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: expect.objectContaining({ body: 'Thread B message only' }),
        batch: { fileItems: [] },
        context: expect.objectContaining({ threadId: '$threadB' }),
      })
    );
    // Thread A still retains A-only.pdf enrolled and sends it on retry.
    expect(getEnrolled()).toEqual([fileItemA]);

    await act(async () => {
      store.get(detachedDictationSendsAtom).get(entryA.ownerKey)!.retryAndSend();
      sessionA.resolveRetry({ status: 'completed', text: 'Thread A retry with file' });
      await Promise.resolve();
    });

    expect(startSendSession).toHaveBeenCalledTimes(2);
    expect(startSendSession.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        textContent: expect.objectContaining({ body: 'Thread A retry with file' }),
        batch: { fileItems: [fileItemA] },
        context: expect.objectContaining({ threadId: '$threadA' }),
      })
    );
  });

  it('surfaces off-thread empty transcription in detachedDictationErrorAtom without sending', async () => {
    const store = createStore();
    const room = makeRoom('!r1:example.org', 'Design');
    const keyA = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadA');
    const replyDraft: IReplyDraft = { userId: '@bob:example.org', eventId: '$ev1', body: 'Orig' };
    const rootModel = threadModelContent('@router:example.org', 'DEV1', 'fast@high');
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const restoreReplyDraft = vi.fn();
    const restoreRootModelDraft = vi.fn();
    const sEmpty = makeMockSession();

    const notice = render(
      <Provider store={store}>
        <DictationSendErrorNotice />
      </Provider>
    );

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sEmpty.session,
        ownerKey: keyA,
        sendContext: {
          roomId: room.roomId,
          room,
          threadId: '$threadA',
          replyDraft,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        rootModel,
        restoreReplyDraft,
        restoreRootModelDraft,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );

    await act(async () => {
      sEmpty.resolveFinish({ status: 'completed', text: '   ' });
      await Promise.resolve();
    });

    expect(startSendSession).not.toHaveBeenCalled();
    expect(store.get(detachedDictationSendsAtom).size).toBe(0);
    expect(store.get(detachedDictationErrorAtom)).toEqual({
      ownerKey: keyA,
      roomName: 'Design',
      kind: 'noSpeech',
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'composer.dictation.noSpeechOffThread:Design'
    );
    expect(restoreReplyDraft).toHaveBeenCalledWith(replyDraft);
    expect(restoreRootModelDraft).toHaveBeenCalledWith(room, rootModel);
    notice.unmount();
  });

  it('retains journal across transcription and retries, deleting only after send, fallback save, partial insert, or confirmed discard', async () => {
    const store = createStore();
    const room = makeRoom('!r1:example.org', 'Ops');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId, '$thread1');

    // 1. Journal stays intact across failure + retry AND even after startSendSession resolves early
    // (pending attachment / queued send), deleting only when onTextConsumed fires.
    let capturedOnTextConsumed: (() => void) | undefined;
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      capturedOnTextConsumed = opts?.onTextConsumed;
    });
    const sSend = makeMockSession('recording', 'journal-send');
    const entry = startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sSend.session,
        ownerKey: key,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );

    await act(async () => {
      sSend.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: '503',
      });
      await Promise.resolve();
    });
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    await act(async () => {
      store.get(detachedDictationSendsAtom).get(entry.ownerKey)!.retryAndSend();
      sSend.resolveRetry({
        status: 'completed',
        text: 'Ship it',
        journalId: 'journal-send',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startSendSession).toHaveBeenCalledTimes(1);
    // startSendSession already resolved, yet journal MUST stay alive until onTextConsumed fires!
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    capturedOnTextConsumed?.();
    expect(mocks.deleteCapture).toHaveBeenCalledExactlyOnceWith('journal-send');

    // 2. If startSendSession throws before send, fallback draft is restored BEFORE journal deletion.
    mocks.deleteCapture.mockClear();
    const restoreText = vi.fn();
    const sThrow = makeMockSession('recording', 'journal-throw');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      startDetachedDictationSend(
        makeStartInput({
          store,
          room,
          session: sThrow.session,
          ownerKey: key,
          docSnapshot: makeDoc('Draft'),
          sessions: {
            startSendSession: vi.fn(async () => {
              throw new Error('send exploded');
            }),
            restoreText,
          },
        })
      );
      await act(async () => {
        sThrow.resolveFinish({
          status: 'completed',
          text: 'extra',
          journalId: 'journal-throw',
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(restoreText).toHaveBeenCalledTimes(1);
      expect(mocks.deleteCapture).toHaveBeenCalledWith('journal-throw');
    } finally {
      warnSpy.mockRestore();
    }

    // 3. insertPartial deletes journal only after restoring merged partial text.
    mocks.deleteCapture.mockClear();
    const sPartial = makeMockSession('recording', 'journal-partial');
    const partialEntry = startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sPartial.session,
        ownerKey: key,
        docSnapshot: makeDoc('Base'),
      })
    );
    await act(async () => {
      sPartial.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 1,
        errorMessage: 'Down',
      });
      await Promise.resolve();
    });
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    store.get(detachedDictationSendsAtom).get(partialEntry.ownerKey)!.insertPartial();
    expect(mocks.deleteCapture).toHaveBeenCalledWith('journal-partial');
  });

  it('keeps dictation journal alive through real useRoomInputSendSessionController pending upload until text sends or fallback restores', async () => {
    const store = createStore();
    const roomId = '!attach:example.org';
    const sendMessage = vi.fn(async (_r: string, _c: unknown, txnId: string) => ({
      event_id: `$ev-${txnId}`,
    }));
    const room = {
      roomId,
      name: 'Attach Room',
      hasEncryptionStateEvent: () => false,
      getEventForTxnId: () => undefined,
      getMembers: () => [],
      currentState: { getStateEvents: () => [] },
    } as unknown as Room;
    let txnCounter = 0;
    const mx = {
      getRoom: (id: string) => (id === roomId ? room : null),
      makeTxnId: () => `txn-${(txnCounter += 1)}`,
      sendMessage,
    } as unknown as MatrixClient;

    const file = new File(['pdf'], 'spec.pdf', { type: 'application/pdf' });
    const fileItem: TUploadItem = {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    let currentUploads = [
      {
        file,
        status: UploadStatus.Loading,
        promise: new Promise<{ content_uri: string }>(() => undefined),
        progress: { loaded: 0, total: file.size },
      },
    ];
    let staged: TUploadItem[] = [fileItem];
    let enrolled: TUploadItem[] = [];
    const listeners = new Set<() => void>();
    const access: RoomInputAttachmentAccess = {
      snapshot: () => ({
        staged: [...staged],
        enrolled: [...enrolled],
        uploads: currentUploads as never,
      }),
      enroll: (items) => {
        const next = items.filter((item) => !enrolled.some((e) => e.file === item.file));
        enrolled = [...enrolled, ...next];
        staged = staged.filter((item) => !next.some((e) => e.file === item.file));
      },
      clearEnrollment: (files) => {
        enrolled = enrolled.filter((item) => !files.includes(item.file));
      },
      append: (_r, items) => {
        staged = [...staged, ...items];
      },
      remove: (_r, files) => {
        staged = staged.filter((item) => !files.includes(item.file));
        enrolled = enrolled.filter((item) => !files.includes(item.file));
      },
      release: (_r, files) => {
        staged = staged.filter((item) => !files.includes(item.file));
      },
      protectPasteItems: () => () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    const editor = withInlineElements(createEditor());
    editor.children = makeDoc();
    let controller!: ReturnType<typeof useRoomInputSendSessionController>;
    const restoreFallbackForRoom = vi.fn();

    function SendControllerHost() {
      controller = useRoomInputSendSessionController({
        mx,
        room,
        roomId,
        clearReplyDraft: vi.fn(),
        editor,
        sendTypingStatus: vi.fn(),
        attachments: access,
        buildUploadMessageContent: async (item, mxc) => ({
          msgtype: 'm.file',
          body: item.file.name,
          url: mxc,
        }),
        restoreComposerFallbackForRoom: restoreFallbackForRoom,
      });
      return null;
    }

    const view = render(
      <Provider store={store}>
        <SendControllerHost />
      </Provider>
    );

    const key = getRoomInputDraftKey('@alice:example.org', roomId);
    const sAttach = makeMockSession('recording', 'journal-pending-upload');
    startDetachedDictationSend(
      makeStartInput({
        store,
        mx,
        room,
        session: sAttach.session,
        ownerKey: key,
        composerContext: { roomId, threadId: undefined },
        sendContext: {
          roomId,
          room,
          threadId: undefined,
          replyDraft: undefined,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        stagedSnapshot: [fileItem],
        tracksEnrollment: true,
        attachments: access,
        sessions: {
          startSendSession: controller.startSendSession,
          restoreText: controller.restoreText,
        },
      })
    );
    access.enroll([fileItem]);

    await act(async () => {
      sAttach.resolveFinish({
        status: 'completed',
        text: 'Caption waiting for PDF',
        journalId: 'journal-pending-upload',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // startSendSession resolved while upload is still loading -> journal MUST NOT be deleted yet!
    expect(controller.hasActiveSendSession()).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    // Finish upload -> Matrix receives file then caption -> journal IS deleted!
    currentUploads = [
      { file, status: UploadStatus.Success, mxc: 'mxc://mindroom/spec.pdf' } as never,
    ];
    await act(async () => {
      store.set(roomUploadAtomFamily(file), {
        status: UploadStatus.Success,
        mxc: 'mxc://mindroom/spec.pdf',
      } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sendMessage.mock.calls[1]![1]).toMatchObject({ body: 'Caption waiting for PDF' });
    expect(mocks.deleteCapture).toHaveBeenCalledExactlyOnceWith('journal-pending-upload');

    // Second send where Matrix sendMessage rejects without local echo -> fallback restored AND journal deleted!
    mocks.deleteCapture.mockClear();
    sendMessage.mockRejectedValueOnce(new Error('network down'));
    const sFailText = makeMockSession('recording', 'journal-fallback-restore');
    startDetachedDictationSend(
      makeStartInput({
        store,
        mx,
        room,
        session: sFailText.session,
        ownerKey: key,
        composerContext: { roomId, threadId: undefined },
        sendContext: {
          roomId,
          room,
          threadId: undefined,
          replyDraft: undefined,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        stagedSnapshot: [],
        tracksEnrollment: false,
        attachments: access,
        sessions: {
          startSendSession: controller.startSendSession,
          restoreText: controller.restoreText,
        },
      })
    );
    await act(async () => {
      sFailText.resolveFinish({
        status: 'completed',
        text: 'Must survive failed send',
        journalId: 'journal-fallback-restore',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(mocks.deleteCapture).toHaveBeenCalledExactlyOnceWith('journal-fallback-restore')
    );
    expect(editor.children.map((n) => Node.string(n)).join('\n')).toBe('Must survive failed send');
    view.unmount();
  });
});

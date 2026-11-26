// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, atom, createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { createEditor, Node, Transforms, type Descendant, type Editor } from 'slate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMentionElement, withInlineElements } from '../../editor/utils';
import { MID_TURN_MODE_KEY } from '../../matrix/protocol/midTurn';
import { createPasteMarker } from '../../matrix/protocol/pasteAttachmentMarker';
import { threadModelContent } from '../../matrix/protocol/threadModel';
import { UploadStatus, type TUploadItem } from '../../matrix/state/upload';
import type { SlashCommand } from '../commands/useCommands';
import type { RoomInputAttachmentAccess } from '../roomInputAttachmentAccess';
import {
  useRoomInputSendSessionController,
  type StartRoomInputSendSessionOptions,
} from '../useRoomInputSendSessionController';
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
  registerMountedDictationOwner,
  startDetachedDictationSend,
  type StartDetachedDictationSendInput,
} from './dictationSendHandoff';
import type {
  DictationFinishResult,
  DictationSession,
  DictationSnapshot,
  DictationVoiceAudio,
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
const makeRoom = (roomId = '!room:example.org', name = 'General', encrypted = false): Room =>
  ({
    roomId,
    name,
    hasEncryptionStateEvent: () => encrypted,
    getMembers: () => [],
  }) as unknown as Room;

const makeMockSession = (
  initialPhase: DictationSnapshot['phase'] = 'recording',
  journalId?: string,
  voiceAudio?: DictationVoiceAudio
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
    hasVoiceAudio: Boolean(voiceAudio),
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
    buildVoiceAudio: vi.fn(async () => voiceAudio),
    completeVoiceFallback: vi.fn(() => {
      setSnap({ phase: 'idle', hasVoiceAudio: false });
      return journalId ? { journalId } : {};
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
    createVoiceUploadItems: vi.fn(async (file, duration, waveform) => [
      {
        file,
        originalFile: file,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false, voiceMessage: { duration, waveform } },
      },
    ]),
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
      createVoiceUploadItems: vi.fn(async (file, duration, waveform) => [
        {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false, voiceMessage: { duration, waveform } },
        },
      ]),
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

    // Home ask wraps mention, keeps staged attachments (including empty-speech attachment sends), dismisses lost notices, and tracks lifecycle.
    const onSendingChange = vi.fn();
    const onLocalEcho = vi.fn();
    const dismissLostNotices = vi.fn();
    const askFile = new File(['pic'], 'note.png', { type: 'image/png' });
    const encAskFile = new File(['cipher'], 'note.png', { type: 'application/octet-stream' });
    const askItem: TUploadItem = {
      file: askFile,
      originalFile: askFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const encAskItem: TUploadItem = {
      file: encAskFile,
      originalFile: askFile,
      encInfo: { v: 'v2' } as never,
      metadata: { markedAsSpoiler: false },
    };
    const encRoom = makeRoom('!enc:example.org', 'Encrypted', true);
    expect(encRoom.hasEncryptionStateEvent()).toBe(true);
    const { access: askAttachments, getEnrolled: getAskEnrolled } = makeAttachmentAccess([askItem]);
    const uploadAskItem = vi.fn(async () => 'mxc://example.org/enc-note');
    const prepareAttachmentsForSend = vi.fn(async (_r: Room, _items: TUploadItem[]) => {
      askAttachments.append(encRoom.roomId, [encAskItem]);
      return [encAskItem];
    });
    const sAsk = makeMockSession();
    startSendSession.mockImplementationOnce(async (opts) => {
      expect(opts?.beforeSend?.(encRoom)).toBe(true);
      opts?.onLocalEchoCreated?.('~!room:txn1', encRoom);
    });
    const askEditor = withInlineElements(createEditor());
    askEditor.children = makeDoc();
    handoffComposerDictationSend({
      ...makeStartInput({
        store,
        room: encRoom,
        session: sAsk.session,
        ownerKey: key,
        parseCommands: false,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
          onSendingChange,
          onLocalEcho,
        },
        attachments: askAttachments,
        sessions: { startSendSession, restoreText: vi.fn() },
        dismissLostNotices,
        prepareAttachmentsForSend,
      }),
      editor: askEditor,
      room: encRoom,
      roomId: encRoom.roomId,
      threadingEnabled: true,
      commands: {},
      takeRootModelDraft: vi.fn(() => undefined),
      createVoiceUploadItems: vi.fn(async () => []),
      uploadItem: uploadAskItem,
      clearReplyDraft: vi.fn(),
      resetComposer: vi.fn(),
      stopTyping: vi.fn(),
    });
    expect(getAskEnrolled()).toEqual([askItem]);
    // Deferred upload: nothing uploaded at handoff time before prepareAttachmentsForSend commits.
    expect(uploadAskItem).not.toHaveBeenCalled();
    await act(async () => {
      sAsk.resolveFinish({ status: 'completed', text: 'summarize today' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(prepareAttachmentsForSend).toHaveBeenCalledWith(encRoom, [askItem]);
    expect(uploadAskItem).toHaveBeenCalledWith(encAskItem);
    expect(startSendSession.mock.calls[0]![0]!.textContent?.['m.mentions']?.user_ids).toContain(
      '@mindroom_helper:example.org'
    );
    expect(startSendSession.mock.calls[0]![0]!.batch?.fileItems).toEqual([encAskItem]);
    expect(startSendSession.mock.calls[0]![0]!.completeWithinCall).toBe(true);
    expect(dismissLostNotices).toHaveBeenCalledTimes(1);
    expect(onLocalEcho).toHaveBeenCalledWith('~!room:txn1', encRoom);
    expect(onSendingChange).toHaveBeenCalledWith(false);

    const sAskFileOnly = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sAskFileOnly.session,
        ownerKey: key,
        parseCommands: false,
        stagedSnapshot: [askItem],
        ask: { agentUserId: '@mindroom_helper:example.org', canSend: () => true },
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sAskFileOnly.resolveFinish({ status: 'completed', text: '' });
      await Promise.resolve();
    });
    expect(startSendSession.mock.calls[1]![0]!.textContent).toBeUndefined();
    expect(startSendSession.mock.calls[1]![0]!.batch?.fileItems).toEqual([askItem]);

    // Home Finish & Send: when a large-paste file fails upload, do not send text with a dangling marker.
    const pasteMeta = {
      id: 'paste-a3f19c',
      chars: 20_000,
      fileName: 'mindroom-paste-a3f19c.txt',
    };
    const pasteMarker = createPasteMarker(pasteMeta);
    const pasteFile = new File(['x'.repeat(100)], pasteMeta.fileName, { type: 'text/plain' });
    const pasteItem: TUploadItem = {
      file: pasteFile,
      originalFile: pasteFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false, mindroomPasteAttachment: pasteMeta },
    };
    const { access: pasteAttachments, getEnrolled: getPasteEnrolled } = makeAttachmentAccess([
      pasteItem,
    ]);
    const pasteRestoreText = vi.fn();
    const pasteOnSendingChange = vi.fn();
    const pasteUploadItem = vi.fn(async () => {
      throw new Error('offline');
    });
    const pastePrepareForSend = vi.fn(async (_r: Room, items: TUploadItem[]) => items);
    const pasteStartSendSession = vi.fn(async () => undefined);
    const sAskPasteFail = makeMockSession();
    const pasteEditor = withInlineElements(createEditor());
    pasteEditor.children = [
      {
        type: 'paragraph',
        children: [
          { text: '' },
          {
            type: 'paste-marker',
            id: pasteMeta.id,
            chars: pasteMeta.chars,
            fileName: pasteMeta.fileName,
            marker: pasteMarker,
            children: [{ text: '' }],
          },
          { text: ' ' },
        ],
      } as unknown as Descendant,
    ];
    handoffComposerDictationSend({
      ...makeStartInput({
        store,
        room,
        session: sAskPasteFail.session,
        ownerKey: `${key}:paste-fail`,
        parseCommands: false,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
          onSendingChange: pasteOnSendingChange,
        },
        attachments: pasteAttachments,
        sessions: { startSendSession: pasteStartSendSession, restoreText: pasteRestoreText },
        prepareAttachmentsForSend: pastePrepareForSend,
      }),
      editor: pasteEditor,
      room,
      roomId: room.roomId,
      threadingEnabled: true,
      commands: {},
      takeRootModelDraft: vi.fn(() => undefined),
      createVoiceUploadItems: vi.fn(async () => []),
      uploadItem: pasteUploadItem,
      clearReplyDraft: vi.fn(),
      resetComposer: vi.fn(),
      stopTyping: vi.fn(),
    });
    await act(async () => {
      sAskPasteFail.resolveFinish({ status: 'completed', text: 'summarize this paste' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pasteUploadItem).toHaveBeenCalledWith(pasteItem);
    expect(pasteStartSendSession).not.toHaveBeenCalled();
    expect(pasteRestoreText).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(pasteRestoreText.mock.calls[0]![1])).toContain('summarize this paste');
    expect(JSON.stringify(pasteRestoreText.mock.calls[0]![1])).toContain(pasteMeta.fileName);
    expect(getPasteEnrolled()).toEqual([]);
    expect(pasteOnSendingChange).toHaveBeenLastCalledWith(false);

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
      createVoiceUploadItems: vi.fn(async (file, duration, waveform) => [
        {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false, voiceMessage: { duration, waveform } },
        },
      ]),
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
      createVoiceUploadItems: vi.fn(async (file, duration, waveform) => [
        {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false, voiceMessage: { duration, waveform } },
        },
      ]),
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

  it('never enrolls or uploads compressing placeholders as defense-in-depth', async () => {
    const store = createStore();
    const room = makeRoom('!video-room:example.org', 'Video Room', true);
    const rawVideo = new File(['raw'], 'clip.mov', { type: 'video/quicktime' });
    const readyShot = new File(['enc'], 'shot.png', { type: 'application/octet-stream' });
    const placeholder: TUploadItem = {
      file: rawVideo,
      originalFile: rawVideo,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
      compression: {
        status: 'compressing',
        progressAtom: atom(0.4),
        cancel: vi.fn(),
        useOriginal: vi.fn(),
      },
    };
    const readyItem: TUploadItem = {
      file: readyShot,
      originalFile: new File(['img'], 'shot.png', { type: 'image/png' }),
      encInfo: { v: 'v2' } as never,
      metadata: { markedAsSpoiler: false },
    };
    const staged: TUploadItem[] = [placeholder, readyItem];
    let enrolled: TUploadItem[] = [];
    const attachments: RoomInputAttachmentAccess = {
      snapshot: () => ({
        staged,
        enrolled: [...enrolled],
        uploads: staged.map((i) => ({ file: i.file, status: UploadStatus.Idle })),
      }),
      append: vi.fn(),
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

    const uploadItem = vi.fn(async () => 'mxc://example.org/shot');
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const editor = withInlineElements(createEditor());
    editor.children = makeDoc();
    const s = makeMockSession();

    handoffComposerDictationSend({
      ...makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: getRoomInputDraftKey('@alice:example.org', room.roomId),
        attachments,
        sessions: { startSendSession, restoreText: vi.fn() },
      }),
      editor,
      room,
      roomId: room.roomId,
      threadingEnabled: true,
      commands: {},
      takeRootModelDraft: () => undefined,
      createVoiceUploadItems: vi.fn(async (file, duration, waveform) => [
        {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false, voiceMessage: { duration, waveform } },
        },
      ]),
      uploadItem,
      clearReplyDraft: vi.fn(),
      resetComposer: vi.fn(),
      stopTyping: vi.fn(),
    });

    expect(enrolled).toEqual([readyItem]);
    expect(uploadItem).toHaveBeenCalledTimes(1);
    expect(uploadItem).toHaveBeenCalledWith(readyItem);

    await act(async () => {
      s.resolveFinish({ status: 'completed', text: 'Check the screenshot' });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(startSendSession).toHaveBeenCalledTimes(1));
    expect(startSendSession.mock.calls[0]?.[0]?.batch?.fileItems).toEqual([readyItem]);
  });

  it('sends failed detached dictation as voice with companion text, missingAudioPartialText, attachment, reply, rootModel, and midTurnMode, settling journal on composer handoff', async () => {
    const store = createStore();
    const room = makeRoom('!voice:example.org', 'Voice Room');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const companionFile = new File(['img'], 'photo.png', { type: 'image/png' });
    const companionItem: TUploadItem = {
      file: companionFile,
      originalFile: companionFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access } = makeAttachmentAccess([companionItem]);
    const voiceFile = new File([new Uint8Array(64)], 'voice-message.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 3_200,
      waveform: Array.from({ length: 48 }, () => 400),
      missingAudioPartialText: 'Earlier pruned words.',
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 3_200, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-voice-send', voiceAudio);
    const editor = withInlineElements(createEditor());
    editor.children = makeDoc('Prefix:');
    Transforms.select(editor, { path: [0, 0], offset: 7 });

    const rootModel = threadModelContent('@router:example.org', 'DEV1', 'fast@high');
    const uploadItem = vi.fn(async (item: TUploadItem) => {
      store.set(roomUploadAtomFamily(item.file), { mxc: `mxc://example.org/${item.file.name}` });
      return `mxc://example.org/${item.file.name}`;
    });
    const createVoiceUploadItems = vi.fn(async () => [voiceItem]);
    const sendGate = deferred<void>();
    let capturedOpts: StartRoomInputSendSessionOptions | undefined;
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      capturedOpts = opts;
      await sendGate.promise;
    });

    const entry = handoffComposerDictationSend({
      ...makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        attachments: access,
        midTurnMode: 'steer',
        explicitMidTurnMode: true,
        sessions: { startSendSession, restoreText: vi.fn() },
        createVoiceUploadItems,
        uploadItem,
      }),
      editor,
      room,
      roomId: room.roomId,
      threadingEnabled: true,
      commands: {},
      takeRootModelDraft: () => rootModel,
      createVoiceUploadItems,
      uploadItem,
      clearReplyDraft: vi.fn(),
      resetComposer: vi.fn(),
      stopTyping: vi.fn(),
    });

    // Transcription fails -> detached entry waits in failed state with journal intact.
    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 1,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });
    expect(store.get(detachedDictationSendsAtom).get(key)?.status).toBe('failed');
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    // Trigger Send as voice -> transitions to sending, prepares/uploads voice, calls startSendSession.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    expect(store.get(detachedDictationSendsAtom).get(key)?.status).toBe('sending');

    await vi.waitFor(() => expect(startSendSession).toHaveBeenCalledTimes(1));
    expect(createVoiceUploadItems).toHaveBeenCalledWith(
      voiceFile,
      3_200,
      voiceAudio.waveform,
      room
    );
    expect(access.append).toHaveBeenCalledWith(room.roomId, [voiceItem]);
    expect(capturedOpts?.completeWithinCall).toBe(false);
    expect(capturedOpts?.midTurnMode).toBe('steer');
    expect(capturedOpts?.explicitMidTurnMode).toBe(true);
    expect(capturedOpts?.rootModel).toEqual(rootModel);
    expect(capturedOpts?.textContent).toMatchObject({
      body: 'Prefix: Earlier pruned words.',
      [MID_TURN_MODE_KEY]: 'steer',
    });
    expect(capturedOpts?.composerFallback).toEqual(makeDoc('Prefix: Earlier pruned words.'));
    expect(capturedOpts?.context?.roomId).toBe(room.roomId);
    expect(capturedOpts?.batch?.fileItems).toEqual([companionItem, voiceItem]);

    // Normal room settles the dictation journal immediately on composer handoff (matching Attach as voice),
    // clears live session & detached entry, and leaves upload atom ownership with the composer board.
    expect(s.session.completeVoiceFallback).toHaveBeenCalledTimes(1);
    expect(store.get(detachedDictationSendsAtom).has(key)).toBe(false);
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-voice-send');
    expect(mocks.deleteCapture).toHaveBeenCalledTimes(1);
    expect(capturedOpts?.onUploadSent).toBeUndefined();
    expect(store.get(roomUploadAtomFamily(voiceItem.file)).status).toBe(UploadStatus.Success);

    sendGate.resolve();
    await act(async () => {
      await Promise.resolve();
    });
    expect(entry.ownerKey).toBe(key);
  });

  it('keeps detached entry failed with error message and intact journal if voice prep, upload, or send fails, then succeeds on retry', async () => {
    const store = createStore();
    const room = makeRoom('!retry-voice:example.org', 'Retry Room');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const companionFile = new File(['doc'], 'notes.txt', { type: 'text/plain' });
    const companionItem: TUploadItem = {
      file: companionFile,
      originalFile: companionFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access } = makeAttachmentAccess([companionItem]);
    access.enroll([companionItem]);
    store.set(roomUploadAtomFamily(companionItem.file), { mxc: 'mxc://example.org/notes' });

    const voiceFile = new File([new Uint8Array(64)], 'voice-message.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 2_000,
      waveform: Array.from({ length: 48 }, () => 300),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 2_000, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-voice-retry', voiceAudio);
    const onSendingChange = vi.fn();

    let prepAttempt = 0;
    const createVoiceUploadItems = vi.fn(async () => {
      prepAttempt += 1;
      if (prepAttempt === 1) throw new Error('E2EE encryption failed');
      return [voiceItem];
    });
    let uploadAttempt = 0;
    const uploadItem = vi.fn(async (item: TUploadItem) => {
      if (item.file === voiceItem.file) {
        uploadAttempt += 1;
        if (uploadAttempt === 1) throw new Error('Media upload 502');
      }
      store.set(roomUploadAtomFamily(item.file), { mxc: `mxc://example.org/${item.file.name}` });
      return `mxc://example.org/${item.file.name}`;
    });
    let sendAttempt = 0;
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      sendAttempt += 1;
      if (sendAttempt === 1) {
        // Simulate real useRoomInputSendSessionController clearing enrollments on failFast error.
        access.clearEnrollment((opts?.batch?.fileItems ?? []).map((item) => item.file));
        throw new Error('Homeserver 500');
      }
      opts?.onUploadSent?.(voiceItem.file);
    });

    const replyDraft: IReplyDraft = {
      eventId: '$reply-target',
      userId: '@bob:example.org',
      body: 'Original message',
      formattedBody: undefined,
      relation: undefined,
    };
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        sendContext: {
          roomId: room.roomId,
          room,
          threadId: undefined,
          replyDraft,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        stagedSnapshot: [companionItem],
        tracksEnrollment: true,
        attachments: access,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
          onSendingChange,
        },
        sessions: { startSendSession, restoreText: vi.fn() },
        createVoiceUploadItems,
        uploadItem,
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT failed',
      });
      await Promise.resolve();
    });

    // 1. Voice prep failure -> stays failed with error message and intact journal.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'E2EE encryption failed',
      })
    );
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(s.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(onSendingChange).not.toHaveBeenCalledWith(false);

    // 2. Voice upload failure -> stays failed with error message and intact journal.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Media upload 502',
      })
    );
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(s.session.completeVoiceFallback).not.toHaveBeenCalled();

    // 3. Matrix send failure before voice sent -> stays failed with intact journal and still-staged companion.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Homeserver 500',
      })
    );
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(s.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(onSendingChange).not.toHaveBeenCalledWith(false);

    // 4. Retry succeeds -> sends both companion + voice, deletes journal, clears entry, ends ask sending.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(store.get(detachedDictationSendsAtom).has(key)).toBe(false));
    expect(startSendSession.mock.calls[1]?.[0]?.batch?.fileItems).toEqual([
      companionItem,
      voiceItem,
    ]);
    expect(startSendSession.mock.calls[1]?.[0]?.context?.replyDraft).toEqual(replyDraft);
    expect(s.session.completeVoiceFallback).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-voice-retry');
    expect(onSendingChange).toHaveBeenCalledWith(false);
  });

  it('settles journal and restores companion text if trailing caption fails after voice was sent, and releases journal on account switch', async () => {
    const store = createStore();
    const room = makeRoom('!post-voice:example.org', 'Post Voice');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const voiceFile = new File([new Uint8Array(64)], 'voice-message.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_200,
      waveform: Array.from({ length: 48 }, () => 250),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_200, waveform: voiceAudio.waveform },
      },
    };

    // Part A: voiceItem succeeds (onUploadSent), then trailing companion text throws -> journal deleted + text restored.
    const s1 = makeMockSession('recording', 'j-trailing-text-fail', voiceAudio);
    const restoreText = vi.fn();
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      opts?.onUploadSent?.(voiceItem.file);
      throw new Error('Trailing caption failed');
    });
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s1.session,
        ownerKey: key,
        docSnapshot: makeDoc('Keep this companion note'),
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
        },
        sessions: { startSendSession, restoreText },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem: vi.fn(async () => 'mxc://example.org/voice'),
      })
    );
    await act(async () => {
      s1.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT failed',
      });
      await Promise.resolve();
    });
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(restoreText).toHaveBeenCalledTimes(1));
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-trailing-text-fail');
    expect(store.get(detachedDictationSendsAtom).has(key)).toBe(false);
    expect(restoreText).toHaveBeenCalledWith(
      { roomId: room.roomId, threadId: undefined },
      makeDoc('Keep this companion note')
    );

    // Part B: account switch mid-upload aborts sendAsVoice, resets session without deleting journal, and restores draft.
    mocks.deleteCapture.mockClear();
    const s2 = makeMockSession('recording', 'j-switch-mid-voice', voiceAudio);
    const uploadGate = deferred<string>();
    const startSend2 = vi.fn(async () => undefined);
    const switchKey = `${key}:switch`;
    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s2.session,
        ownerKey: switchKey,
        draftKey: switchKey,
        docSnapshot: makeDoc('Saved before switch'),
        sessions: { startSendSession: startSend2, restoreText: vi.fn() },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem: vi.fn(() => uploadGate.promise),
      })
    );
    await act(async () => {
      s2.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT failed',
      });
      await Promise.resolve();
    });
    store.get(detachedDictationSendsAtom).get(switchKey)!.sendAsVoice();
    await vi.waitFor(() => expect(s2.session.buildVoiceAudio).toHaveBeenCalledTimes(1));

    // Switch accounts while upload is pending.
    forgetComposerStateOfSession(store);
    uploadGate.resolve('mxc://example.org/late');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startSend2).not.toHaveBeenCalled();
    expect(s2.session.reset).toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
  });

  it('keeps entry failed and journal intact when startSendSession resolves without sending voiceItem', async () => {
    const store = createStore();
    const room = makeRoom('!noop-send:example.org', 'Noop Send');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const companionFile = new File(['a'], 'a.txt', { type: 'text/plain' });
    const companionItem: TUploadItem = {
      file: companionFile,
      originalFile: companionFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access } = makeAttachmentAccess([companionItem]);
    access.enroll([companionItem]);
    store.set(roomUploadAtomFamily(companionItem.file), { mxc: 'mxc://example.org/a' });

    const voiceFile = new File([new Uint8Array(64)], 'voice.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_500,
      waveform: Array.from({ length: 48 }, () => 200),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_500, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-zero-send', voiceAudio);
    const onSendingChange = vi.fn();
    // Resolves early without ever invoking onUploadSent(voiceItem.file).
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      access.clearEnrollment((opts?.batch?.fileItems ?? []).map((item) => item.file));
    });

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        stagedSnapshot: [companionItem],
        tracksEnrollment: true,
        attachments: access,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
          onSendingChange,
        },
        sessions: { startSendSession, restoreText: vi.fn() },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem: vi.fn(async () => 'mxc://example.org/voice'),
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Could not send voice message.',
      })
    );
    expect(s.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(onSendingChange).not.toHaveBeenCalledWith(false);
  });

  it('refuses to upload or send via Send as voice when snapshotted draft starts with an unknown or acting slash command', async () => {
    const store = createStore();
    const room = makeRoom('!cmd-voice:example.org', 'Command Room');
    const voiceFile = new File([new Uint8Array(64)], 'voice.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_500,
      waveform: Array.from({ length: 48 }, () => 200),
    };
    const commandsSnapshot: Record<string, SlashCommand> = {
      invite: {
        name: 'invite',
        description: 'Invite a user',
        source: 'app',
        run: vi.fn(async () => undefined),
      },
    };

    // 1. Unknown command (/typo secret) -> notifies onCommandProblem, does not upload/send, preserves journal & companions.
    const unknownKey = getRoomInputDraftKey('@alice:example.org', room.roomId, '$unknown');
    const onCommandProblem = vi.fn();
    const unregister = registerMountedDictationOwner(store, unknownKey, {
      insertDictatedText: vi.fn(),
      restoreText: vi.fn(),
      restoreReplyDraft: vi.fn(),
      restoreAttachments: vi.fn(),
      onCommandProblem,
      onNoSpeech: vi.fn(),
    });
    const companionFile = new File(['x'], 'x.txt', { type: 'text/plain' });
    const companionItem: TUploadItem = {
      file: companionFile,
      originalFile: companionFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access, getEnrolled } = makeAttachmentAccess([companionItem]);
    access.enroll([companionItem]);
    const sUnknown = makeMockSession('recording', 'j-cmd-unknown', voiceAudio);
    const createUnknown = vi.fn(async () => []);
    const uploadUnknown = vi.fn(async () => 'mxc://never');
    const sendUnknown = vi.fn(async () => undefined);

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sUnknown.session,
        ownerKey: unknownKey,
        docSnapshot: makeDoc('/typo secret-arg'),
        stagedSnapshot: [companionItem],
        tracksEnrollment: true,
        commandsSnapshot,
        attachments: access,
        sessions: { startSendSession: sendUnknown, restoreText: vi.fn() },
        createVoiceUploadItems: createUnknown,
        uploadItem: uploadUnknown,
      })
    );
    await act(async () => {
      sUnknown.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    store.get(detachedDictationSendsAtom).get(unknownKey)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(unknownKey)).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringContaining('/typo'),
      })
    );
    expect(onCommandProblem).toHaveBeenCalledWith('typo');
    expect(createUnknown).not.toHaveBeenCalled();
    expect(uploadUnknown).not.toHaveBeenCalled();
    expect(sendUnknown).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(sUnknown.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(getEnrolled()).toEqual([companionItem]);
    unregister();

    // 2. Acting local command (/invite @bob:example.org) -> blocked before upload/send, preserves journal.
    const actingKey = getRoomInputDraftKey('@alice:example.org', room.roomId, '$acting');
    const sActing = makeMockSession('recording', 'j-cmd-acting', voiceAudio);
    const createActing = vi.fn(async () => []);
    const uploadActing = vi.fn(async () => 'mxc://never');
    const sendActing = vi.fn(async () => undefined);

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: sActing.session,
        ownerKey: actingKey,
        docSnapshot: makeDoc('/invite @bob:example.org'),
        commandsSnapshot,
        sessions: { startSendSession: sendActing, restoreText: vi.fn() },
        createVoiceUploadItems: createActing,
        uploadItem: uploadActing,
      })
    );
    await act(async () => {
      sActing.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    store.get(detachedDictationSendsAtom).get(actingKey)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(actingKey)).toMatchObject({
        status: 'failed',
        errorMessage:
          'Slash commands cannot be sent with a voice message. Discard to edit the draft.',
      })
    );
    expect(createActing).not.toHaveBeenCalled();
    expect(uploadActing).not.toHaveBeenCalled();
    expect(sendActing).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
  });

  it('preserves thread-root continuity via real useRoomInputSendSessionController when normal-room Send as voice fails after companion root sends', async () => {
    const store = createStore();
    const roomId = '!thread-voice:example.org';
    const sentPayloads: Array<Record<string, unknown>> = [];
    let voiceAttempts = 0;
    const sendMessage = vi.fn(
      async (_r: string, content: Record<string, unknown>, _txnId: string) => {
        if (content.body === 'voice-message.wav') {
          voiceAttempts += 1;
          if (voiceAttempts === 1) throw new Error('Temporary 503');
          sentPayloads.push(content);
          return { event_id: '$ev-voice' };
        }
        sentPayloads.push(content);
        return { event_id: '$ev-photo' };
      }
    );
    const room = {
      roomId,
      name: 'Threaded Room',
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
      cancelPendingEvent: vi.fn(),
    } as unknown as MatrixClient;

    const photoFile = new File(['jpg'], 'photo.png', { type: 'image/png' });
    const photoItem: TUploadItem = {
      file: photoFile,
      originalFile: photoFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    store.set(roomUploadAtomFamily(photoFile), { mxc: 'mxc://example.org/photo' });

    const voiceFile = new File([new Uint8Array(64)], 'voice-message.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 2_100,
      waveform: Array.from({ length: 48 }, () => 300),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 2_100, waveform: voiceAudio.waveform },
      },
    };

    let staged: TUploadItem[] = [photoItem];
    let enrolled: TUploadItem[] = [];
    const listeners = new Set<() => void>();
    const access: RoomInputAttachmentAccess = {
      snapshot: () => {
        const tracked = [
          ...staged,
          ...enrolled.filter((item) => !staged.some((sItem) => sItem.file === item.file)),
        ];
        return {
          staged: [...staged],
          enrolled: [...enrolled],
          uploads: tracked.map((item) => store.get(roomUploadAtomFamily(item.file))),
        };
      },
      enroll: (items) => {
        const next = items.filter((item) => !enrolled.some((e) => e.file === item.file));
        enrolled = [...enrolled, ...next];
      },
      clearEnrollment: (files) => {
        enrolled = enrolled.filter((item) => !files.includes(item.file));
      },
      append: (_r, items) => {
        const next = items.filter((item) => !staged.some((sItem) => sItem.file === item.file));
        staged = [...staged, ...next];
        listeners.forEach((fn) => fn());
      },
      remove: (_r, files) => {
        staged = staged.filter((item) => !files.includes(item.file));
        enrolled = enrolled.filter((item) => !files.includes(item.file));
        listeners.forEach((fn) => fn());
      },
      release: (_r, files) => {
        staged = staged.filter((item) => !files.includes(item.file));
        listeners.forEach((fn) => fn());
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
          msgtype: item.metadata.voiceMessage ? 'm.audio' : 'm.image',
          body: item.file.name,
          url: mxc,
        }),
      });
      return null;
    }

    const view = render(
      <Provider store={store}>
        <SendControllerHost />
      </Provider>
    );

    const key = getRoomInputDraftKey('@alice:example.org', roomId);
    const s = makeMockSession('recording', 'j-thread-voice', voiceAudio);
    access.enroll([photoItem]);
    startDetachedDictationSend(
      makeStartInput({
        store,
        mx,
        room,
        session: s.session,
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
        stagedSnapshot: [photoItem],
        tracksEnrollment: true,
        attachments: access,
        sessions: {
          startSendSession: controller.startSendSession,
          restoreText: controller.restoreText,
        },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem: vi.fn(async (item: TUploadItem) => {
          store.set(roomUploadAtomFamily(item.file), {
            mxc: `mxc://example.org/${item.file.name}`,
          });
          return `mxc://example.org/${item.file.name}`;
        }),
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    // Click Send as voice: photo sends as thread root ($ev-photo), voice fails attempt 1 and stays on board.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]?.body).toBe('photo.png');
    expect(sentPayloads[0]?.['m.relates_to']).toBeUndefined();
    expect(staged.map((item) => item.file)).toEqual([voiceFile]);
    expect(store.get(roomUploadAtomFamily(voiceFile)).status).toBe(UploadStatus.Success);
    // Journal is already settled at composer handoff (matching Attach as voice), before sendMessage finishes.
    expect(s.session.completeVoiceFallback).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-thread-voice');
    expect(mocks.deleteCapture).toHaveBeenCalledTimes(1);

    // Retry from composer sends voiceItem INSIDE photo's thread without resending photo.
    await act(async () => {
      await controller.startSendSession();
    });
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sentPayloads).toHaveLength(2);
    expect(sentPayloads[1]?.body).toBe('voice-message.wav');
    expect(sentPayloads[1]?.['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
      event_id: '$ev-photo',
    });
    expect(staged).toEqual([]);
    expect(mocks.deleteCapture).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('keeps normal-room journal intact on pre-handoff upload failure, then settles on handoff so removing a failed card or leaving never leaves a ghost journal', async () => {
    const store = createStore();
    const roomId = '!normal-handoff-settle:example.org';
    const sendMessage = vi.fn(async () => {
      throw new Error('Matrix send 503');
    });
    const room = {
      roomId,
      name: 'Normal Settle Room',
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
      cancelPendingEvent: vi.fn(),
    } as unknown as MatrixClient;

    const voiceFile = new File([new Uint8Array(64)], 'voice-message.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_800,
      waveform: Array.from({ length: 48 }, () => 280),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_800, waveform: voiceAudio.waveform },
      },
    };

    let staged: TUploadItem[] = [];
    let enrolled: TUploadItem[] = [];
    const listeners = new Set<() => void>();
    const access: RoomInputAttachmentAccess = {
      snapshot: () => {
        const tracked = [
          ...staged,
          ...enrolled.filter((item) => !staged.some((sItem) => sItem.file === item.file)),
        ];
        return {
          staged: [...staged],
          enrolled: [...enrolled],
          uploads: tracked.map((item) => store.get(roomUploadAtomFamily(item.file))),
        };
      },
      enroll: (items) => {
        const next = items.filter((item) => !enrolled.some((e) => e.file === item.file));
        enrolled = [...enrolled, ...next];
      },
      clearEnrollment: (files) => {
        enrolled = enrolled.filter((item) => !files.includes(item.file));
      },
      append: (_r, items) => {
        const next = items.filter((item) => !staged.some((sItem) => sItem.file === item.file));
        staged = [...staged, ...next];
        listeners.forEach((fn) => fn());
      },
      remove: (_r, files) => {
        staged = staged.filter((item) => !files.includes(item.file));
        enrolled = enrolled.filter((item) => !files.includes(item.file));
        listeners.forEach((fn) => fn());
      },
      release: (_r, files) => {
        staged = staged.filter((item) => !files.includes(item.file));
        listeners.forEach((fn) => fn());
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
          msgtype: 'm.audio',
          body: item.file.name,
          url: mxc,
        }),
      });
      return null;
    }

    const view = render(
      <Provider store={store}>
        <SendControllerHost />
      </Provider>
    );

    const key = getRoomInputDraftKey('@alice:example.org', roomId);
    const s = makeMockSession('recording', 'j-normal-settle', voiceAudio);
    let uploadAttempt = 0;
    const uploadItem = vi.fn(async (item: TUploadItem) => {
      uploadAttempt += 1;
      if (uploadAttempt === 1) throw new Error('Upload 502');
      store.set(roomUploadAtomFamily(item.file), { mxc: `mxc://example.org/${item.file.name}` });
      return `mxc://example.org/${item.file.name}`;
    });

    startDetachedDictationSend(
      makeStartInput({
        store,
        mx,
        room,
        session: s.session,
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
        attachments: access,
        sessions: {
          startSendSession: controller.startSendSession,
          restoreText: controller.restoreText,
        },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem,
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    // 1. Pre-handoff upload failure -> keeps entry failed and journal 100% intact, does not stage card.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Upload 502',
      })
    );
    expect(staged).toEqual([]);
    expect(s.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    // 2. Retry uploads voice and hands off to UploadBoard -> journal is immediately deleted even though mx.sendMessage fails.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(staged.map((item) => item.file)).toEqual([voiceFile]);
    expect(store.get(detachedDictationSendsAtom).has(key)).toBe(false);
    expect(s.session.completeVoiceFallback).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-normal-settle');
    expect(mocks.deleteCapture).toHaveBeenCalledTimes(1);
    expect(mocks.releaseCapture).not.toHaveBeenCalledWith('j-normal-settle');

    // 3. Leaving and returning to the room keeps the failed voice card on UploadBoard while the
    // journal is already deleted, and removing the card leaves no undeleted ghost journal.
    view.unmount();
    const returned = render(
      <Provider store={store}>
        <SendControllerHost />
      </Provider>
    );
    expect(staged.map((item) => item.file)).toEqual([voiceFile]);
    await act(async () => {
      access.remove(roomId, [voiceFile]);
      await Promise.resolve();
    });
    expect(staged).toEqual([]);
    returned.unmount();
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-normal-settle');
    expect(mocks.deleteCapture).toHaveBeenCalledTimes(1);
    expect(mocks.releaseCapture).not.toHaveBeenCalledWith('j-normal-settle');
  });

  it('keeps failing across repeated Home Send as voice presses while an oversized PDF remains staged and excluded from prepared', async () => {
    const store = createStore();
    const room = makeRoom('!home-oversized:example.org', 'Home Oversized');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const pdfFile = new File(['big-pdf'], 'huge.pdf', { type: 'application/pdf' });
    const pdfItem: TUploadItem = {
      file: pdfFile,
      originalFile: pdfFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    let staged: TUploadItem[] = [pdfItem];
    let enrolled: TUploadItem[] = [pdfItem];
    const access: RoomInputAttachmentAccess = {
      snapshot: () => ({
        staged: [...staged],
        enrolled: [...enrolled],
        uploads: staged.map((i) => ({ file: i.file, status: UploadStatus.Idle })),
      }),
      append: vi.fn((_r, items) => {
        staged = [...staged, ...items];
      }),
      remove: vi.fn((_r, files) => {
        staged = staged.filter((i) => !files.includes(i.file));
        enrolled = enrolled.filter((i) => !files.includes(i.file));
      }),
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

    const voiceFile = new File([new Uint8Array(64)], 'voice.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_500,
      waveform: Array.from({ length: 48 }, () => 300),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_500, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-home-oversized', voiceAudio);
    // Home's prepareForSend omits the oversized PDF from prepared while leaving it staged on the board.
    const prepareAttachmentsForSend = vi.fn(async () => []);
    const createVoiceUploadItems = vi.fn(async () => [voiceItem]);
    const uploadItem = vi.fn(async () => 'mxc://example.org/voice');
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      opts?.onUploadSent?.(voiceItem.file);
    });

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        stagedSnapshot: [pdfItem],
        tracksEnrollment: true,
        attachments: access,
        ask: { agentUserId: '@mindroom_helper:example.org', canSend: () => true },
        prepareAttachmentsForSend,
        sessions: { startSendSession, restoreText: vi.fn() },
        createVoiceUploadItems,
        uploadItem,
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    // Press 1: fails immediately on companion prep without preparing or uploading the voice WAV.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Could not upload attachment.',
      })
    );
    expect(createVoiceUploadItems).not.toHaveBeenCalled();
    expect(uploadItem).not.toHaveBeenCalled();
    expect(startSendSession).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    // Press 2 (without removing huge.pdf): MUST still fail immediately without uploading the voice WAV!
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(prepareAttachmentsForSend).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Could not upload attachment.',
      })
    );
    expect(createVoiceUploadItems).not.toHaveBeenCalled();
    expect(uploadItem).not.toHaveBeenCalled();
    expect(startSendSession).not.toHaveBeenCalled();
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    // Once user removes huge.pdf, Press 3 uploads voice once, sends cleanly, and deletes journal.
    access.remove(room.roomId, [pdfFile]);
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(startSendSession).toHaveBeenCalledTimes(1));
    expect(createVoiceUploadItems).toHaveBeenCalledTimes(1);
    expect(uploadItem).toHaveBeenCalledTimes(1);
    expect(uploadItem).toHaveBeenCalledWith(voiceItem);
    expect(startSendSession.mock.calls[0]?.[0]?.batch?.fileItems).toEqual([voiceItem]);
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-home-oversized');
  });

  it('skips already-sent Home companion and reuses its created threadId when retrying Send as voice', async () => {
    const store = createStore();
    const room = makeRoom('!home-partial:example.org', 'Home Partial');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const photoFile = new File(['img'], 'photo.png', { type: 'image/png' });
    const photoItem: TUploadItem = {
      file: photoFile,
      originalFile: photoFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const { access } = makeAttachmentAccess([photoItem]);
    access.enroll([photoItem]);

    const voiceFile = new File([new Uint8Array(64)], 'voice.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_900,
      waveform: Array.from({ length: 48 }, () => 320),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_900, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-home-partial', voiceAudio);
    const rootModel = threadModelContent('@router:example.org', 'DEV1', 'fast@high');
    const onSendingChange = vi.fn();
    const onLocalEcho = vi.fn();

    let sendAttempt = 0;
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      sendAttempt += 1;
      if (sendAttempt === 1) {
        // Even if a local echo (~room:txn) fires first, createdThreadId must record ONLY the
        // real server rootEventId from onUploadSent.
        opts?.onLocalEchoCreated?.('~home-partial:txn-1', room);
        opts?.onUploadSent?.(photoItem.file, '$root-home-photo');
        throw new Error('Voice send 503');
      }
      opts?.onUploadSent?.(voiceItem.file, '$root-home-photo');
    });

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        stagedSnapshot: [photoItem],
        tracksEnrollment: true,
        rootModel,
        attachments: access,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
          onLocalEcho,
          onSendingChange,
        },
        prepareAttachmentsForSend: vi.fn(async (_r, items) => items),
        sessions: { startSendSession, restoreText: vi.fn() },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem: vi.fn(async () => 'mxc://example.org/upload'),
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    // Attempt 1: photo sends & creates thread $root-home-photo, voice fails -> stays failed, journal intact.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Voice send 503',
      })
    );
    expect(startSendSession.mock.calls[0]?.[0]?.batch?.fileItems).toEqual([photoItem, voiceItem]);
    expect(startSendSession.mock.calls[0]?.[0]?.context?.threadId).toBeUndefined();
    expect(startSendSession.mock.calls[0]?.[0]?.rootModel).toEqual(rootModel);
    expect(mocks.deleteCapture).not.toHaveBeenCalled();

    // Attempt 2: skips already-sent photo, sends ONLY voiceItem inside $root-home-photo with rootModel: null.
    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(store.get(detachedDictationSendsAtom).has(key)).toBe(false));
    expect(onLocalEcho).toHaveBeenCalledWith('~home-partial:txn-1', room);
    expect(startSendSession.mock.calls[1]?.[0]?.batch?.fileItems).toEqual([voiceItem]);
    expect(startSendSession.mock.calls[1]?.[0]?.context?.threadId).toBe('$root-home-photo');
    expect(startSendSession.mock.calls[1]?.[0]?.rootModel).toBeNull();
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-home-partial');
    expect(onSendingChange).toHaveBeenCalledWith(false);
  });

  it('passes composerFallback: [] on Home to prevent live draft duplication and maps internal busy controller errors cleanly', async () => {
    const store = createStore();
    const room = makeRoom('!busy-voice:example.org', 'Busy Room');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const voiceFile = new File([new Uint8Array(64)], 'voice.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_800,
      waveform: Array.from({ length: 48 }, () => 350),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_800, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-busy-voice', voiceAudio);

    let capturedOpts: StartRoomInputSendSessionOptions | undefined;
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      capturedOpts = opts;
      throw new Error('Cannot start a lifecycle-complete send while another session is active.');
    });

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        docSnapshot: makeDoc('Companion text'),
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
        },
        sessions: { startSendSession, restoreText: vi.fn() },
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem: vi.fn(async () => 'mxc://example.org/voice'),
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() =>
      expect(store.get(detachedDictationSendsAtom).get(key)).toMatchObject({
        status: 'failed',
        errorMessage: 'Could not send voice message.',
      })
    );
    expect(capturedOpts?.composerFallback).toEqual([]);
    expect(mocks.deleteCapture).not.toHaveBeenCalled();
    expect(s.session.completeVoiceFallback).not.toHaveBeenCalled();
  });

  it('omits a Home companion withdrawn while the voice WAV is uploading instead of re-enrolling and sending it', async () => {
    const store = createStore();
    const room = makeRoom('!home-withdrawn:example.org', 'Home Withdrawn');
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const withdrawnFile = new File(['pdf'], 'withdrawn.pdf', { type: 'application/pdf' });
    const withdrawnItem: TUploadItem = {
      file: withdrawnFile,
      originalFile: withdrawnFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    const voiceFile = new File([new Uint8Array(64)], 'voice.wav', { type: 'audio/wav' });
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration: 1_500,
      waveform: Array.from({ length: 48 }, () => 300),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: {
        markedAsSpoiler: false,
        voiceMessage: { duration: 1_500, waveform: voiceAudio.waveform },
      },
    };
    const s = makeMockSession('recording', 'j-home-withdrawn', voiceAudio);

    let staged: TUploadItem[] = [withdrawnItem];
    const clearEnrollment = vi.fn();
    const attachments: RoomInputAttachmentAccess = {
      snapshot: () => ({ staged: [...staged], enrolled: [...staged], uploads: [] }),
      subscribe: () => () => undefined,
      append: vi.fn(),
      remove: vi.fn(),
      release: vi.fn(),
      enroll: vi.fn(),
      clearEnrollment,
      protectPasteItems: () => () => undefined,
    };

    let releaseVoiceUpload!: () => void;
    const uploadItem = vi.fn(async (item: TUploadItem) => {
      if (item.file === voiceFile) {
        await new Promise<void>((resolve) => {
          releaseVoiceUpload = resolve;
        });
      }
      store.set(roomUploadAtomFamily(item.file), { mxc: `mxc://example.org/${item.file.name}` });
      return `mxc://example.org/${item.file.name}`;
    });
    const startSendSession = vi.fn(async (opts?: StartRoomInputSendSessionOptions) => {
      opts?.onUploadSent?.(voiceFile, '$ev-voice-only');
    });

    startDetachedDictationSend(
      makeStartInput({
        store,
        room,
        session: s.session,
        ownerKey: key,
        stagedSnapshot: [withdrawnItem],
        tracksEnrollment: false,
        attachments,
        ask: {
          agentUserId: '@mindroom_helper:example.org',
          canSend: () => true,
        },
        sessions: { startSendSession, restoreText: vi.fn() },
        prepareAttachmentsForSend: vi.fn(async (_target, items) => items ?? []),
        createVoiceUploadItems: vi.fn(async () => [voiceItem]),
        uploadItem,
      })
    );

    await act(async () => {
      s.resolveFinish({
        status: 'failed',
        failedSegments: 1,
        completedSegments: 0,
        errorMessage: 'STT offline',
      });
      await Promise.resolve();
    });

    store.get(detachedDictationSendsAtom).get(key)!.sendAsVoice();
    await vi.waitFor(() => expect(releaseVoiceUpload).toBeTypeOf('function'));

    // User removes withdrawn.pdf from the Home board while voice.wav is uploading.
    staged = [];
    releaseVoiceUpload();

    await vi.waitFor(() => expect(startSendSession).toHaveBeenCalledTimes(1));
    expect(startSendSession.mock.calls[0]?.[0]?.batch?.fileItems).toEqual([voiceItem]);
    expect(clearEnrollment).toHaveBeenCalledWith([withdrawnFile]);
    expect(mocks.deleteCapture).toHaveBeenCalledWith('j-home-withdrawn');
  });
});

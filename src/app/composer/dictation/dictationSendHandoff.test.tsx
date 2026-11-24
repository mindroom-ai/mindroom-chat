// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { createEditor, Node, Transforms, type Descendant, type Editor } from 'slate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMentionElement, withInlineElements } from '../../editor/utils';
import { MID_TURN_MODE_KEY } from '../../matrix/protocol/midTurn';
import { UploadStatus, type TUploadItem } from '../../matrix/state/upload';
import type { SlashCommand } from '../commands/useCommands';
import type { RoomInputAttachmentAccess } from '../roomInputAttachmentAccess';
import type { StartRoomInputSendSessionOptions } from '../useRoomInputSendSessionController';
import {
  activeDictationAtom,
  detachedDictationErrorAtom,
  detachedDictationSendsAtom,
  forgetComposerStateOfSession,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
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
import type { DictationFinishResult, DictationSession, DictationSnapshot } from './dictationSession';
import { useRoomInputDictation } from './useRoomInputDictation';

const mocks = vi.hoisted(() => ({
  sessionsList: [{ userId: '@alice:example.org' }] as Array<{ userId: string }>,
  dictationServer: {
    available: true,
    confirmed: true,
    sessions: { baseUrl: 'https://mr.test', getToken: vi.fn(async () => 'tok'), invalidate: vi.fn() },
  },
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
vi.mock('../../messages/content/voice/VoiceWaveform', () => ({ VoiceWaveform: () => <div data-testid="waveform" /> }));
vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({ useLiquidGlass: () => ({ current: null }) }));
vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) => children(() => undefined),
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
const readEditorText = (editor: Editor): string => editor.children.map((n) => Node.string(n)).join('\n');
const makeRoom = (roomId = '!room:example.org', name = 'General'): Room =>
  ({ roomId, name, hasEncryptionStateEvent: () => false, getMembers: () => [] }) as unknown as Room;

const makeMockSession = (initialPhase: DictationSnapshot['phase'] = 'recording') => {
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
      return partial;
    }),
    discard: vi.fn(() => setSnap({ phase: 'idle' })),
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
  const ownerKey = overrides.ownerKey ?? getRoomInputDraftKey('@alice:example.org', room.roomId, threadId);
  return {
    mx: { getRoom: vi.fn(() => room) } as unknown as MatrixClient,
    ownerKey,
    draftKey: ownerKey,
    roomName: room.name,
    sendContext: { roomId: room.roomId, room, threadId, replyDraft: undefined, threadingEnabled: true, signalBridgedRoom: false },
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
});

afterEach(() => cleanup());

describe('dictationAudioCapture immediate mic release', () => {
  it('stops media stream tracks synchronously in stopAndFlush before worklet ack', async () => {
    const trackStop = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
      getAudioTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: trackStop }],
    } as unknown as MediaStream;

    let workletPortOnMessage: ((e: MessageEvent) => void) | null = null;
    const postMessage = vi.fn();
    class FakeWorkletNode {
      port = {
        get onmessage() { return workletPortOnMessage; },
        set onmessage(fn: ((e: MessageEvent) => void) | null) { workletPortOnMessage = fn; },
        postMessage,
      };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    const prevWorklet = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeWorkletNode });
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
      Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: prevWorklet });
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
        children: [{ text: 'Hey ' }, createMentionElement('@bob:example.org', 'Bob', false), { text: '' }],
      } as unknown as Descendant,
    ];
    Transforms.select(editor, { path: [0, 2], offset: 0 });
    editor.marks = { bold: true };

    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    const fileItem: TUploadItem = { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
    const { access } = makeAttachmentAccess([fileItem]);
    const uploadItem = vi.fn(async () => 'mxc://x/photo');
    const resetComposer = vi.fn();
    const stopTyping = vi.fn();
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const { session, resolveFinish } = makeMockSession();
    const keyA = getRoomInputDraftKey('@alice:example.org', room.roomId, '$threadA');
    store.set(activeDictationAtom, `${keyA}:view-1`);

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
      ownershipKey: `${keyA}:view-1`,
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
    expect(store.get(activeDictationAtom)).toBeUndefined();
    expect(store.get(detachedDictationSendsAtom).get(keyA)?.status).toBe('sending');
    expect(access.enroll).toHaveBeenCalledWith([fileItem]);
    expect(uploadItem).toHaveBeenCalledWith(fileItem);
    expect(resetComposer).toHaveBeenCalledTimes(1);
    expect(stopTyping).toHaveBeenCalledTimes(1);

    // Thread B immediately claims dictation while Thread A finishes in background.
    store.set(activeDictationAtom, 'thread-B');
    await act(async () => {
      resolveFinish({ status: 'completed', text: 'check this photo' });
      await Promise.resolve();
    });

    expect(store.get(detachedDictationSendsAtom).size).toBe(0);
    expect(store.get(activeDictationAtom)).toBe('thread-B');
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
    const fileItem: TUploadItem = { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };

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
        sendContext: { roomId: room.roomId, room, threadId: '$threadA', replyDraft, threadingEnabled: true, signalBridgedRoom: false },
        composerContext: { roomId: room.roomId, threadId: '$threadA' },
        docSnapshot: makeDoc('Intro'),
        stagedSnapshot: [fileItem],
        tracksEnrollment: true,
        attachments: acc1.access,
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    const notice = render(<Provider store={store}><DictationSendErrorNotice /></Provider>);
    await act(async () => {
      s1.resolveFinish({ status: 'failed', failedSegments: 1, completedSegments: 1, errorMessage: 'Timeout' });
      await Promise.resolve();
    });
    expect(startSendSession).not.toHaveBeenCalled();
    expect(store.get(detachedDictationErrorAtom)).toEqual({ ownerKey: keyA, roomName: 'Design' });
    expect(screen.getByRole('alert').textContent).toContain('composer.dictation.sendFailedOffThread:Design');

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
    const reopened = render(<Provider store={store}><Reopened viewId="view-2" /></Provider>);
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
    startDetachedDictationSend(makeStartInput({ store, room, session: s2.session, ownerKey: keyA, docSnapshot: makeDoc('Base') }));
    await act(async () => {
      s2.resolveFinish({ status: 'failed', failedSegments: 1, completedSegments: 1, errorMessage: 'Down' });
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
        sendContext: { roomId: room.roomId, room, threadId: '$threadA', replyDraft, threadingEnabled: true, signalBridgedRoom: false },
        docSnapshot: makeDoc('Original draft'),
        stagedSnapshot: [fileItem],
        tracksEnrollment: true,
        attachments: acc3.access,
        restoreReplyDraft: restoreReply,
      })
    );
    await act(async () => {
      s3.resolveFinish({ status: 'failed', failedSegments: 1, completedSegments: 0, errorMessage: 'Down' });
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('composer.dictation.discard'));
    expect(readEditorText(editor2)).toBe('Original draft');
    expect(restoreReply).toHaveBeenCalledWith(replyDraft);
    expect(restoreAttachments).toHaveBeenCalledWith(room.roomId, [fileItem]);
    expect(acc3.getEnrolled()).toEqual([]);
    reopened.unmount();
    notice.unmount();
  });

  it('aborts on account switch, restores pre-existing draft to old account only, and sends nothing', async () => {
    const store = createStore();
    const room = makeRoom();
    const key = getRoomInputDraftKey('@alice:example.org', room.roomId);
    const s = makeMockSession();
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
    expect(s.session.discard).toHaveBeenCalledTimes(1);
    expect(store.get(detachedDictationSendsAtom).size).toBe(0);
    expect(store.get(roomIdToMsgDraftAtomFamily(key))).toEqual(makeDoc('Saved before switch'));

    await act(async () => {
      s.resolveFinish({ status: 'completed', text: 'should never send' });
      await Promise.resolve();
    });
    expect(startSendSession).not.toHaveBeenCalled();
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
    render(<Provider store={store}><MountedComposer /></Provider>);

    // Empty speech + empty composer -> no send + no-speech banner.
    const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
      async () => undefined
    );
    const sEmpty = makeMockSession();
    startDetachedDictationSend(makeStartInput({ store, room, session: sEmpty.session, ownerKey: key, sessions: { startSendSession, restoreText: vi.fn() } }));
    await act(async () => {
      sEmpty.resolveFinish({ status: 'completed', text: '   ' });
      await Promise.resolve();
    });
    expect(startSendSession).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('composer.dictation.noSpeech');

    // Empty speech + existing text -> sends existing text normally.
    const sExisting = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({ store, room, session: sExisting.session, ownerKey: key, docSnapshot: makeDoc('Existing text'), sessions: { startSendSession, restoreText: vi.fn() } })
    );
    await act(async () => {
      sExisting.resolveFinish({ status: 'completed', text: '' });
      await Promise.resolve();
    });
    expect(startSendSession).toHaveBeenCalledWith(expect.objectContaining({ textContent: expect.objectContaining({ body: 'Existing text' }) }));

    // Acting (/leave) and unknown (/bogus) commands restore for review instead of running silently.
    const leaveRun = vi.fn(async () => undefined);
    const commandsSnapshot: Record<string, SlashCommand> = {
      leave: { name: 'leave', description: 'Leave', source: 'app', run: leaveRun },
    };
    startSendSession.mockClear();
    const sActing = makeMockSession();
    startDetachedDictationSend(
      makeStartInput({ store, room, session: sActing.session, ownerKey: key, docSnapshot: makeDoc('/leave'), commandsSnapshot, sessions: { startSendSession, restoreText: vi.fn() } })
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
      makeStartInput({ store, room, session: sUnknown.session, ownerKey: key, docSnapshot: makeDoc('/bogus'), commandsSnapshot, sessions: { startSendSession, restoreText: vi.fn() } })
    );
    await act(async () => {
      sUnknown.resolveFinish({ status: 'completed', text: 'arg' });
      await Promise.resolve();
    });
    expect(onCommandProblem).toHaveBeenCalledWith('featureUi.room.commandAutocomplete.unknown:/bogus');
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
        ask: { agentUserId: '@mindroom_helper:example.org', canSend: () => true, onSendingChange, onLocalEcho },
        sessions: { startSendSession, restoreText: vi.fn() },
      })
    );
    await act(async () => {
      sAsk.resolveFinish({ status: 'completed', text: 'summarize today' });
      await Promise.resolve();
    });
    expect(startSendSession.mock.calls[0]![0]!.textContent?.['m.mentions']?.user_ids).toContain('@mindroom_helper:example.org');
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
});

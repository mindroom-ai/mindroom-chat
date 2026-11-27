// @vitest-environment jsdom
import React, { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { createEditor, Editor, Node, Transforms, type Descendant } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { ReactEditor, withReact } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessions } from '../../computer/clientSessions';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { createSessionId } from '../../matrix/session/sessions';
import type { TUploadItem } from '../../matrix/state/upload';
import { ConversationViewContext, HOME_ASK_VIEW } from '../../navigation/conversationView';
import { pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { LiveCaptureIndicator } from '../capture/LiveCaptureIndicator';
import {
  endLiveCapturesOfAccount,
  liveCaptureAtom,
  liveCaptureCapsulesShownAtom,
  restoreLiveCapture,
} from '../capture/liveCapture';
import type { RoomInputAttachmentAccess } from '../roomInputAttachmentAccess';
import {
  composersHoldUnsavedWork,
  detachedDictationSendsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
  voiceAutoSendPendingAtom,
} from '../roomInputDrafts';
import { voiceDraftRestoresAtom } from '../voice/savedVoiceDraft';
import type { VoiceCaptureSession } from '../voice/voiceCaptureSession';
import { DICTATION_FRAME_SAMPLES, encodePcm16Wav } from './dictationSegmenter';
import { startDetachedDictationSend } from './dictationSendHandoff';
import {
  createDictationSession,
  type DictationFinishResult,
  type DictationSession,
  type DictationSnapshot,
  type DictationVoiceAudio,
} from './dictationSession';
import { insertDictatedText } from './insertDictatedText';
import { dictationRestoresAtom } from './startLiveDictation';
import {
  useRoomInputDictation,
  type RoomInputDictationFeature,
  type UseRoomInputDictationOptions,
} from './useRoomInputDictation';

const serverMock = vi.hoisted(
  (): {
    available: boolean;
    confirmed: boolean;
    temporarilyUnavailable: boolean;
    apiUrl: string;
    byRoom: Map<
      string,
      {
        available: boolean;
        confirmed: boolean;
        temporarilyUnavailable?: boolean;
        apiUrl?: string;
        sessions?: ClientSessions;
      }
    >;
    overlay: 'none' | 'help' | 'other';
    defaultSessions: ClientSessions;
    sessions: ClientSessions | undefined;
    lastTooltipProps: { label?: string; shortcut?: string } | undefined;
    deleteCapture: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
    releaseCapture: ReturnType<typeof vi.fn<(id: string) => void>>;
  } => {
    const defaultSessions = { send: vi.fn() } as unknown as ClientSessions;
    return {
      available: true,
      confirmed: true,
      temporarilyUnavailable: false,
      apiUrl: 'https://mr.example',
      byRoom: new Map(),
      overlay: 'none',
      defaultSessions,
      sessions: defaultSessions,
      lastTooltipProps: undefined,
      deleteCapture: vi.fn(async () => undefined),
      releaseCapture: vi.fn(() => undefined),
    };
  }
);

vi.mock('../capture/captureJournal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../capture/captureJournal')>()),
  deleteCapture: (id: string) => serverMock.deleteCapture(id),
  releaseCapture: (id: string) => serverMock.releaseCapture(id),
}));

vi.mock('../../shortcuts/shortcutDom', () => ({
  openOverlay: () => serverMock.overlay,
}));

vi.mock('./useDictationServer', () => ({
  useDictationServer: (roomId?: string) => {
    const override = roomId ? serverMock.byRoom.get(roomId) : undefined;
    if (override) {
      return {
        available: override.available,
        confirmed: override.available && override.confirmed,
        temporarilyUnavailable: override.temporarilyUnavailable ?? false,
        apiUrl: override.apiUrl,
        roomId,
        sessions: override.sessions,
      };
    }
    return {
      available: serverMock.available,
      confirmed: serverMock.available && serverMock.confirmed,
      temporarilyUnavailable: serverMock.temporarilyUnavailable,
      apiUrl: serverMock.available && serverMock.sessions ? serverMock.apiUrl : undefined,
      roomId: roomId ?? '!room:example.org',
      sessions: serverMock.available ? serverMock.sessions : undefined,
    };
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../ui/glass/liquid/useLiquidGlass', () => ({
  useLiquidGlass: () => ({ current: null }),
}));

vi.mock('../../messages/content/voice/VoiceWaveform', () => ({
  VoiceWaveform: () => <div data-testid="waveform" />,
}));

vi.mock('../../ui/IconTooltip', () => ({
  IconTooltip: ({
    label,
    shortcut,
    children,
  }: {
    label: string;
    shortcut?: string;
    children: (ref: () => void) => React.ReactNode;
  }) => {
    serverMock.lastTooltipProps = { label, shortcut };
    return children(() => undefined);
  },
}));

const makeSlateEditor = (initialText = '') => {
  const editor = withHistory(withReact(createEditor()));
  editor.children = [{ type: 'paragraph', children: [{ text: initialText }] }] as never;
  return editor;
};

const readText = (editor: Editor): string => Editor.string(editor, []);

const createMockSession = (opts?: {
  initial?: Partial<DictationSnapshot>;
  originApiUrl?: string;
  journalId?: string;
  hasClient?: boolean;
  voiceAudio?: DictationVoiceAudio | undefined;
}) => {
  const listeners = new Set<() => void>();
  let clientAttached = opts?.hasClient ?? true;
  let originApiUrl = opts?.originApiUrl;
  let snap: DictationSnapshot = {
    phase: 'idle',
    elapsedMs: 0,
    waveform: [],
    sampleCount: 0,
    pendingUploads: 0,
    failedSegments: 0,
    completedSegments: 0,
    hasPartialText: false,
    hasVoiceAudio: false,
    previewText: '',
    capReached: false,
    interrupted: false,
    recovered: false,
    hasClient: clientAttached,
    errorMessage: undefined,
    ...opts?.initial,
  };
  const setSnap = (patch: Partial<DictationSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((fn) => fn());
  };

  let finishResult: DictationFinishResult = {
    status: 'completed',
    text: 'dictated words',
    ...(opts?.journalId ? { journalId: opts.journalId } : {}),
  };
  let finishDeferred: Promise<DictationFinishResult> | undefined;
  let discardDeferred: Promise<void> | undefined;

  const session: DictationSession = {
    getSnapshot: () => snap,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start: vi.fn(async () => {
      setSnap({ phase: 'recording', elapsedMs: 1_500 });
      return true;
    }),
    pause: vi.fn(async () => {
      setSnap({ phase: 'paused' });
    }),
    resume: vi.fn(async () => {
      setSnap({ phase: 'recording' });
      return true;
    }),
    finish: vi.fn(async () => {
      if (finishDeferred) {
        setSnap({ phase: 'finishing' });
        const result = await finishDeferred;
        if (result.status === 'completed') setSnap({ phase: 'idle' });
        else if (result.status === 'failed') setSnap({ phase: 'failed', failedSegments: 1 });
        return result;
      }
      if (finishResult.status === 'completed') setSnap({ phase: 'idle' });
      else if (finishResult.status === 'failed') setSnap({ phase: 'failed', failedSegments: 1 });
      return finishResult;
    }),
    retryFailed: vi.fn(async () => {
      setSnap({ phase: 'idle' });
      return {
        status: 'completed' as const,
        text: 'retried words',
        ...(opts?.journalId ? { journalId: opts.journalId } : {}),
      };
    }),
    takePartialText: vi.fn(() => {
      setSnap({ phase: 'idle' });
      return { text: 'partial text', ...(opts?.journalId ? { journalId: opts.journalId } : {}) };
    }),
    buildVoiceAudio: vi.fn(async () => opts?.voiceAudio),
    completeVoiceFallback: vi.fn(() => {
      setSnap({ phase: 'idle', hasVoiceAudio: false });
      return opts?.journalId ? { journalId: opts.journalId } : {};
    }),
    park: vi.fn(),
    reset: vi.fn(() => {
      setSnap({ phase: 'idle' });
    }),
    discard: vi.fn(async () => {
      if (discardDeferred) await discardDeferred;
      setSnap({ phase: 'idle' });
    }),
    attachClient: vi.fn((_client, _roomId, nextOrigin) => {
      clientAttached = true;
      if (originApiUrl === undefined && nextOrigin !== undefined) originApiUrl = nextOrigin;
      setSnap({ hasClient: true });
    }),
    hasClient: vi.fn(() => clientAttached),
    getOriginApiUrl: vi.fn(() => originApiUrl),
    getJournalId: vi.fn(() => opts?.journalId),
    clearError: vi.fn(() => {
      setSnap({ errorMessage: undefined });
    }),
  };

  return {
    session,
    setSnap,
    setFinishResult: (res: DictationFinishResult) => {
      finishResult = res;
    },
    setFinishPromise: (promise: Promise<DictationFinishResult>) => {
      finishDeferred = promise;
    },
    setDiscardPromise: (promise: Promise<void>) => {
      discardDeferred = promise;
    },
  };
};

const confirmDiscardDialog = async () => {
  const dialog = screen.getByRole('dialog');
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'mindroomUi.voice.voiceRecorderDialog.discard',
      })
    );
    await Promise.resolve();
  });
};

// jsdom has no PointerEvent and falls back to Event, which drops `buttons`.
class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? '';
  }
}

beforeEach(() => {
  serverMock.available = true;
  serverMock.confirmed = true;
  serverMock.temporarilyUnavailable = false;
  serverMock.lastTooltipProps = undefined;
  serverMock.apiUrl = 'https://mr.example';
  serverMock.byRoom.clear();
  serverMock.sessions = serverMock.defaultSessions;
  serverMock.overlay = 'none';
  serverMock.deleteCapture.mockClear();
  serverMock.releaseCapture.mockClear();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
    this: HTMLElement
  ) {
    if (!this.isConnected || this.closest('[data-hidden="true"]')) {
      return [] as unknown as DOMRectList;
    }
    return [{}] as unknown as DOMRectList;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe('insertDictatedText', () => {
  it('inserts text atomically with smart spacing, glued punctuation, and single-step undo', () => {
    const editor = makeSlateEditor('Hello');
    Transforms.select(editor, { path: [0, 0], offset: 5 });

    // Adjacent to non-whitespace -> adds leading space.
    expect(insertDictatedText(editor, 'world', editor.selection)).toBe(true);
    expect(readText(editor)).toBe('Hello world');

    // Single undo reverts the entire dictated insertion atomically.
    editor.undo();
    expect(readText(editor)).toBe('Hello');

    // Glued leading punctuation attaches without leading space.
    Transforms.select(editor, { path: [0, 0], offset: 5 });
    insertDictatedText(editor, ', friend!', editor.selection);
    expect(readText(editor)).toBe('Hello, friend!');

    // Inserting in the middle between two words adds smart spacing on both sides.
    const mid = makeSlateEditor('Hello world');
    Transforms.select(mid, { path: [0, 0], offset: 6 });
    insertDictatedText(mid, 'beautiful', mid.selection);
    expect(readText(mid)).toBe('Hello beautiful world');

    // Inserting right before a comma does not add a trailing space before punctuation.
    const beforeComma = makeSlateEditor('Hello, world');
    Transforms.select(beforeComma, { path: [0, 0], offset: 5 });
    insertDictatedText(beforeComma, 'dear', beforeComma.selection);
    expect(readText(beforeComma)).toBe('Hello dear, world');
  });

  it('replaces selected text and restores the original selection in a single undo step', () => {
    const editor = makeSlateEditor('red apples');
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    });

    expect(insertDictatedText(editor, 'green', editor.selection)).toBe(true);
    expect(readText(editor)).toBe('green apples');

    HistoryEditor.undo(editor);
    expect(readText(editor)).toBe('red apples');
  });

  it('skips spaces around CJK characters and CJK punctuation', () => {
    const editor = makeSlateEditor('你好。');
    Transforms.select(editor, { path: [0, 0], offset: 2 });
    insertDictatedText(editor, '世界', editor.selection);
    expect(readText(editor)).toBe('你好世界。');
  });

  it('reads trailing spacing from the end block on multi-block replacements', () => {
    const editor = withHistory(withReact(createEditor()));
    editor.children = [
      { type: 'paragraph', children: [{ text: 'First' }] },
      { type: 'paragraph', children: [{ text: 'second' }] },
    ] as never;
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    });

    expect(insertDictatedText(editor, 'replacement', editor.selection)).toBe(true);
    expect(readText(editor)).toBe('replacement second');
  });

  it('inserts at saved selection or document end with single-step undo without focusing when focus is false', () => {
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    try {
      // Point insertion at document end when editor.selection is null (never focused).
      const unfocused = makeSlateEditor('Hello');
      expect(unfocused.selection).toBeNull();
      expect(insertDictatedText(unfocused, 'world', null, { focus: false })).toBe(true);
      expect(readText(unfocused)).toBe('Hello world');
      expect(focusSpy).not.toHaveBeenCalled();

      unfocused.undo();
      expect(readText(unfocused)).toBe('Hello');

      // Range replacement with focus: false still reverts in one undo step without focusing.
      const rangeEditor = makeSlateEditor('red apples');
      const savedRange = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      };
      expect(insertDictatedText(rangeEditor, 'green', savedRange, { focus: false })).toBe(true);
      expect(readText(rangeEditor)).toBe('green apples');
      expect(focusSpy).not.toHaveBeenCalled();

      HistoryEditor.undo(rangeEditor);
      expect(readText(rangeEditor)).toBe('red apples');

      // focus: true selects, inserts with single-step undo, and focuses the editor.
      const focused = makeSlateEditor('red apples');
      expect(insertDictatedText(focused, 'blue', savedRange, { focus: true })).toBe(true);
      expect(readText(focused)).toBe('blue apples');
      expect(focusSpy).toHaveBeenCalledWith(focused);

      HistoryEditor.undo(focused);
      expect(readText(focused)).toBe('red apples');
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('preserves pending spoiler mark on unfocused insertion with or without an existing selection', () => {
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    try {
      // Existing collapsed selection with pending spoiler mark.
      const withSelection = makeSlateEditor();
      Transforms.select(withSelection, { path: [0, 0], offset: 0 });
      Editor.addMark(withSelection, 'spoiler', true);
      expect(
        insertDictatedText(withSelection, 'secret', withSelection.selection, { focus: false })
      ).toBe(true);
      expect(readText(withSelection)).toBe('secret');
      const selectedLeaves = [...Node.texts(withSelection)].map(([leaf]) => leaf);
      expect(selectedLeaves).toContainEqual({ text: 'secret', spoiler: true });
      expect(focusSpy).not.toHaveBeenCalled();

      // Null selection with pending spoiler mark.
      const withoutSelection = makeSlateEditor();
      withoutSelection.marks = { spoiler: true };
      expect(withoutSelection.selection).toBeNull();
      expect(insertDictatedText(withoutSelection, 'hidden', null, { focus: false })).toBe(true);
      expect(readText(withoutSelection)).toBe('hidden');
      const nullSelLeaves = [...Node.texts(withoutSelection)].map(([leaf]) => leaf);
      expect(nullSelLeaves).toContainEqual({ text: 'hidden', spoiler: true });
      expect(focusSpy).not.toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
    }
  });
});

describe('useRoomInputDictation', () => {
  const renderHarness = (
    editor: Editor,
    store: ReturnType<typeof createStore>,
    session: DictationSession,
    extraChild?: React.ReactNode,
    hookOverrides?: Partial<UseRoomInputDictationOptions>
  ) => {
    let latest!: RoomInputDictationFeature;
    function Harness({ tick: _tick }: { tick: number }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId: '!room:example.org',
        ownerKey: 'composer-1',
        rootRef,
        createSession: () => session,
        ...hookOverrides,
      });
      return (
        <div ref={rootRef}>
          <input data-testid="editor-focus" />
          {extraChild}
          {latest.capsule}
          {latest.button}
        </div>
      );
    }
    let tick = 0;
    const utils = render(
      <Provider store={store}>
        <Harness tick={tick} />
      </Provider>
    );
    return {
      ...utils,
      forceRerender: () => {
        tick += 1;
        utils.rerender(
          <Provider store={store}>
            <Harness tick={tick} />
          </Provider>
        );
      },
      getFeature: () => latest,
    };
  };

  it('hides the button completely when dictation is unavailable', () => {
    serverMock.available = false;
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();

    const { getFeature } = renderHarness(editor, store, session);
    expect(getFeature().available).toBe(false);
    expect(getFeature().button).toBeNull();
    expect(screen.queryByLabelText('composer.dictation.label')).toBeNull();
  });

  it('renders the button disabled while seeded availability is unconfirmed and enables once confirmed', () => {
    serverMock.available = true;
    serverMock.confirmed = false;
    serverMock.sessions = undefined;
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();

    const { getFeature, forceRerender } = renderHarness(editor, store, session);
    const input = screen.getByTestId('editor-focus');
    input.focus();
    const btn = screen.getByLabelText<HTMLButtonElement>('composer.dictation.label');
    expect(getFeature().available).toBe(true);
    expect(btn.disabled).toBe(true);
    expect(getFeature().start()).toBe(false);
    expect(session.start).not.toHaveBeenCalled();

    // Shortcut does not swallow keystrokes before confirmation.
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'D',
      code: 'KeyD',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(keyEvent);
    expect(keyEvent.defaultPrevented).toBe(false);

    // Sessions resolving while /status is still in flight still keeps Dictate disabled.
    serverMock.sessions = serverMock.defaultSessions;
    forceRerender();
    expect(btn.disabled).toBe(true);
    expect(getFeature().start()).toBe(false);

    // Once confirmed with sessions, button enables and start() works.
    serverMock.confirmed = true;
    forceRerender();
    expect(btn.disabled).toBe(false);
    act(() => {
      expect(getFeature().start()).toBe(true);
    });
    expect(session.start).toHaveBeenCalledTimes(1);
  });

  it('keeps the mic button visible and disabled with reconnecting label and no shortcut when temporarilyUnavailable', () => {
    serverMock.available = true;
    serverMock.confirmed = false;
    serverMock.temporarilyUnavailable = true;
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();

    const { getFeature, forceRerender } = renderHarness(editor, store, session);
    const btn = screen.getByLabelText<HTMLButtonElement>(
      'composer.dictation.temporarilyUnavailable'
    );
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(serverMock.lastTooltipProps).toEqual({
      label: 'composer.dictation.temporarilyUnavailable',
      shortcut: undefined,
    });
    expect(getFeature().start()).toBe(false);
    expect(session.start).not.toHaveBeenCalled();

    serverMock.temporarilyUnavailable = false;
    serverMock.confirmed = true;
    forceRerender();
    const recoveredBtn = screen.getByLabelText<HTMLButtonElement>('composer.dictation.label');
    expect(recoveredBtn.disabled).toBe(false);
    expect(serverMock.lastTooltipProps).toEqual({
      label: 'composer.dictation.label',
      shortcut: 'dictate',
    });
  });

  it('enforces mutual exclusion through shared liveCaptureAtom', async () => {
    const editor = makeSlateEditor('Start');
    Transforms.select(editor, { path: [0, 0], offset: 5 });
    const store = createStore();
    const { session } = createMockSession({ journalId: 'j-mutual' });

    const { getFeature } = renderHarness(editor, store, session);
    const btn = screen.getByLabelText<HTMLButtonElement>('composer.dictation.label');
    expect(btn.disabled).toBe(false);

    // Voice message recording running -> dictation button disabled and start blocked.
    act(() => {
      store.set(liveCaptureAtom, { kind: 'voice', session: {} as VoiceCaptureSession });
    });
    expect(btn.disabled).toBe(true);
    expect(getFeature().start()).toBe(false);

    act(() => {
      store.set(liveCaptureAtom, undefined);
    });
    expect(btn.disabled).toBe(false);

    // Starting dictation claims liveCaptureAtom and enables direct Finish & Send.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(store.get(liveCaptureAtom)).toEqual({ kind: 'dictation', session });
    expect(getFeature().canSend).toBe(true);
    expect(getFeature().blocksSubmit).toBe(false);

    // Finishing inserts text atomically, deletes journal, and releases liveCaptureAtom.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    });
    expect(readText(editor)).toBe('Start dictated words');
    expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-mutual');
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(getFeature().blocksSubmit).toBe(false);
  });

  it('supports Escape to cancel and Mod+Shift+D to start/finish dictation', async () => {
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();

    renderHarness(editor, store, session);
    const input = screen.getByTestId('editor-focus');
    input.focus();

    // Start via Ctrl+Shift+D (non-Mac jsdom default).
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(session.start).toHaveBeenCalledTimes(1);

    // Escape is ignored while an overlay (e.g. command palette / menu) is open.
    serverMock.overlay = 'other';
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(session.discard).not.toHaveBeenCalled();
    serverMock.overlay = 'none';

    // Escape is ignored when focus is outside the composer.
    input.blur();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(session.discard).not.toHaveBeenCalled();

    // Escape opens DiscardCaptureDialog when focus is inside the composer; cancelling keeps session.
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    input.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(session.discard).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'mindroomUi.voice.voiceRecorderDialog.cancel',
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.get(liveCaptureAtom)?.kind).toBe('dictation');

    // Escape + confirming Discard discards session and returns focus to Slate.
    input.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await confirmDiscardDialog();
    expect(session.discard).toHaveBeenCalledTimes(1);
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalledWith(editor);
    focusSpy.mockRestore();

    // Start again and finish via Ctrl+Shift+D.
    input.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(session.start).toHaveBeenCalledTimes(2));
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(session.finish).toHaveBeenCalledTimes(1);
    expect(readText(editor)).toBe('dictated words');
  });

  it('tracks selection via Slate RangeRef when text is edited before the cursor mid-dictation', async () => {
    const editor = makeSlateEditor('Hello world');
    Transforms.select(editor, { path: [0, 0], offset: 5 });
    const store = createStore();
    const { session } = createMockSession();

    renderHarness(editor, store, session);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.label'));
    });

    // Edit text before the saved cursor while dictation is running.
    Transforms.insertText(editor, 'Hey ', { at: { path: [0, 0], offset: 0 } });
    expect(readText(editor)).toBe('Hey Hello world');

    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    });
    expect(readText(editor)).toBe('Hey Hello dictated words world');
  });

  it('keeps RangeRef live during Finish so editing before the selection while finishing still replaces the right word', async () => {
    const editor = makeSlateEditor('red blue');
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 8 },
    });
    const store = createStore();
    let resolveFinish!: (res: DictationFinishResult) => void;
    const mock = createMockSession({ journalId: 'j-live-range' });
    mock.setFinishPromise(
      new Promise<DictationFinishResult>((resolve) => {
        resolveFinish = resolve;
      })
    );

    renderHarness(editor, store, mock.session);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.label'));
    });

    // Press Finish while "blue" is selected, then prepend "very " BEFORE transcription finishes.
    fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    Transforms.insertText(editor, 'very ', { at: { path: [0, 0], offset: 0 } });
    expect(readText(editor)).toBe('very red blue');

    await act(async () => {
      resolveFinish({ status: 'completed', text: 'green', journalId: 'j-live-range' });
      await Promise.resolve();
    });
    // Live RangeRef tracked the prepend -> replaced "blue", NOT " red"!
    expect(readText(editor)).toBe('very red green');
    expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-live-range');
  });

  it('lets an inline AutocompleteMenu listbox consume Escape before dictation', async () => {
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();

    renderHarness(editor, store, session, <div role="listbox" data-testid="autocomplete" />);
    const input = screen.getByTestId('editor-focus');
    input.focus();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.label'));
    });
    expect(session.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(session.discard).not.toHaveBeenCalled();
  });

  it('continues across unmount and room switches, shows pill in Settings, and finishes in a room without dictation', async () => {
    const store = createStore();
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    store.set(pageNoticeSlotAtom, slot);

    const editorA = makeSlateEditor();
    const editorB = makeSlateEditor('Room B');
    const mock = createMockSession({ journalId: 'j-nav' });

    serverMock.byRoom.set('!roomA:example.org', {
      available: true,
      confirmed: true,
      apiUrl: 'https://serverA.example',
      sessions: serverMock.defaultSessions,
    });
    serverMock.byRoom.set('!roomB:example.org', {
      available: false,
      confirmed: false,
      apiUrl: undefined,
      sessions: undefined,
    });

    let featB!: RoomInputDictationFeature;
    function Composer({
      roomId,
      editor,
      view,
      onFeat,
    }: {
      roomId: string;
      editor: Editor;
      view?: string;
      onFeat?: (f: RoomInputDictationFeature) => void;
    }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      const feat = useRoomInputDictation({
        editor,
        roomId,
        ownerKey: roomId,
        rootRef,
        createSession: () => mock.session,
      });
      onFeat?.(feat);
      const node = (
        <div ref={rootRef}>
          <input data-testid={`focus-${roomId}`} />
          {feat.capsule}
          {feat.button}
        </div>
      );
      return view ? <ConversationViewContext value={view}>{node}</ConversationViewContext> : node;
    }

    try {
      const shell = render(
        <Provider store={store}>
          <LiveCaptureIndicator />
          <Composer roomId="!roomA:example.org" editor={editorA} />
        </Provider>
      );

      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.label'));
      });
      expect(store.get(liveCaptureAtom)?.kind).toBe('dictation');
      expect(store.get(liveCaptureCapsulesShownAtom)).toBe(1);
      expect(screen.queryByTestId('live-dictation-indicator')).toBeNull();

      // Navigate to Settings (0 composers mounted): dictation stays live, pill appears!
      shell.rerender(
        <Provider store={store}>
          <LiveCaptureIndicator />
        </Provider>
      );
      expect(mock.session.discard).not.toHaveBeenCalled();
      expect(store.get(liveCaptureAtom)?.kind).toBe('dictation');
      expect(store.get(liveCaptureCapsulesShownAtom)).toBe(0);
      expect(screen.getByTestId('live-dictation-indicator')).toBeTruthy();

      // Navigate to Home ask view: capsule counts as visible so pill never duplicates!
      shell.rerender(
        <Provider store={store}>
          <LiveCaptureIndicator />
          <Composer roomId="!roomB:example.org" editor={editorB} view={HOME_ASK_VIEW} />
        </Provider>
      );
      expect(store.get(liveCaptureCapsulesShownAtom)).toBe(1);
      expect(screen.queryByTestId('live-dictation-indicator')).toBeNull();

      // Navigate to Room B where dictation is unavailable: capsule still shows, Escape works, and Finish delivers!
      shell.rerender(
        <Provider store={store}>
          <LiveCaptureIndicator />
          <Composer
            roomId="!roomB:example.org"
            editor={editorB}
            onFeat={(f) => {
              featB = f;
            }}
          />
        </Provider>
      );
      expect(screen.queryByLabelText('composer.dictation.label')).toBeNull();
      expect(screen.getByLabelText('composer.dictation.finish')).toBeTruthy();
      expect(featB.canSend).toBe(true);

      // Escape in Room B (confirmed=false!) still opens DiscardCaptureDialog; cancel preserves dictation.
      screen.getByTestId('focus-!roomB:example.org').focus();
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(screen.getByRole('dialog')).toBeTruthy();
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'mindroomUi.voice.voiceRecorderDialog.cancel',
        })
      );

      // Finish (✓) in Room B delivers into Room B's editor and deletes journal.
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
      });
      expect(readText(editorB)).toBe('Room B dictated words');
      expect(readText(editorA)).toBe('');
      expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-nav');
      expect(store.get(liveCaptureAtom)).toBeUndefined();
      shell.unmount();
    } finally {
      slot.remove();
    }
  });

  it('does not focus the editor on Finish or Cancel when started unfocused', async () => {
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    try {
      const editor = makeSlateEditor('Draft');
      const store = createStore();
      const { session } = createMockSession();

      renderHarness(editor, store, session);
      const btn = screen.getByLabelText('composer.dictation.label');

      // Finish from unfocused start.
      await act(async () => {
        fireEvent.pointerDown(btn);
        fireEvent.click(btn);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
      });
      expect(readText(editor)).toBe('Draft dictated words');
      expect(focusSpy).not.toHaveBeenCalled();

      // Cancel from unfocused start (confirmed via DiscardCaptureDialog).
      await act(async () => {
        fireEvent.pointerDown(btn);
        fireEvent.click(btn);
      });
      fireEvent.click(screen.getByLabelText('composer.dictation.cancel'));
      await confirmDiscardDialog();
      expect(focusSpy).not.toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('restores focus when started focused via pointerDown or Mod+Shift+D, unless focus moved outside', async () => {
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    try {
      const editor = makeSlateEditor();
      const store = createStore();
      const { session } = createMockSession();

      renderHarness(editor, store, session);
      const input = screen.getByTestId('editor-focus');
      const btn = screen.getByLabelText('composer.dictation.label');

      // pointerDown captures focus even if touch blurs the editor before click fires.
      input.focus();
      await act(async () => {
        fireEvent.pointerDown(btn);
        input.blur();
        fireEvent.click(btn);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
      });
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith(editor);

      // Mod+Shift+D while focused focuses on start and restores focus on Finish.
      focusSpy.mockClear();
      input.focus();
      await act(async () => {
        fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
      });
      expect(focusSpy).toHaveBeenCalledTimes(1);
      focusSpy.mockClear();
      await act(async () => {
        fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
      });
      expect(focusSpy).toHaveBeenCalledTimes(1);

      // Touch release fires pointerup -> pointerleave (buttons: 0) -> click and must keep captured focus.
      focusSpy.mockClear();
      input.focus();
      await act(async () => {
        fireEvent.pointerDown(btn, { buttons: 1 });
        input.blur();
        fireEvent.pointerUp(btn, { buttons: 0 });
        fireEvent.pointerLeave(btn, { buttons: 0 });
        fireEvent.click(btn);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
      });
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith(editor);

      // Dragging off the Dictate button while pressed (buttons: 1) clears pending focus.
      focusSpy.mockClear();
      input.focus();
      fireEvent.pointerDown(btn, { buttons: 1 });
      fireEvent.pointerLeave(btn, { buttons: 1 });
      input.blur();
      await act(async () => {
        fireEvent.click(btn);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
      });
      expect(focusSpy).not.toHaveBeenCalled();

      // Moving focus to a control outside the composer mid-dictation prevents stealing focus.
      focusSpy.mockClear();
      input.focus();
      await act(async () => {
        fireEvent.pointerDown(btn);
        fireEvent.click(btn);
      });
      outside.focus();
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
      });
      expect(focusSpy).not.toHaveBeenCalled();
    } finally {
      outside.remove();
      focusSpy.mockRestore();
    }
  });

  it('gates canSend by phase and local-echo thread and detaches without discarding on unmount', async () => {
    const editor = makeSlateEditor('Draft');
    Transforms.select(editor, { path: [0, 0], offset: 5 });
    const store = createStore();
    const created = [createMockSession(), createMockSession()];
    let index = 0;
    let latest!: RoomInputDictationFeature;
    function Harness({ threadId }: { threadId?: string }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId: '!room:example.org',
        threadId,
        ownerKey: 'composer-1',
        rootRef,
        createSession: () => created[index++]!.session,
      });
      return (
        <div ref={rootRef}>
          {latest.capsule}
          {latest.button}
        </div>
      );
    }
    const view = render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    await act(async () => {
      expect(latest.start()).toBe(true);
    });
    expect(latest.canSend).toBe(true);
    expect(latest.blocksSubmit).toBe(false);

    for (const phase of ['requesting', 'finishing', 'failed'] as const) {
      act(() => created[0]!.setSnap({ phase }));
      expect(latest.canSend).toBe(false);
      expect(latest.blocksSubmit).toBe(true);
      expect(latest.getLiveStatus()).toBe('blocked');
    }

    act(() => created[0]!.setSnap({ phase: 'paused' }));
    expect(latest.canSend).toBe(true);
    view.rerender(
      <Provider store={store}>
        <Harness threadId="~!room:example.org:txn-1" />
      </Provider>
    );
    expect(latest.canSend).toBe(false);
    expect(latest.blocksSubmit).toBe(true);
    expect(latest.detachForSend()).toBeUndefined();

    view.rerender(
      <Provider store={store}>
        <Harness />
      </Provider>
    );
    let detached: ReturnType<RoomInputDictationFeature['detachForSend']>;
    act(() => {
      detached = latest.detachForSend();
    });
    expect(detached!.session).toBe(created[0]!.session);
    expect(detached!.savedSelection).toEqual({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    });
    // Second synchronous detach finds nothing because claimLiveDictation removed liveCaptureAtom.
    expect(latest.detachForSend()).toBeUndefined();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    view.unmount();
    expect(created[0]!.session.discard).not.toHaveBeenCalled();
  });

  it('resolves Mod+Shift+D to a single winner (focused -> thread -> first visible) and guards concurrent presses', async () => {
    const store = createStore();
    const roomEditor = makeSlateEditor('Room');
    const threadEditor = makeSlateEditor('Thread');
    let resolveFinish!: (res: DictationFinishResult) => void;
    const finishPromise = new Promise<DictationFinishResult>((r) => {
      resolveFinish = r;
    });
    const mock = createMockSession({
      initial: { phase: 'recording', elapsedMs: 2_000 },
      journalId: 'j-shortcut',
    });
    mock.setFinishPromise(finishPromise);
    restoreLiveCapture(store, { kind: 'dictation', session: mock.session });

    function MultiComposer({ hidden = false }: { hidden?: boolean }) {
      const roomRef = useRef<HTMLDivElement | null>(null);
      const threadRef = useRef<HTMLDivElement | null>(null);
      const roomFeat = useRoomInputDictation({
        editor: roomEditor,
        roomId: '!room:example.org',
        ownerKey: 'room-composer',
        rootRef: roomRef,
      });
      const threadFeat = useRoomInputDictation({
        editor: threadEditor,
        roomId: '!room:example.org',
        threadId: '$thread-1',
        thread: true,
        ownerKey: 'thread-composer',
        rootRef: threadRef,
      });
      return (
        <div data-hidden={hidden ? 'true' : undefined}>
          <div ref={roomRef}>
            <input data-testid="room-input" />
            {roomFeat.capsule}
          </div>
          <div ref={threadRef}>
            <input data-testid="thread-input" />
            {threadFeat.capsule}
          </div>
        </div>
      );
    }

    // 1. When 0 composers are visible (Settings/Threads/hidden), Mod+Shift+D does nothing.
    const view = render(
      <Provider store={store}>
        <MultiComposer hidden />
      </Provider>
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(mock.session.finish).not.toHaveBeenCalled();

    // 2. When visible and neither focused, thread composer wins; rapid second press is a no-op.
    view.rerender(
      <Provider store={store}>
        <MultiComposer hidden={false} />
      </Provider>
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(mock.session.finish).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFinish({ status: 'completed', text: 'into thread', journalId: 'j-shortcut' });
      await Promise.resolve();
    });
    expect(readText(threadEditor)).toBe('Thread into thread');
    expect(readText(roomEditor)).toBe('Room');

    // 3. When room composer IS focused, room composer beats thread composer.
    const mock2 = createMockSession({ initial: { phase: 'paused', elapsedMs: 3_000 } });
    mock2.setFinishResult({ status: 'completed', text: 'into room' });
    act(() => {
      restoreLiveCapture(store, { kind: 'dictation', session: mock2.session });
    });
    screen.getByTestId('room-input').focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(mock2.session.finish).toHaveBeenCalledTimes(1);
    expect(readText(roomEditor)).toBe('Room into room');
    expect(readText(threadEditor)).toBe('Thread into thread');
    view.unmount();
  });

  it('starts dictation unfocused via Mod+Shift+D, focuses end of draft, allows Escape cancel, and restores focus on Finish', async () => {
    const editor = makeSlateEditor('Draft');
    editor.marks = { spoiler: true };
    expect(editor.selection).toBeNull();
    const store = createStore();
    const { session } = createMockSession();

    renderHarness(editor, store, session);
    const input = screen.getByTestId('editor-focus');
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(document.body);

    const startEvent = new KeyboardEvent('keydown', {
      key: 'D',
      code: 'KeyD',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(startEvent);
    });
    expect(startEvent.defaultPrevented).toBe(true);
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith(editor);
    expect(document.activeElement).toBe(input);
    expect(editor.selection).toEqual({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    });
    expect(editor.marks).toEqual({ spoiler: true });

    // Escape now reaches the focused composer, opens discard confirmation, and restores focus.
    focusSpy.mockClear();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await confirmDiscardDialog();
    expect(session.discard).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith(editor);

    // Starting unfocused again with null selection pins end-of-draft RangeRef so selecting text
    // mid-dictation still appends at the end and restores focus on Finish.
    (document.activeElement as HTMLElement | null)?.blur();
    editor.selection = null;
    expect(document.activeElement).toBe(document.body);
    focusSpy.mockClear();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(focusSpy).toHaveBeenCalledTimes(1);
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    });
    focusSpy.mockClear();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(session.finish).toHaveBeenCalledTimes(1);
    expect(readText(editor)).toBe('Draft dictated words');
    expect(focusSpy).toHaveBeenCalledWith(editor);
  });

  it('targets unfocused Mod+Shift+D start by focused container, else thread, in a multi-composer layout', async () => {
    const store = createStore();
    const roomEditor = makeSlateEditor('Room');
    const threadEditor = makeSlateEditor('Thread');
    const roomMock = createMockSession();
    const threadMock = createMockSession();
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);

    function MultiComposer() {
      const roomContainerRef = useRef<HTMLDivElement | null>(null);
      const roomRef = useRef<HTMLDivElement | null>(null);
      const threadContainerRef = useRef<HTMLDivElement | null>(null);
      const threadRef = useRef<HTMLDivElement | null>(null);
      useRoomInputDictation({
        editor: roomEditor,
        roomId: '!room:example.org',
        ownerKey: 'room-composer',
        rootRef: roomRef,
        containerRef: roomContainerRef,
        createSession: () => roomMock.session,
      });
      useRoomInputDictation({
        editor: threadEditor,
        roomId: '!room:example.org',
        threadId: '$thread-1',
        thread: true,
        ownerKey: 'thread-composer',
        rootRef: threadRef,
        containerRef: threadContainerRef,
        createSession: () => threadMock.session,
      });
      return (
        <div>
          <div ref={roomContainerRef}>
            <button type="button" data-testid="room-timeline">
              Room message
            </button>
            <div ref={roomRef} />
          </div>
          <div ref={threadContainerRef}>
            <button type="button" data-testid="thread-timeline">
              Thread message
            </button>
            <div ref={threadRef} />
          </div>
        </div>
      );
    }

    render(
      <Provider store={store}>
        <MultiComposer />
      </Provider>
    );

    // 1. Nothing focused -> thread composer starts.
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(threadMock.session.start).toHaveBeenCalledTimes(1);
    expect(roomMock.session.start).not.toHaveBeenCalled();
    expect(focusSpy).toHaveBeenLastCalledWith(threadEditor);
    act(() => {
      store.set(liveCaptureAtom, undefined);
    });

    // 2. Focus inside room container (outside composer) -> room composer starts.
    screen.getByTestId('room-timeline').focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(roomMock.session.start).toHaveBeenCalledTimes(1);
    expect(threadMock.session.start).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenLastCalledWith(roomEditor);
    act(() => {
      store.set(liveCaptureAtom, undefined);
    });

    // 3. Focus inside thread container (outside composer) -> thread composer starts.
    screen.getByTestId('thread-timeline').focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
    expect(threadMock.session.start).toHaveBeenCalledTimes(2);
    expect(roomMock.session.start).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenLastCalledWith(threadEditor);
  });

  it('guards unfocused Mod+Shift+D when unconfirmed, blocked, in computer focus, or over an overlay', () => {
    const editor = makeSlateEditor('Draft');
    const store = createStore();
    const { session } = createMockSession();
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);

    const { forceRerender } = renderHarness(editor, store, session);
    const dispatchDictate = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'D',
        code: 'KeyD',
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(event);
      });
      return event;
    };

    // Unconfirmed dictation server.
    serverMock.confirmed = false;
    forceRerender();
    expect(dispatchDictate().defaultPrevented).toBe(false);
    serverMock.confirmed = true;
    forceRerender();

    // Blocked by an active voice capture.
    act(() => {
      store.set(liveCaptureAtom, { kind: 'voice', session: {} as VoiceCaptureSession });
    });
    expect(dispatchDictate().defaultPrevented).toBe(false);
    act(() => {
      store.set(liveCaptureAtom, undefined);
    });

    // Blocked inside start() while a voice auto-send is pending: key is swallowed for a confirmed
    // composer so the browser shortcut does not fire, without starting or focusing.
    act(() => {
      store.set(voiceAutoSendPendingAtom, true);
    });
    expect(dispatchDictate().defaultPrevented).toBe(true);
    act(() => {
      store.set(voiceAutoSendPendingAtom, false);
    });

    // Focus owned by the Computer surface.
    const computerSurface = document.createElement('div');
    computerSurface.setAttribute('data-mindroom-computer-input', 'true');
    const computerBtn = document.createElement('button');
    computerSurface.append(computerBtn);
    document.body.append(computerSurface);
    try {
      computerBtn.focus();
      expect(dispatchDictate().defaultPrevented).toBe(false);
    } finally {
      computerSurface.remove();
    }

    // Overlay (dialog / menu / command palette) is open.
    serverMock.overlay = 'other';
    expect(dispatchDictate().defaultPrevented).toBe(false);

    expect(session.start).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('delivers mid-Finish (✓) text into originating draftKey when navigating away and releases on account switch', async () => {
    const store = createStore();
    const draftKeyA = getRoomInputDraftKey('@alice:example.org', '!roomA:example.org');
    const draftKeyB = getRoomInputDraftKey('@alice:example.org', '!roomB:example.org');
    store.set(roomIdToMsgDraftAtomFamily(draftKeyA), [
      { type: 'paragraph', children: [{ text: 'Hello' }] } as unknown as Descendant,
    ]);

    const editorA = makeSlateEditor('Hello');
    Transforms.select(editorA, { path: [0, 0], offset: 5 });
    const editorB = makeSlateEditor('Room B draft');

    let resolveFinish!: (res: DictationFinishResult) => void;
    const mock = createMockSession({
      initial: { phase: 'recording', elapsedMs: 4_000 },
      journalId: 'j-mid-finish',
    });
    mock.setFinishPromise(
      new Promise<DictationFinishResult>((r) => {
        resolveFinish = r;
      })
    );
    restoreLiveCapture(store, { kind: 'dictation', session: mock.session });

    function RoomComposer({
      roomId,
      draftKey,
      editor,
    }: {
      roomId: string;
      draftKey: string;
      editor: Editor;
    }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      const feat = useRoomInputDictation({
        editor,
        roomId,
        ownerKey: draftKey,
        sendKey: draftKey,
        draftKey,
        rootRef,
      });
      return <div ref={rootRef}>{feat.capsule}</div>;
    }

    const view = render(
      <Provider store={store}>
        <RoomComposer roomId="!roomA:example.org" draftKey={draftKeyA} editor={editorA} />
      </Provider>
    );

    // Click Finish in Room A -> stays in liveCaptureAtom during finishing.
    fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    expect(store.get(liveCaptureAtom)?.kind).toBe('dictation');
    expect(serverMock.deleteCapture).not.toHaveBeenCalled();

    // Navigate away to Room B before Finish completes!
    view.rerender(
      <Provider store={store}>
        <RoomComposer roomId="!roomB:example.org" draftKey={draftKeyB} editor={editorB} />
      </Provider>
    );

    await act(async () => {
      resolveFinish({ status: 'completed', text: 'world', journalId: 'j-mid-finish' });
      await Promise.resolve();
    });

    // Delivered into Room A's persisted draft (merging without duplicating), Room B untouched, journal deleted AFTER.
    const savedDraftA = store.get(roomIdToMsgDraftAtomFamily(draftKeyA));
    expect(savedDraftA.map((node) => Node.string(node)).join('\n')).toBe('Hello world');
    expect(readText(editorB)).toBe('Room B draft');
    expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-mid-finish');
    expect(store.get(liveCaptureAtom)).toBeUndefined();

    // Account switch mid-Finish releases journal without deleting or writing to draft.
    serverMock.deleteCapture.mockClear();
    serverMock.releaseCapture.mockClear();
    let resolveSwitch!: (res: DictationFinishResult) => void;
    const mockSwitch = createMockSession({
      initial: { phase: 'recording', elapsedMs: 2_000 },
      journalId: 'j-acct-switch',
    });
    mockSwitch.setFinishPromise(
      new Promise<DictationFinishResult>((r) => {
        resolveSwitch = r;
      })
    );
    act(() => {
      restoreLiveCapture(store, { kind: 'dictation', session: mockSwitch.session });
    });
    view.rerender(
      <Provider store={store}>
        <RoomComposer roomId="!roomB:example.org" draftKey={draftKeyB} editor={editorB} />
      </Provider>
    );

    fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    act(() => {
      endLiveCapturesOfAccount(store);
    });
    await act(async () => {
      resolveSwitch({
        status: 'completed',
        text: 'lost on switch',
        journalId: 'j-acct-switch',
      });
      await Promise.resolve();
    });
    expect(serverMock.releaseCapture).toHaveBeenCalledWith('j-acct-switch');
    expect(serverMock.deleteCapture).not.toHaveBeenCalled();
    expect(readText(editorB)).toBe('Room B draft');
    view.unmount();
  });

  it('lazily binds client to recovered session only when originApiUrl is unset or matches composer apiUrl', () => {
    const store = createStore();
    const editor = makeSlateEditor();
    serverMock.byRoom.set('!roomA:example.org', {
      available: true,
      confirmed: true,
      apiUrl: 'https://server-a.example/',
      sessions: serverMock.defaultSessions,
    });
    serverMock.byRoom.set('!roomB:example.org', {
      available: true,
      confirmed: true,
      apiUrl: 'https://server-b.example',
      sessions: serverMock.defaultSessions,
    });

    const recoveredFixed = createMockSession({
      initial: { phase: 'paused', recovered: true, elapsedMs: 5_000 },
      originApiUrl: 'https://server-a.example',
      hasClient: false,
    });
    restoreLiveCapture(store, { kind: 'dictation', session: recoveredFixed.session });

    function Composer({ roomId }: { roomId: string }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      useRoomInputDictation({ editor, roomId, ownerKey: roomId, rootRef });
      return <div ref={rootRef} />;
    }

    // Room B has a different apiUrl -> MUST NOT attach client!
    const view = render(
      <Provider store={store}>
        <Composer roomId="!roomB:example.org" />
      </Provider>
    );
    expect(recoveredFixed.session.attachClient).not.toHaveBeenCalled();

    // Room A matches (modulo trailing slash) -> attaches client!
    view.rerender(
      <Provider store={store}>
        <Composer roomId="!roomA:example.org" />
      </Provider>
    );
    expect(recoveredFixed.session.attachClient).toHaveBeenCalledTimes(1);

    // Recovered session with unset originApiUrl attaches in any confirmed room.
    act(() => {
      store.set(liveCaptureAtom, undefined);
    });
    const recoveredUnset = createMockSession({
      initial: { phase: 'paused', recovered: true, elapsedMs: 5_000 },
      originApiUrl: undefined,
      hasClient: false,
    });
    act(() => {
      restoreLiveCapture(store, { kind: 'dictation', session: recoveredUnset.session });
    });
    view.rerender(
      <Provider store={store}>
        <Composer roomId="!roomB:example.org" />
      </Provider>
    );
    expect(recoveredUnset.session.attachClient).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('routes Discard through DiscardCaptureDialog while keeping busy dialog mounted until deletion settles, and cancels 0-audio requesting directly', async () => {
    const store = createStore();
    const editor = makeSlateEditor();

    // 1. Initial requesting with 0 audio cancels directly without confirmation dialog.
    const initialReq = createMockSession({
      initial: { phase: 'requesting', elapsedMs: 0, hasPartialText: false, pendingUploads: 0 },
    });
    restoreLiveCapture(store, { kind: 'dictation', session: initialReq.session });
    const view = renderHarness(editor, store, initialReq.session);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.cancel'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(initialReq.session.discard).toHaveBeenCalledTimes(1);
    expect(store.get(liveCaptureAtom)).toBeUndefined();

    // 2. Resume-requesting with elapsedMs > 0 opens DiscardCaptureDialog and keeps it busy until disk delete resolves.
    let finishDelete!: () => void;
    const resumeReq = createMockSession({
      initial: { phase: 'requesting', elapsedMs: 6_000, hasPartialText: false, pendingUploads: 0 },
    });
    resumeReq.setDiscardPromise(
      new Promise<void>((r) => {
        finishDelete = r;
      })
    );
    act(() => {
      restoreLiveCapture(store, { kind: 'dictation', session: resumeReq.session });
    });

    fireEvent.click(screen.getByLabelText('composer.dictation.cancel'));
    const dialog = screen.getByRole('dialog');
    expect(resumeReq.session.discard).not.toHaveBeenCalled();

    // Confirm Discard: liveCaptureAtom clears synchronously, but dialog stays mounted & busy until deletion settles.
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'mindroomUi.voice.voiceRecorderDialog.discard',
      })
    );
    expect(resumeReq.session.discard).toHaveBeenCalledTimes(1);
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    await act(async () => undefined);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(composersHoldUnsavedWork(store)).toBe(true);

    await act(async () => {
      finishDelete();
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(composersHoldUnsavedWork(store)).toBe(false);

    // 3. Live inline failed bar Discard also opens DiscardCaptureDialog and Insert partial deletes journal after insert.
    const failedLive = createMockSession({
      initial: { phase: 'failed', failedSegments: 1, completedSegments: 1, hasPartialText: true },
      journalId: 'j-partial-live',
    });
    act(() => {
      restoreLiveCapture(store, { kind: 'dictation', session: failedLive.session });
    });
    fireEvent.click(screen.getByText('composer.dictation.discard'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'mindroomUi.voice.voiceRecorderDialog.cancel',
      })
    );
    fireEvent.click(screen.getByText('composer.dictation.insertPartial'));
    expect(readText(editor)).toBe('partial text');
    expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-partial-live');
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    view.unmount();
  });

  it('gates Mic button and start() while session-scoped dictationRestoresAtom or voiceDraftRestoresAtom is in flight', () => {
    const store = createStore();
    const editor = makeSlateEditor();
    const userId = '@alice:example.org';
    const baseUrl = 'https://hs-a.example.org';
    const sessionId = createSessionId(baseUrl, userId);
    const otherSessionId = createSessionId('https://hs-b.example.org', userId);
    const mx = {
      baseUrl,
      getHomeserverUrl: () => baseUrl,
      getUserId: () => userId,
      getRoom: () => null,
    } as unknown as MatrixClient;
    const pendingDict = new Promise<void>(() => undefined);
    const pendingVoice = new Promise<void>(() => undefined);
    store.set(dictationRestoresAtom, new Map([[sessionId, pendingDict]]));

    let latest!: RoomInputDictationFeature;
    function Harness() {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId: '!room:example.org',
        ownerKey: 'composer-1',
        rootRef,
        createSession: () => createMockSession().session,
      });
      return <div ref={rootRef}>{latest.button}</div>;
    }

    const view = render(
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <Harness />
        </MatrixClientProvider>
      </Provider>
    );

    const btn = screen.getByLabelText<HTMLButtonElement>('composer.dictation.label');
    expect(btn.disabled).toBe(true);
    expect(latest.start()).toBe(false);

    // A pending dictation restore for the same MXID on another homeserver does not block this session.
    act(() => {
      store.set(dictationRestoresAtom, new Map([[otherSessionId, pendingDict]]));
    });
    expect(btn.disabled).toBe(false);

    // Dictation restore settled, but voice restore is still in flight -> disabled.
    act(() => {
      store.set(dictationRestoresAtom, new Map([[sessionId, null]]));
      store.set(voiceDraftRestoresAtom, new Map([[userId, pendingVoice]]));
    });
    expect(btn.disabled).toBe(true);
    expect(latest.start()).toBe(false);

    // Both settled -> enabled!
    act(() => {
      store.set(voiceDraftRestoresAtom, new Map([[userId, null]]));
    });
    expect(btn.disabled).toBe(false);
    view.unmount();
  });
  it('binds saved Slate RangeRef to its DictationSession so side-by-side Room + Thread handoffs never reuse a stale selection', async () => {
    const store = createStore();
    const roomEditor = makeSlateEditor('red blue');
    const threadEditor = makeSlateEditor('');

    const mock1 = createMockSession();
    mock1.setFinishResult({ status: 'completed', text: 'first' });
    const mock2 = createMockSession();
    mock2.setFinishResult({ status: 'completed', text: 'second' });
    const sessionQueue = [mock1.session, mock2.session];
    const createSession = vi.fn(() => {
      const next = sessionQueue.shift();
      if (!next) throw new Error('unexpected createSession call');
      return next;
    });

    function SideBySideComposer({
      testId,
      editor,
      ownerKey,
      threadId,
    }: {
      testId: string;
      editor: Editor;
      ownerKey: string;
      threadId?: string;
    }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      const dictation = useRoomInputDictation({
        editor,
        roomId: '!room:example.org',
        threadId,
        ownerKey,
        rootRef,
        createSession,
      });
      return (
        <div ref={rootRef} data-testid={testId}>
          {dictation.button}
          {dictation.capsule}
        </div>
      );
    }

    const view = render(
      <Provider store={store}>
        <SideBySideComposer testId="room-composer" editor={roomEditor} ownerKey="room" />
        <SideBySideComposer
          testId="thread-composer"
          editor={threadEditor}
          ownerKey="thread"
          threadId="$root"
        />
      </Provider>
    );

    const roomEl = screen.getByTestId('room-composer');
    const threadEl = screen.getByTestId('thread-composer');

    // 1. Select "blue" in Room ("red blue") and start dictation 1 in Room.
    Transforms.select(roomEditor, {
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 8 },
    });
    await act(async () => {
      fireEvent.click(within(roomEl).getByLabelText('composer.dictation.label'));
    });
    expect(Editor.rangeRefs(roomEditor).size).toBe(1);

    // 2. Finish dictation 1 in Thread -> Thread gets "first", Room unrefs its stale RangeRef.
    await act(async () => {
      fireEvent.click(within(threadEl).getByLabelText('composer.dictation.finish'));
    });
    expect(readText(threadEditor)).toBe('first');
    expect(readText(roomEditor)).toBe('red blue');
    expect(Editor.rangeRefs(roomEditor).size).toBe(0);

    // 3. Place Room cursor at end ("red blue|"), start dictation 2 in Thread, finish dictation 2 in Room.
    Transforms.select(roomEditor, Editor.end(roomEditor, []));
    await act(async () => {
      fireEvent.click(within(threadEl).getByLabelText('composer.dictation.label'));
    });
    await act(async () => {
      fireEvent.click(within(roomEl).getByLabelText('composer.dictation.finish'));
    });

    // Room inserts at its current end selection ("red blue second") instead of overwriting "blue".
    expect(readText(roomEditor)).toBe('red blue second');
    expect(Editor.rangeRefs(roomEditor).size).toBe(0);
    expect(Editor.rangeRefs(threadEditor).size).toBe(0);
    view.unmount();
  });

  it('binds matching server client to failed detached dictation sessions when opening a matching room so Retry and send succeeds to the original destination', async () => {
    const store = createStore();
    const editorNoDict = makeSlateEditor();
    const editorOther = makeSlateEditor();
    const roomNoDictId = '!room-no-dict:example.org';
    const roomWrongServerId = '!room-wrong:example.org';
    const roomMatchingId = '!room-matching:example.org';

    const wrongSessions = { send: vi.fn() } as unknown as ClientSessions;
    const matchingSend = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: 'Recovered detached speech.', seconds: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const matchingSessions = { send: matchingSend } as unknown as ClientSessions;

    serverMock.byRoom.set(roomNoDictId, {
      available: false,
      confirmed: false,
      apiUrl: undefined,
      sessions: undefined,
    });
    serverMock.byRoom.set(roomWrongServerId, {
      available: true,
      confirmed: true,
      apiUrl: 'https://server-b.example',
      sessions: wrongSessions,
    });
    serverMock.byRoom.set(roomMatchingId, {
      available: true,
      confirmed: true,
      apiUrl: 'https://server-a.example/',
      sessions: matchingSessions,
    });

    const speechFrame = new Float32Array(DICTATION_FRAME_SAMPLES).fill(0.25);
    const session = createDictationSession({
      originApiUrl: 'https://server-a.example',
      recovered: {
        startedAt: 1_000,
        elapsedMs: 2_000,
        capReached: false,
        originApiUrl: 'https://server-a.example',
        records: [
          {
            segment: {
              index: 0,
              seconds: 1,
              overlapped: false,
              cutReason: 'flush',
              leadingQuietFrames: 0,
              trailingQuietFrames: 0,
              pauseBeforeMs: Infinity,
            },
            wav: encodePcm16Wav([speechFrame, speechFrame]),
            status: 'queued',
            retryable: true,
          },
        ],
        groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
        initialSegmentIndex: 1,
        initialActiveFrames: 20,
      },
    });
    expect(session.hasClient()).toBe(false);
    restoreLiveCapture(store, { kind: 'dictation', session });

    const mockRoomNoDict = {
      roomId: roomNoDictId,
      name: 'No Dictation Room',
      hasEncryptionStateEvent: () => false,
      getMembers: () => [],
      currentState: { getStateEvents: () => null },
    } as unknown as Room;
    const mx = {
      baseUrl: 'https://hs.example.org',
      getHomeserverUrl: () => 'https://hs.example.org',
      getUserId: () => '@alice:example.org',
      getRoom: (id: string) => (id === roomNoDictId ? mockRoomNoDict : null),
    } as unknown as MatrixClient;
    const startSendSession = vi.fn(async () => undefined);
    const emptyAttachments: RoomInputAttachmentAccess = {
      snapshot: () => ({ staged: [], enrolled: [], uploads: [] }),
      append: vi.fn(),
      remove: vi.fn(),
      release: vi.fn(),
      enroll: vi.fn(),
      clearEnrollment: vi.fn(),
      protectPasteItems: () => () => undefined,
      subscribe: () => () => undefined,
    };

    let latest!: RoomInputDictationFeature;
    function RoomComposer({ roomId, editor }: { roomId: string; editor: Editor }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId,
        ownerKey: roomId,
        rootRef,
      });
      return (
        <div ref={rootRef}>
          {latest.button}
          {latest.capsule}
        </div>
      );
    }

    // 1. Mount Room without dictation and trigger Finish & Send -> detaches and fails offline.
    const view = render(
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <RoomComposer roomId={roomNoDictId} editor={editorNoDict} />
        </MatrixClientProvider>
      </Provider>
    );

    let detached: ReturnType<RoomInputDictationFeature['detachForSend']>;
    await act(async () => {
      detached = latest.detachForSend();
      expect(detached?.session).toBe(session);
      startDetachedDictationSend({
        store,
        mx,
        ownerKey: roomNoDictId,
        draftKey: roomNoDictId,
        roomName: 'No Dictation Room',
        sendContext: {
          roomId: roomNoDictId,
          room: mockRoomNoDict,
          threadId: undefined,
          replyDraft: undefined,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        composerContext: { roomId: roomNoDictId, threadId: undefined },
        session: detached!.session,
        docSnapshot: structuredClone(editorNoDict.children),
        savedSelection: detached!.savedSelection,
        pendingMarks: null,
        stagedSnapshot: [],
        tracksEnrollment: false,
        midTurnMode: 'auto',
        explicitMidTurnMode: false,
        isMarkdown: true,
        ownUserId: '@alice:example.org',
        parseCommands: false,
        commandsSnapshot: {},
        attachments: emptyAttachments,
        sessions: { startSendSession, restoreText: vi.fn() },
        restoreReplyDraft: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(store.get(detachedDictationSendsAtom).get(roomNoDictId)?.status).toBe('failed');
    });
    expect(session.hasClient()).toBe(false);
    expect(screen.getByText(/Open a room with dictation to retry./)).toBeTruthy();

    // 2. Opening a room with a different server MUST NOT bind the failed detached session.
    view.rerender(
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <RoomComposer roomId={roomWrongServerId} editor={editorOther} />
        </MatrixClientProvider>
      </Provider>
    );
    expect(session.hasClient()).toBe(false);

    // 3. Opening a room with the matching server binds the failed detached session!
    view.rerender(
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <RoomComposer roomId={roomMatchingId} editor={editorOther} />
        </MatrixClientProvider>
      </Provider>
    );
    expect(session.hasClient()).toBe(true);

    // 4. Returning to the original no-dictation room and clicking "Retry and send" sends to roomNoDictId.
    view.rerender(
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <RoomComposer roomId={roomNoDictId} editor={editorNoDict} />
        </MatrixClientProvider>
      </Provider>
    );
    fireEvent.click(screen.getByText('composer.dictation.retryAndSend'));

    await waitFor(() => {
      expect(startSendSession).toHaveBeenCalledTimes(1);
    });
    expect(matchingSend).toHaveBeenCalledTimes(1);
    expect(startSendSession).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ roomId: roomNoDictId }),
        textContent: expect.objectContaining({ body: 'Recovered detached speech.' }),
      })
    );
    expect(store.get(detachedDictationSendsAtom).size).toBe(0);
    view.unmount();
  });

  const makeVoiceFixture = (
    duration: number,
    bar: number,
    missingAudioPartialText?: string
  ): { voiceFile: File; voiceAudio: DictationVoiceAudio; voiceItem: TUploadItem } => {
    const voiceFile = new File([new Uint8Array(64)], 'voice-message.wav', { type: 'audio/wav' });
    const waveform = Array.from({ length: 48 }, () => bar);
    const voiceAudio: DictationVoiceAudio = {
      file: voiceFile,
      duration,
      waveform,
      ...(missingAudioPartialText !== undefined ? { missingAudioPartialText } : {}),
    };
    const voiceItem: TUploadItem = {
      file: voiceFile,
      originalFile: voiceFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false, voiceMessage: { duration, waveform } },
    };
    return { voiceFile, voiceAudio, voiceItem };
  };

  it('attaches failed live dictation as a voice TUploadItem, inserts missingAudioPartialText, prevents double clicks, and deletes journal only after staging', async () => {
    const store = createStore();
    const editor = makeSlateEditor('Draft:');
    Transforms.select(editor, { path: [0, 0], offset: 6 });

    const { voiceFile, voiceAudio, voiceItem } = makeVoiceFixture(
      2_400,
      300,
      'Earlier pruned words.'
    );
    const mock = createMockSession({
      journalId: 'j-attach-ok',
      voiceAudio,
      initial: {
        phase: 'failed',
        failedSegments: 1,
        completedSegments: 1,
        hasPartialText: true,
        hasVoiceAudio: true,
        errorMessage: 'Transcription timed out.',
      },
    });
    store.set(liveCaptureAtom, { kind: 'dictation', session: mock.session });

    let resolvePrep!: (items: TUploadItem[]) => void;
    const prepareVoiceUploadItems = vi.fn(
      () =>
        new Promise<TUploadItem[]>((resolve) => {
          resolvePrep = resolve;
        })
    );
    const appendAttachments = vi.fn();
    const saveDraft = vi.fn();

    renderHarness(editor, store, mock.session, undefined, {
      ownerKey: 'composer-attach',
      prepareVoiceUploadItems,
      appendAttachments,
      saveDraft,
    });

    const attachBtn = screen.getByRole<HTMLButtonElement>('button', {
      name: 'composer.dictation.attachAsVoice',
    });
    expect(attachBtn.disabled).toBe(false);

    // Double-clicking while prep is in flight invokes buildVoiceAudio/prepareVoiceUploadItems only once.
    fireEvent.click(attachBtn);
    await waitFor(() => expect(prepareVoiceUploadItems).toHaveBeenCalledTimes(1));
    expect(attachBtn.disabled).toBe(true);
    fireEvent.click(attachBtn);
    expect(prepareVoiceUploadItems).toHaveBeenCalledTimes(1);
    expect(prepareVoiceUploadItems).toHaveBeenCalledWith(voiceFile, 2_400, voiceAudio.waveform);
    // Session and journal remain untouched until staging finishes.
    expect(mock.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(serverMock.deleteCapture).not.toHaveBeenCalled();
    expect(store.get(liveCaptureAtom)?.session).toBe(mock.session);

    await act(async () => {
      resolvePrep([voiceItem]);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(appendAttachments).toHaveBeenCalledWith('!room:example.org', [voiceItem])
    );
    expect(readText(editor)).toBe('Draft: Earlier pruned words.');
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(mock.session.completeVoiceFallback).toHaveBeenCalledTimes(1);
    expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-attach-ok');
    expect(store.get(liveCaptureAtom)).toBeUndefined();
  });

  it('preserves failed live dictation session and journal on thrown error or prepError, then stages unencrypted voice item on retry', async () => {
    const store = createStore();
    const editor = makeSlateEditor();
    const { voiceFile, voiceAudio, voiceItem } = makeVoiceFixture(1_500, 512);
    const mock = createMockSession({
      journalId: 'j-attach-fail',
      voiceAudio,
      initial: {
        phase: 'failed',
        failedSegments: 1,
        hasVoiceAudio: true,
        errorMessage: 'Server 503',
      },
    });
    store.set(liveCaptureAtom, { kind: 'dictation', session: mock.session });

    let attempt = 0;
    const prepareVoiceUploadItems = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('E2EE key unavailable');
      if (attempt === 2)
        return [{ ...voiceItem, prepError: new Error('Blob prep failed') } as TUploadItem];
      return [voiceItem];
    });
    const appendAttachments = vi.fn();

    renderHarness(editor, store, mock.session, undefined, {
      roomId: '!home-target:example.org',
      ownerKey: 'home-ask',
      sendKey: 'home-ask',
      prepareVoiceUploadItems,
      appendAttachments,
    });

    const clickAttach = () =>
      fireEvent.click(screen.getByRole('button', { name: 'composer.dictation.attachAsVoice' }));

    // 1. Thrown error keeps session in failed phase, preserves journal, and displays error.
    clickAttach();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('E2EE key unavailable')
    );
    expect(appendAttachments).not.toHaveBeenCalled();
    expect(mock.session.completeVoiceFallback).not.toHaveBeenCalled();
    expect(serverMock.deleteCapture).not.toHaveBeenCalled();
    expect(store.get(liveCaptureAtom)?.session).toBe(mock.session);

    // 2. Returned prepError also keeps session and journal intact.
    clickAttach();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Blob prep failed')
    );
    expect(appendAttachments).not.toHaveBeenCalled();
    expect(serverMock.deleteCapture).not.toHaveBeenCalled();

    // 3. Subsequent click succeeds, stages unencrypted voice item, and cleans up journal.
    clickAttach();
    await waitFor(() => expect(appendAttachments).toHaveBeenCalledTimes(1));
    expect(appendAttachments).toHaveBeenCalledWith('!home-target:example.org', [
      expect.objectContaining({
        file: voiceFile,
        encInfo: undefined,
        metadata: {
          markedAsSpoiler: false,
          voiceMessage: { duration: 1_500, waveform: voiceAudio.waveform },
        },
      }),
    ]);
    expect(mock.session.completeVoiceFallback).toHaveBeenCalledTimes(1);
    expect(serverMock.deleteCapture).toHaveBeenCalledWith('j-attach-fail');
    expect(store.get(liveCaptureAtom)).toBeUndefined();
  });

  it('omits Retry and send and Send as voice and names the original room when a staged composer targets a different room', () => {
    const store = createStore();
    const spaceKey = 'space-key';
    const retryAndSend = vi.fn();
    const sendAsVoice = vi.fn();
    const { session } = createMockSession({
      initial: {
        phase: 'failed',
        failedSegments: 1,
        hasVoiceAudio: true,
        errorMessage: 'network error',
      },
    });
    store.set(
      detachedDictationSendsAtom,
      new Map([
        [
          spaceKey,
          {
            ownerKey: spaceKey,
            roomId: '!eng:example.org',
            roomName: 'Engineering',
            status: 'failed',
            session,
            retryAndSend,
            sendAsVoice,
            insertPartial: vi.fn(),
            discard: vi.fn(async () => undefined),
            abort: vi.fn(),
          },
        ],
      ])
    );
    const editor = createEditor();
    const mx = {
      baseUrl: 'https://hs.example.org',
      getHomeserverUrl: () => 'https://hs.example.org',
      getUserId: () => '@alice:example.org',
      getRoom: () => null,
    } as unknown as MatrixClient;
    function StagedComposer({ roomId }: { roomId: string }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      return (
        <div ref={rootRef}>
          {
            useRoomInputDictation({
              editor,
              roomId,
              ownerKey: spaceKey,
              sendKey: spaceKey,
              draftKey: spaceKey,
              rootRef,
            }).capsule
          }
        </div>
      );
    }
    const wrap = (roomId: string) => (
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <StagedComposer roomId={roomId} />
        </MatrixClientProvider>
      </Provider>
    );

    const view = render(wrap('!des:example.org'));
    expect(screen.queryByText('composer.dictation.retryAndSend')).toBeNull();
    expect(screen.queryByText('composer.dictation.sendAsVoice')).toBeNull();
    expect(screen.getByText('composer.dictation.discard')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'composer.dictation.sendFailedOffTarget'
    );

    view.rerender(wrap('!eng:example.org'));
    fireEvent.click(screen.getByText('composer.dictation.retryAndSend'));
    expect(retryAndSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('composer.dictation.sendAsVoice'));
    expect(sendAsVoice).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

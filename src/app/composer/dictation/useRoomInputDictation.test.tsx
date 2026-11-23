// @vitest-environment jsdom
import React, { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Editor, Transforms } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { ReactEditor, withReact } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessions } from '../../computer/clientSessions';
import { activeDictationAtom } from '../roomInputDrafts';
import { liveVoiceRecordingAtom } from '../voice/liveVoiceRecording';
import type { VoiceCaptureSession } from '../voice/voiceCaptureSession';
import type { DictationSession, DictationSnapshot } from './dictationSession';
import { insertDictatedText } from './insertDictatedText';
import { useRoomInputDictation, type RoomInputDictationFeature } from './useRoomInputDictation';

const serverMock = vi.hoisted(
  (): {
    available: boolean;
    overlay: 'none' | 'help' | 'other';
    sessions: ClientSessions;
  } => ({
    available: true,
    overlay: 'none',
    sessions: { send: vi.fn() } as unknown as ClientSessions,
  })
);

vi.mock('../../shortcuts/shortcutDom', () => ({
  openOverlay: () => serverMock.overlay,
}));

vi.mock('./useDictationServer', () => ({
  useDictationServer: () => ({
    available: serverMock.available,
    apiUrl: serverMock.available ? 'https://mr.example' : undefined,
    roomId: '!room:example.org',
    sessions: serverMock.available ? serverMock.sessions : undefined,
  }),
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
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

const makeSlateEditor = (initialText = '') => {
  const editor = withHistory(withReact(createEditor()));
  editor.children = [{ type: 'paragraph', children: [{ text: initialText }] }] as never;
  return editor;
};

const readText = (editor: Editor): string => Editor.string(editor, []);

const createMockSession = () => {
  const listeners = new Set<() => void>();
  let snap: DictationSnapshot = {
    phase: 'idle',
    elapsedMs: 0,
    waveform: [],
    sampleCount: 0,
    pendingUploads: 0,
    failedSegments: 0,
    completedSegments: 0,
    hasPartialText: false,
    previewText: '',
    capReached: false,
    interrupted: false,
    errorMessage: undefined,
  };
  const setSnap = (patch: Partial<DictationSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((fn) => fn());
  };

  let finishResult: Awaited<ReturnType<DictationSession['finish']>> = {
    status: 'completed',
    text: 'dictated words',
  };

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
    pause: vi.fn(async () => {
      setSnap({ phase: 'paused' });
    }),
    resume: vi.fn(async () => {
      setSnap({ phase: 'recording' });
      return true;
    }),
    finish: vi.fn(async () => {
      if (finishResult.status === 'completed') setSnap({ phase: 'idle' });
      else if (finishResult.status === 'failed') setSnap({ phase: 'failed', failedSegments: 1 });
      return finishResult;
    }),
    retryFailed: vi.fn(async () => {
      setSnap({ phase: 'idle' });
      return { status: 'completed' as const, text: 'retried words' };
    }),
    takePartialText: vi.fn(() => {
      setSnap({ phase: 'idle' });
      return 'partial text';
    }),
    discard: vi.fn(() => {
      setSnap({ phase: 'idle' });
    }),
    clearError: vi.fn(() => {
      setSnap({ errorMessage: undefined });
    }),
  };

  return {
    session,
    setSnap,
    setFinishResult: (res: typeof finishResult) => {
      finishResult = res;
    },
  };
};

beforeEach(() => {
  serverMock.available = true;
  serverMock.overlay = 'none';
});

afterEach(() => {
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
      expect(unfocused.selection).toBeNull();
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
});

describe('useRoomInputDictation', () => {
  const renderHarness = (
    editor: Editor,
    store: ReturnType<typeof createStore>,
    session: DictationSession,
    extraChild?: React.ReactNode,
    initialConversationHidden = false
  ) => {
    let latest!: RoomInputDictationFeature;
    function Harness({ conversationHidden }: { conversationHidden: boolean }) {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId: '!room:example.org',
        ownerKey: 'composer-1',
        rootRef,
        conversationHidden,
        createSession: () => session,
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
    const utils = render(
      <Provider store={store}>
        <Harness conversationHidden={initialConversationHidden} />
      </Provider>
    );
    return {
      ...utils,
      setConversationHidden: (hidden: boolean) =>
        utils.rerender(
          <Provider store={store}>
            <Harness conversationHidden={hidden} />
          </Provider>
        ),
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

  it('enforces mutual exclusion with liveVoiceRecordingAtom and activeDictationAtom', async () => {
    const editor = makeSlateEditor('Start');
    Transforms.select(editor, { path: [0, 0], offset: 5 });
    const store = createStore();
    const { session } = createMockSession();

    const { getFeature } = renderHarness(editor, store, session);
    const btn = screen.getByLabelText<HTMLButtonElement>('composer.dictation.label');
    expect(btn.disabled).toBe(false);

    // Voice message recording running -> dictation button disabled and start blocked.
    act(() => {
      store.set(liveVoiceRecordingAtom, {} as VoiceCaptureSession);
    });
    expect(btn.disabled).toBe(true);
    expect(getFeature().start()).toBe(false);

    act(() => {
      store.set(liveVoiceRecordingAtom, undefined);
    });
    expect(btn.disabled).toBe(false);

    // Starting dictation claims activeDictationAtom and sets blocksSubmit.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(store.get(activeDictationAtom)).toBe('composer-1');
    expect(getFeature().blocksSubmit).toBe(true);

    // Finishing inserts text atomically and releases activeDictationAtom.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.finish'));
    });
    expect(readText(editor)).toBe('Start dictated words');
    expect(store.get(activeDictationAtom)).toBeUndefined();
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

    // Escape cancels when focus is inside the composer and returns focus to Slate.
    const focusSpy = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    input.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(session.discard).toHaveBeenCalledTimes(1);
    expect(store.get(activeDictationAtom)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalledWith(editor);
    focusSpy.mockRestore();

    // Start again and finish via Ctrl+Shift+D.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    });
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

  it('pauses active dictation when its mounted composer collapses to 0x0', async () => {
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();
    let resizeCb: ResizeObserverCallback | undefined;
    const prevResizeObserver = globalThis.ResizeObserver;
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCb = cb;
      }

      observe = vi.fn();

      disconnect = vi.fn();

      unobserve = vi.fn();
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: FakeResizeObserver,
    });

    try {
      renderHarness(editor, store, session);
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.label'));
      });
      expect(resizeCb).toBeDefined();

      act(() => {
        resizeCb?.(
          [{ contentRect: { width: 0, height: 0 } } as ResizeObserverEntry],
          {} as ResizeObserver
        );
      });
      expect(session.pause).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: prevResizeObserver,
      });
    }
  });

  it('pauses active dictation when conversationHidden becomes true', async () => {
    const editor = makeSlateEditor();
    const store = createStore();
    const { session } = createMockSession();

    const { setConversationHidden } = renderHarness(editor, store, session);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('composer.dictation.label'));
    });
    expect(session.pause).not.toHaveBeenCalled();

    act(() => {
      setConversationHidden(true);
    });
    expect(session.pause).toHaveBeenCalledTimes(1);
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

      // Cancel from unfocused start.
      await act(async () => {
        fireEvent.pointerDown(btn);
        fireEvent.click(btn);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('composer.dictation.cancel'));
      });
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

      // Mod+Shift+D while focused also restores focus on Finish.
      focusSpy.mockClear();
      input.focus();
      await act(async () => {
        fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
      });
      await act(async () => {
        fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
      });
      expect(focusSpy).toHaveBeenCalledTimes(1);

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
});

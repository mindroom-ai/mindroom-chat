// @vitest-environment jsdom
import React, { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Editor, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import { withReact } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessions } from '../../computer/clientSessions';
import { activeDictationAtom } from '../roomInputDrafts';
import { liveVoiceRecordingAtom } from '../voice/liveVoiceRecording';
import type { VoiceCaptureSession } from '../voice/voiceCaptureSession';
import type { DictationSession, DictationSnapshot } from './dictationSession';
import { insertDictatedText } from './insertDictatedText';
import { useRoomInputDictation, type RoomInputDictationFeature } from './useRoomInputDictation';

const serverMock = vi.hoisted(() => ({
  available: true,
  sessions: { send: vi.fn() } as unknown as ClientSessions,
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
});

describe('useRoomInputDictation', () => {
  const renderHarness = (
    editor: Editor,
    store: ReturnType<typeof createStore>,
    session: DictationSession
  ) => {
    let latest!: RoomInputDictationFeature;
    function Harness() {
      const rootRef = useRef<HTMLDivElement | null>(null);
      latest = useRoomInputDictation({
        editor,
        roomId: '!room:example.org',
        ownerKey: 'composer-1',
        rootRef,
        createSession: () => session,
      });
      return (
        <div ref={rootRef}>
          <input data-testid="editor-focus" />
          {latest.capsule}
          {latest.button}
        </div>
      );
    }
    const utils = render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );
    return { ...utils, getFeature: () => latest };
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

    // Escape cancels while recording.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(session.discard).toHaveBeenCalledTimes(1);
    expect(store.get(activeDictationAtom)).toBeUndefined();

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
});

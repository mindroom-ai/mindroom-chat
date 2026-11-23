import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useAtomValue, useStore } from 'jotai';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { Editor as SlateEditor, type BaseRange, type Editor, type RangeRef } from 'slate';
import { ReactEditor } from 'slate-react';
import { computerOwnsKeyboardEvent } from '../../computer/computerFocus';
import { openOverlay } from '../../shortcuts/shortcutDom';
import { shortcutAttributes } from '../../shortcuts/ShortcutKeys';
import { isComposingKey, matchesShortcut } from '../../shortcuts/shortcuts';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { IconTooltip } from '../../ui/IconTooltip';
import { ComposerIconButton } from '../RoomInput.css';
import { activeDictationAtom, voiceAutoSendPendingAtom } from '../roomInputDrafts';
import { liveVoiceRecordingAtom } from '../voice/liveVoiceRecording';
import { DictationClient } from './api';
import { DictationCapsule } from './DictationCapsule';
import {
  createDictationSession,
  type DictationSession,
  type DictationSessionOptions,
  type DictationSnapshot,
} from './dictationSession';
import { insertDictatedText } from './insertDictatedText';
import { useDictationServer } from './useDictationServer';

export type UseRoomInputDictationOptions = {
  editor: Editor;
  roomId: string;
  ownerKey: string;
  rootRef: RefObject<HTMLElement | null>;
  conversationHidden?: boolean;
  createSession?: (opts: DictationSessionOptions) => DictationSession;
};

export type RoomInputDictationFeature = {
  available: boolean;
  blocksSubmit: boolean;
  active: boolean;
  disabled: boolean;
  label: string;
  button: ReactNode;
  capsule: ReactNode;
  start: () => boolean;
};

const IDLE_SNAPSHOT: DictationSnapshot = {
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

const noopSubscribe = () => () => undefined;
const keepTextFocus = (event: MouseEvent) => event.preventDefault();

const isEditorFocused = (editor: Editor, rootRef: RefObject<HTMLElement | null>): boolean => {
  const activeEl = document.activeElement;
  try {
    if (ReactEditor.isFocused(editor)) return true;
    return Boolean(activeEl && ReactEditor.toDOMNode(editor, editor).contains(activeEl));
  } catch {
    // Editor may not be attached to a DOM tree in headless unit tests.
    return Boolean(activeEl && rootRef.current?.contains(activeEl) && !activeEl.closest('button'));
  }
};

export const useRoomInputDictation = ({
  editor,
  roomId,
  ownerKey,
  rootRef,
  conversationHidden = false,
  createSession = createDictationSession,
}: UseRoomInputDictationOptions): RoomInputDictationFeature => {
  const { t } = useTranslation();
  const store = useStore();
  const { available, confirmed, sessions } = useDictationServer(roomId);
  const activeDictation = useAtomValue(activeDictationAtom);
  const liveVoice = useAtomValue(liveVoiceRecordingAtom);
  const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);

  const selectionRef = useRef<RangeRef | null>(null);
  const pendingButtonFocusRef = useRef<boolean | undefined>(undefined);
  const shouldRestoreFocusRef = useRef(false);
  const session = useMemo(() => {
    if (!sessions) return undefined;
    return createSession({
      client: new DictationClient(sessions),
      roomId,
    });
  }, [createSession, roomId, sessions]);

  const subscribe = useCallback(
    (listener: () => void) => (session ? session.subscribe(listener) : noopSubscribe()),
    [session]
  );
  const getSnapshot = useCallback(
    () => (session ? session.getSnapshot() : IDLE_SNAPSHOT),
    [session]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const releaseOwnership = useCallback(() => {
    if (store.get(activeDictationAtom) === ownerKey) {
      store.set(activeDictationAtom, undefined);
    }
  }, [ownerKey, store]);

  const clearSelectionRef = useCallback(() => {
    selectionRef.current?.unref();
    selectionRef.current = null;
  }, []);

  const consumeSelectionRef = useCallback((): BaseRange | null => {
    const range = selectionRef.current?.unref() ?? null;
    selectionRef.current = null;
    return range;
  }, []);

  const consumeRestoreFocus = useCallback((): boolean => {
    const shouldRestore = shouldRestoreFocusRef.current;
    shouldRestoreFocusRef.current = false;
    if (!shouldRestore) return false;
    const activeEl = document.activeElement;
    return !activeEl || activeEl === document.body || Boolean(rootRef.current?.contains(activeEl));
  }, [rootRef]);

  const focusEditor = useCallback(() => {
    try {
      ReactEditor.focus(editor);
    } catch {
      // Editor may not be attached to a DOM tree in headless unit tests.
    }
  }, [editor]);

  // Discard and release ownership when this session is replaced or the composer unmounts.
  useEffect(
    () => () => {
      shouldRestoreFocusRef.current = false;
      pendingButtonFocusRef.current = undefined;
      clearSelectionRef();
      session?.discard();
      releaseOwnership();
    },
    [clearSelectionRef, releaseOwnership, session]
  );

  // Account switch or sign-out clears activeDictationAtom externally; abort local capture too.
  useEffect(() => {
    if (activeDictation !== ownerKey && snapshot.phase !== 'idle') {
      shouldRestoreFocusRef.current = false;
      clearSelectionRef();
      session?.discard();
    }
  }, [activeDictation, clearSelectionRef, ownerKey, session, snapshot.phase]);

  const start = useCallback((): boolean => {
    const pendingFocus = pendingButtonFocusRef.current;
    pendingButtonFocusRef.current = undefined;
    if (!confirmed || !session) return false;
    if (
      store.get(liveVoiceRecordingAtom) !== undefined ||
      store.get(voiceAutoSendPendingAtom) ||
      store.get(activeDictationAtom) !== undefined
    ) {
      return false;
    }
    clearSelectionRef();
    if (editor.selection) {
      selectionRef.current = SlateEditor.rangeRef(editor, editor.selection);
    }
    shouldRestoreFocusRef.current = pendingFocus ?? isEditorFocused(editor, rootRef);
    store.set(activeDictationAtom, ownerKey);
    void session.start().then((started) => {
      if (!started) {
        shouldRestoreFocusRef.current = false;
        clearSelectionRef();
        releaseOwnership();
      }
    });
    return true;
  }, [clearSelectionRef, confirmed, editor, ownerKey, releaseOwnership, rootRef, session, store]);

  const handleFinish = useCallback(() => {
    if (!session) return;
    void session.finish().then((result) => {
      if (result.status === 'completed') {
        insertDictatedText(editor, result.text, consumeSelectionRef(), {
          focus: consumeRestoreFocus(),
        });
        releaseOwnership();
      } else if (result.status === 'cancelled') {
        shouldRestoreFocusRef.current = false;
        clearSelectionRef();
        releaseOwnership();
      }
    });
  }, [
    clearSelectionRef,
    consumeRestoreFocus,
    consumeSelectionRef,
    editor,
    releaseOwnership,
    session,
  ]);

  const handleRetry = useCallback(() => {
    if (!session) return;
    void session.retryFailed().then((result) => {
      if (result.status === 'completed') {
        insertDictatedText(editor, result.text, consumeSelectionRef(), {
          focus: consumeRestoreFocus(),
        });
        releaseOwnership();
      } else if (result.status === 'cancelled') {
        shouldRestoreFocusRef.current = false;
        clearSelectionRef();
        releaseOwnership();
      }
    });
  }, [
    clearSelectionRef,
    consumeRestoreFocus,
    consumeSelectionRef,
    editor,
    releaseOwnership,
    session,
  ]);

  const handleInsertPartial = useCallback(() => {
    if (!session) return;
    const text = session.takePartialText();
    insertDictatedText(editor, text, consumeSelectionRef(), {
      focus: consumeRestoreFocus(),
    });
    releaseOwnership();
  }, [consumeRestoreFocus, consumeSelectionRef, editor, releaseOwnership, session]);

  const handleDiscard = useCallback(() => {
    session?.discard();
    clearSelectionRef();
    releaseOwnership();
    if (consumeRestoreFocus()) {
      focusEditor();
    }
  }, [clearSelectionRef, consumeRestoreFocus, focusEditor, releaseOwnership, session]);

  const handlePause = useCallback(() => {
    void session?.pause();
  }, [session]);

  const handleResume = useCallback(() => {
    void session?.resume();
  }, [session]);

  const handleDismissError = useCallback(() => {
    session?.clearError();
  }, [session]);

  // Keyboard shortcuts: Mod+Shift+D starts/finishes (capture); Escape cancels in bubble phase
  // only when no overlay or inline AutocompleteMenu listbox is open to consume it first.
  useEffect(() => {
    if (!confirmed) return undefined;
    const onCaptureKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isComposingKey(event)) return;
      if (!matchesShortcut(event, 'dictate')) return;
      if (computerOwnsKeyboardEvent(event) || openOverlay() !== 'none') return;

      if (snapshot.phase === 'recording' || snapshot.phase === 'paused') {
        event.preventDefault();
        handleFinish();
      } else if (snapshot.phase === 'idle' && rootRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        pendingButtonFocusRef.current = undefined;
        start();
      }
    };
    const onBubbleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || isComposingKey(event)) return;
      if (
        event.key === 'Escape' &&
        (snapshot.phase === 'recording' || snapshot.phase === 'paused') &&
        rootRef.current?.contains(document.activeElement) &&
        rootRef.current.querySelector('[role="listbox"]') === null &&
        openOverlay() === 'none' &&
        !computerOwnsKeyboardEvent(event)
      ) {
        event.preventDefault();
        event.stopPropagation();
        handleDiscard();
      }
    };
    window.addEventListener('keydown', onCaptureKeyDown, true);
    window.addEventListener('keydown', onBubbleKeyDown);
    return () => {
      window.removeEventListener('keydown', onCaptureKeyDown, true);
      window.removeEventListener('keydown', onBubbleKeyDown);
    };
  }, [confirmed, handleDiscard, handleFinish, rootRef, snapshot.phase, start]);

  // Pause active recording when the conversation is covered (Canvas, plugin cover, side panel).
  useEffect(() => {
    if (conversationHidden && snapshot.phase === 'recording') {
      void session?.pause();
    }
  }, [conversationHidden, session, snapshot.phase]);

  // Pause active recording if the mounted composer collapses or hides (e.g. folded thread panel).
  useEffect(() => {
    if (snapshot.phase !== 'recording' || !session || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const node = rootRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect && rect.width === 0 && rect.height === 0) void session.pause();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef, session, snapshot.phase]);

  const active = snapshot.phase !== 'idle';
  const blocksSubmit = active;
  const disabled =
    !confirmed ||
    !session ||
    liveVoice !== undefined ||
    voiceAutoSendPending ||
    activeDictation !== undefined;
  const label = t('composer.dictation.label');

  const button = available ? (
    <IconTooltip label={label} position="Top" shortcut="dictate">
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onPointerDown={() => {
            pendingButtonFocusRef.current = isEditorFocused(editor, rootRef);
          }}
          onPointerLeave={(event: PointerEvent) => {
            if (event.buttons > 0) {
              pendingButtonFocusRef.current = undefined;
            }
          }}
          onPointerCancel={() => {
            pendingButtonFocusRef.current = undefined;
          }}
          onClick={() => {
            start();
          }}
          onMouseDown={keepTextFocus}
          variant="SurfaceVariant"
          size="300"
          radii="300"
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          {...shortcutAttributes('dictate')}
          className={ComposerIconButton}
        >
          <Icon src={Icons.Mic} />
        </IconButton>
      )}
    </IconTooltip>
  ) : null;

  const capsule =
    snapshot.phase !== 'idle' || snapshot.errorMessage !== undefined ? (
      <DictationCapsule
        snapshot={snapshot}
        onCancel={handleDiscard}
        onPause={handlePause}
        onResume={handleResume}
        onFinish={handleFinish}
        onRetry={handleRetry}
        onInsertPartial={handleInsertPartial}
        onDiscard={handleDiscard}
        onDismissError={handleDismissError}
      />
    ) : null;

  return {
    available,
    blocksSubmit,
    active,
    disabled,
    label,
    button,
    capsule,
    start,
  };
};

import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
import { restoreEditorContent } from '../../editor/utils';
import { isLocalEchoEventId } from '../../event-store/threads/threadRouteUtils';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import type { TUploadItem } from '../../matrix/state/upload';
import { openOverlay } from '../../shortcuts/shortcutDom';
import { shortcutAttributes } from '../../shortcuts/ShortcutKeys';
import { isComposingKey, matchesShortcut } from '../../shortcuts/shortcuts';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { IconTooltip } from '../../ui/IconTooltip';
import { ComposerIconButton } from '../RoomInput.css';
import {
  activeDictationAtom,
  detachedDictationErrorAtom,
  detachedDictationSendsAtom,
  voiceAutoSendPendingAtom,
  type IReplyDraft,
} from '../roomInputDrafts';
import { liveVoiceRecordingAtom } from '../voice/liveVoiceRecording';
import { DictationClient } from './api';
import { DictationCapsule } from './DictationCapsule';
import { registerMountedDictationOwner } from './dictationSendHandoff';
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
  threadId?: string;
  ownerKey: string;
  /** Stable composer key across remounts for detached Finish & Send recovery; defaults to ownerKey. */
  sendKey?: string;
  rootRef: RefObject<HTMLElement | null>;
  conversationHidden?: boolean;
  createSession?: (opts: DictationSessionOptions) => DictationSession;
  onCommandProblem?: (problem: string) => void;
  restoreAttachments?: (roomId: string, items: TUploadItem[]) => void;
  restoreReplyDraft?: (replyDraft: IReplyDraft) => void;
  saveDraft?: () => void;
};

export type RoomInputDictationFeature = {
  available: boolean;
  blocksSubmit: boolean;
  canSend: boolean;
  active: boolean;
  disabled: boolean;
  label: string;
  button: ReactNode;
  capsule: ReactNode;
  start: () => boolean;
  getLiveStatus: () => 'idle' | 'sendable' | 'blocked';
  detachForSend: () => { session: DictationSession; savedSelection: BaseRange | null } | undefined;
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
  threadId,
  ownerKey,
  sendKey = ownerKey,
  rootRef,
  conversationHidden = false,
  createSession = createDictationSession,
  onCommandProblem,
  restoreAttachments,
  restoreReplyDraft,
  saveDraft,
}: UseRoomInputDictationOptions): RoomInputDictationFeature => {
  const { t } = useTranslation();
  const store = useStore();
  const { available, confirmed, sessions } = useDictationServer(roomId);
  const activeDictation = useAtomValue(activeDictationAtom);
  const detachedSends = useAtomValue(detachedDictationSendsAtom);
  const detachedEntry = detachedSends.get(sendKey);
  const liveVoice = useAtomValue(liveVoiceRecordingAtom);
  const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);
  const [localNotice, setLocalNotice] = useState<string>();

  const selectionRef = useRef<RangeRef | null>(null);
  const pendingButtonFocusRef = useRef<boolean | undefined>(undefined);
  const shouldRestoreFocusRef = useRef(false);
  const callbacksRef = useLatestRef({
    createSession,
    onCommandProblem,
    restoreAttachments,
    restoreReplyDraft,
    saveDraft,
    t,
  });
  const detachedSessionsRef = useRef(new WeakSet<DictationSession>());
  const [, bumpSession] = useState(0);
  const buildSession = useCallback(
    () =>
      sessions
        ? callbacksRef.current.createSession({ client: new DictationClient(sessions), roomId })
        : undefined,
    [callbacksRef, roomId, sessions]
  );
  const sessionBoxRef = useRef<{
    roomId: string;
    sessions: typeof sessions;
    session: DictationSession | undefined;
  }>({ roomId: '', sessions: undefined, session: undefined });
  if (sessionBoxRef.current.roomId !== roomId || sessionBoxRef.current.sessions !== sessions) {
    sessionBoxRef.current = { roomId, sessions, session: buildSession() };
  }
  const session = sessionBoxRef.current.session;

  const displaySession = detachedEntry?.session ?? session;
  const subscribe = useCallback(
    (listener: () => void) =>
      displaySession ? displaySession.subscribe(listener) : noopSubscribe(),
    [displaySession]
  );
  const getSnapshot = useCallback(
    () => (displaySession ? displaySession.getSnapshot() : IDLE_SNAPSHOT),
    [displaySession]
  );
  const displaySnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const localPhase = detachedEntry ? 'idle' : displaySnapshot.phase;

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

  // Register this mounted composer so background Finish & Send restores or notices reach it.
  useEffect(() => {
    setLocalNotice(undefined);
    if (store.get(detachedDictationErrorAtom)?.ownerKey === sendKey) {
      store.set(detachedDictationErrorAtom, undefined);
    }
    return registerMountedDictationOwner(store, sendKey, {
      restoreText: (fragment) => {
        restoreEditorContent(editor, fragment);
        callbacksRef.current.saveDraft?.();
      },
      restoreReplyDraft: (reply) => callbacksRef.current.restoreReplyDraft?.(reply),
      restoreAttachments: (targetRoomId, items) =>
        callbacksRef.current.restoreAttachments?.(targetRoomId, items),
      onCommandProblem: (unknownCommand) => {
        callbacksRef.current.onCommandProblem?.(
          callbacksRef.current.t('featureUi.room.commandAutocomplete.unknown', {
            command: `/${unknownCommand}`,
          })
        );
      },
      onNoSpeech: () => setLocalNotice(callbacksRef.current.t('composer.dictation.noSpeech')),
    });
  }, [callbacksRef, editor, sendKey, store]);

  // Discard and release ownership when this session is replaced or the composer unmounts,
  // unless it was detached for background Finish & Send.
  useEffect(
    () => () => {
      shouldRestoreFocusRef.current = false;
      pendingButtonFocusRef.current = undefined;
      clearSelectionRef();
      if (session && !detachedSessionsRef.current.has(session)) {
        session.discard();
        releaseOwnership();
      }
    },
    [clearSelectionRef, releaseOwnership, session]
  );

  // Account switch or sign-out clears activeDictationAtom externally; abort local capture too.
  useEffect(() => {
    if (
      activeDictation !== ownerKey &&
      localPhase !== 'idle' &&
      session &&
      !detachedSessionsRef.current.has(session)
    ) {
      shouldRestoreFocusRef.current = false;
      clearSelectionRef();
      session.discard();
    }
  }, [activeDictation, clearSelectionRef, localPhase, ownerKey, session]);

  const start = useCallback((): boolean => {
    const pendingFocus = pendingButtonFocusRef.current;
    pendingButtonFocusRef.current = undefined;
    const liveSession = sessionBoxRef.current.session;
    if (!confirmed || !liveSession) return false;
    if (
      store.get(liveVoiceRecordingAtom) !== undefined ||
      store.get(voiceAutoSendPendingAtom) ||
      store.get(activeDictationAtom) !== undefined ||
      store.get(detachedDictationSendsAtom).has(sendKey)
    ) {
      return false;
    }
    setLocalNotice(undefined);
    clearSelectionRef();
    if (editor.selection) {
      selectionRef.current = SlateEditor.rangeRef(editor, editor.selection);
    }
    shouldRestoreFocusRef.current = pendingFocus ?? isEditorFocused(editor, rootRef);
    store.set(activeDictationAtom, ownerKey);
    void liveSession.start().then((started) => {
      if (!started && !detachedSessionsRef.current.has(liveSession)) {
        shouldRestoreFocusRef.current = false;
        clearSelectionRef();
        releaseOwnership();
      }
    });
    return true;
  }, [clearSelectionRef, confirmed, editor, ownerKey, releaseOwnership, rootRef, sendKey, store]);

  const getLiveStatus = useCallback((): 'idle' | 'sendable' | 'blocked' => {
    if (store.get(detachedDictationSendsAtom).get(sendKey)?.status === 'sending') {
      return 'blocked';
    }
    const liveSession = sessionBoxRef.current.session;
    if (!liveSession || detachedSessionsRef.current.has(liveSession)) return 'idle';
    const phase = liveSession.getSnapshot().phase;
    if (phase === 'idle') return 'idle';
    if ((phase === 'recording' || phase === 'paused') && !isLocalEchoEventId(threadId)) {
      return 'sendable';
    }
    return 'blocked';
  }, [sendKey, store, threadId]);

  const detachForSend = useCallback(() => {
    const liveSession = sessionBoxRef.current.session;
    if (!liveSession || detachedSessionsRef.current.has(liveSession)) return undefined;
    const phase = liveSession.getSnapshot().phase;
    if ((phase !== 'recording' && phase !== 'paused') || isLocalEchoEventId(threadId)) {
      return undefined;
    }
    detachedSessionsRef.current.add(liveSession);
    shouldRestoreFocusRef.current = false;
    pendingButtonFocusRef.current = undefined;
    const savedSelection = consumeSelectionRef();
    sessionBoxRef.current = { roomId, sessions, session: buildSession() };
    bumpSession((n) => n + 1);
    return { session: liveSession, savedSelection };
  }, [buildSession, consumeSelectionRef, roomId, sessions, threadId]);

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
    setLocalNotice(undefined);
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

      if (localPhase === 'recording' || localPhase === 'paused') {
        event.preventDefault();
        handleFinish();
      } else if (localPhase === 'idle' && rootRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        pendingButtonFocusRef.current = undefined;
        start();
      }
    };
    const onBubbleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || isComposingKey(event)) return;
      if (
        event.key === 'Escape' &&
        (localPhase === 'recording' || localPhase === 'paused') &&
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
  }, [confirmed, handleDiscard, handleFinish, localPhase, rootRef, start]);

  // Pause active recording when the conversation is covered (Canvas, plugin cover, side panel).
  useEffect(() => {
    if (conversationHidden && localPhase === 'recording') {
      void session?.pause();
    }
  }, [conversationHidden, localPhase, session]);

  // Pause active recording if the mounted composer collapses or hides (e.g. folded thread panel).
  useEffect(() => {
    if (localPhase !== 'recording' || !session || typeof ResizeObserver === 'undefined') {
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
  }, [localPhase, rootRef, session]);

  const detachedSending = detachedEntry?.status === 'sending';
  const active = localPhase !== 'idle';
  const canSend =
    !detachedEntry &&
    (localPhase === 'recording' || localPhase === 'paused') &&
    !isLocalEchoEventId(threadId);
  const blocksSubmit = detachedSending || (active && !canSend);
  const disabled =
    !confirmed ||
    !session ||
    detachedEntry !== undefined ||
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

  const capsuleSnapshot: DictationSnapshot = detachedEntry
    ? {
        ...displaySnapshot,
        phase: detachedEntry.status === 'failed' ? 'failed' : 'finishing',
      }
    : localNotice && displaySnapshot.phase === 'idle' && !displaySnapshot.errorMessage
    ? { ...displaySnapshot, errorMessage: localNotice }
    : displaySnapshot;

  const capsule =
    capsuleSnapshot.phase !== 'idle' || capsuleSnapshot.errorMessage !== undefined ? (
      <DictationCapsule
        snapshot={capsuleSnapshot}
        sending={detachedEntry !== undefined}
        onCancel={handleDiscard}
        onPause={handlePause}
        onResume={handleResume}
        onFinish={handleFinish}
        onRetry={detachedEntry ? detachedEntry.retryAndSend : handleRetry}
        onInsertPartial={detachedEntry ? detachedEntry.insertPartial : handleInsertPartial}
        onDiscard={detachedEntry ? detachedEntry.discard : handleDiscard}
        onDismissError={handleDismissError}
      />
    ) : null;

  return {
    available,
    blocksSubmit,
    canSend,
    active,
    disabled,
    label,
    button,
    capsule,
    start,
    getLiveStatus,
    detachForSend,
  };
};

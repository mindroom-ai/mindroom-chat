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
import { useAtomValue, useStore, type createStore } from 'jotai';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  Editor as SlateEditor,
  Transforms,
  type BaseRange,
  type Editor,
  type RangeRef,
} from 'slate';
import { ReactEditor } from 'slate-react';
import { resolveComputerApiUrl } from '../../computer/api';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../../computer/computerFocus';
import { restoreEditorContent } from '../../editor/utils';
import { isLocalEchoEventId } from '../../event-store/threads/threadRouteUtils';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { useOptionalMatrixClient } from '../../matrix/hooks/useMatrixClient';
import type { TUploadItem } from '../../matrix/state/upload';
import { openOverlay } from '../../shortcuts/shortcutDom';
import { shortcutAttributes } from '../../shortcuts/ShortcutKeys';
import { isComposingKey, matchesShortcut } from '../../shortcuts/shortcuts';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { IconTooltip } from '../../ui/IconTooltip';
import { deleteCapture, releaseCapture } from '../capture/captureJournal';
import { DiscardCaptureDialog } from '../capture/DiscardCaptureDialog';
import {
  captureAccountGuard,
  captureDiscardsInFlightAtom,
  claimLiveDictation,
  clearLiveCapture,
  discardLiveCapture,
  liveCaptureAtom,
} from '../capture/liveCapture';
import { isComposerShown, pickComposerTarget } from '../composerTarget';
import { ComposerIconButton } from '../RoomInput.css';
import {
  detachedDictationErrorAtom,
  detachedDictationSendsAtom,
  roomIdToMsgDraftAtomFamily,
  voiceAutoSendPendingAtom,
  type DetachedDictationSend,
  type IReplyDraft,
} from '../roomInputDrafts';
import { voiceDraftRestoresAtom } from '../voice/savedVoiceDraft';
import { DictationClient } from './api';
import { DictationCapsule } from './DictationCapsule';
import {
  getMountedOwner,
  mergeDictatedDoc,
  registerMountedDictationOwner,
} from './dictationSendHandoff';
import type {
  DictationSession,
  DictationSessionOptions,
  DictationSnapshot,
} from './dictationSession';
import { insertDictatedText } from './insertDictatedText';
import {
  dictationRestoresAtom,
  getDictationSessionId,
  startLiveDictation,
} from './startLiveDictation';
import { useDictationServer } from './useDictationServer';

export type UseRoomInputDictationOptions = {
  editor: Editor;
  roomId: string;
  threadId?: string;
  /** Whether this composer writes a thread (used to prioritize Mod+Shift+D). */
  thread?: boolean;
  ownerKey: string;
  /** Stable composer key across remounts for detached Finish & Send recovery; defaults to ownerKey. */
  sendKey?: string;
  /** Persisted message draft key for mid-Finish unmounted delivery; defaults to sendKey. */
  draftKey?: string;
  rootRef: RefObject<HTMLElement | null>;
  containerRef?: RefObject<HTMLElement | null>;
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

type JotaiStore = ReturnType<typeof createStore>;

type DictationComposerEntry = {
  store: JotaiStore;
  root: () => HTMLElement | null;
  container?: () => HTMLElement | null;
  thread: boolean;
  confirmed: () => boolean;
  showingLive: () => boolean;
  startFromShortcut: () => boolean;
  finish: () => void;
};

type DiscardTarget =
  | { readonly kind: 'live'; readonly session: DictationSession; readonly restoreFocus: boolean }
  | { readonly kind: 'detached'; readonly entry: DetachedDictationSend };

type SessionSelectionRef = {
  readonly session: DictationSession;
  readonly rangeRef: RangeRef;
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
  recovered: false,
  hasClient: false,
  errorMessage: undefined,
};

const noopSubscribe = () => () => undefined;
const keepTextFocus = (event: MouseEvent) => event.preventDefault();

const mountedComposers = new Set<DictationComposerEntry>();

const canCancelWithoutConfirm = (snap: DictationSnapshot): boolean =>
  snap.phase === 'requesting' &&
  snap.elapsedMs === 0 &&
  !snap.hasPartialText &&
  snap.pendingUploads === 0;

const matchesOriginApiUrl = (
  sessionOriginApiUrl: string | undefined,
  composerApiUrl: string | undefined
): boolean => {
  if (sessionOriginApiUrl === undefined) return true;
  if (composerApiUrl === undefined) return false;
  const normalizedOrigin = resolveComputerApiUrl(sessionOriginApiUrl) ?? sessionOriginApiUrl;
  const normalizedComposer = resolveComputerApiUrl(composerApiUrl) ?? composerApiUrl;
  return normalizedOrigin === normalizedComposer;
};

const onDictationShortcutCapture = (event: KeyboardEvent): void => {
  if (event.defaultPrevented || event.repeat || isComposingKey(event)) return;
  if (!matchesShortcut(event, 'dictate')) return;
  if (
    computerOwnsKeyboardEvent(event) ||
    computerOwnsKeyboardFocus() ||
    openOverlay() !== 'none'
  ) {
    return;
  }

  const visible = [...mountedComposers].reverse().filter((entry) => isComposerShown(entry.root()));
  if (visible.length === 0) return;

  const focused = document.activeElement;
  const liveOwner = visible.find((entry) => entry.store.get(liveCaptureAtom) !== undefined);
  const liveCapture = liveOwner?.store.get(liveCaptureAtom);

  if (liveOwner && liveCapture !== undefined) {
    if (liveCapture.kind !== 'dictation') return;
    const { phase } = liveCapture.session.getSnapshot();
    if (phase !== 'recording' && phase !== 'paused') return;
    const candidates = visible.filter(
      (entry) => entry.store === liveOwner.store && entry.showingLive()
    );
    const winner = pickComposerTarget(candidates, focused);
    if (!winner) return;
    event.preventDefault();
    winner.finish();
    return;
  }

  const winner = pickComposerTarget(visible, focused);
  if (!winner || !winner.confirmed()) return;
  event.preventDefault();
  winner.startFromShortcut();
};

const registerDictationComposer = (entry: DictationComposerEntry): (() => void) => {
  if (mountedComposers.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('keydown', onDictationShortcutCapture, true);
  }
  mountedComposers.add(entry);
  return () => {
    mountedComposers.delete(entry);
    if (mountedComposers.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('keydown', onDictationShortcutCapture, true);
    }
  };
};

const selectEndIfUnselected = (editor: Editor): void => {
  if (editor.selection) return;
  const pendingMarks = editor.marks;
  Transforms.select(editor, SlateEditor.end(editor, []));
  if (pendingMarks) editor.marks = pendingMarks;
};

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
  thread = threadId !== undefined,
  ownerKey,
  sendKey = ownerKey,
  draftKey = sendKey,
  rootRef,
  containerRef,
  createSession,
  onCommandProblem,
  restoreAttachments,
  restoreReplyDraft,
  saveDraft,
}: UseRoomInputDictationOptions): RoomInputDictationFeature => {
  const { t } = useTranslation();
  const store = useStore();
  const mx = useOptionalMatrixClient();
  const userId = mx?.getUserId() ?? undefined;
  const sessionId = getDictationSessionId(mx);
  const { available, confirmed, apiUrl, sessions } = useDictationServer(roomId);
  const detachedSends = useAtomValue(detachedDictationSendsAtom);
  const detachedEntry = detachedSends.get(sendKey);
  const liveCapture = useAtomValue(liveCaptureAtom);
  const liveSession = liveCapture?.kind === 'dictation' ? liveCapture.session : undefined;
  const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);
  const dictationRestores = useAtomValue(dictationRestoresAtom);
  const voiceDraftRestores = useAtomValue(voiceDraftRestoresAtom);
  const discardInFlight = useAtomValue(captureDiscardsInFlightAtom) > 0;
  const [localNotice, setLocalNotice] = useState<string>();
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>();
  const discardDialogWasMountedRef = useRef(false);
  const discardTargetRef = useLatestRef(discardTarget);

  const selectionRef = useRef<SessionSelectionRef | null>(null);
  const finishingSessionRef = useRef<DictationSession | null>(null);
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

  const showingLive = detachedEntry === undefined && liveSession !== undefined;
  const displaySession = detachedEntry?.session ?? liveSession;
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
  const livePhase = showingLive ? displaySnapshot.phase : 'idle';

  const clearSelectionRef = useCallback(() => {
    selectionRef.current?.rangeRef.unref();
    selectionRef.current = null;
  }, []);

  const consumeSelectionRef = useCallback((targetSession: DictationSession): BaseRange | null => {
    const entry = selectionRef.current;
    selectionRef.current = null;
    if (!entry) return null;
    const range = entry.rangeRef.unref();
    return entry.session === targetSession ? range : null;
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
      selectEndIfUnselected(editor);
      ReactEditor.focus(editor);
    } catch {
      // Editor may not be attached to a DOM tree in headless unit tests.
    }
  }, [editor]);

  const restoresPending = useCallback(
    (dictRestores = dictationRestores, voiceRestores = voiceDraftRestores): boolean =>
      (sessionId !== undefined && dictRestores.get(sessionId) != null) ||
      (userId !== undefined && voiceRestores.get(userId) != null),
    [dictationRestores, sessionId, userId, voiceDraftRestores]
  );

  // Release any saved Slate RangeRef once its owning session changes or ends elsewhere.
  useEffect(() => {
    if (
      selectionRef.current &&
      selectionRef.current.session !== liveSession &&
      selectionRef.current.session !== finishingSessionRef.current
    ) {
      clearSelectionRef();
    }
    if (!liveSession && !finishingSessionRef.current && !discardTargetRef.current) {
      shouldRestoreFocusRef.current = false;
    }
  }, [clearSelectionRef, discardTargetRef, liveSession]);

  // Lazy client binding for recovered live or failed detached sessions whose server matches
  // (or had no fixed origin). Checks all detached sends for this account so opening another room
  // with the matching server binds a failed send waiting in a room without dictation.
  useEffect(() => {
    if (!confirmed || !sessions) return;
    const bindMatchingSession = (session: DictationSession | undefined) => {
      if (!session || session.hasClient()) return;
      if (!matchesOriginApiUrl(session.getOriginApiUrl(), apiUrl)) return;
      session.attachClient(new DictationClient(sessions), roomId, apiUrl);
    };
    bindMatchingSession(liveSession);
    detachedSends.forEach((entry) => {
      if (entry.status === 'failed') {
        bindMatchingSession(entry.session);
      }
    });
  }, [apiUrl, confirmed, detachedSends, liveSession, roomId, sessions]);

  // Register this mounted composer so background Finish (✓) and Finish & Send reach a live view.
  useEffect(() => {
    setLocalNotice(undefined);
    if (store.get(detachedDictationErrorAtom)?.ownerKey === sendKey) {
      store.set(detachedDictationErrorAtom, undefined);
    }
    const unregister = registerMountedDictationOwner(store, sendKey, {
      insertDictatedText: (text, focus, targetSession) => {
        const savedSelection = consumeSelectionRef(targetSession);
        const canFocus =
          focus &&
          (!document.activeElement ||
            document.activeElement === document.body ||
            Boolean(rootRef.current?.contains(document.activeElement)));
        if (insertDictatedText(editor, text, savedSelection, { focus: canFocus })) {
          callbacksRef.current.saveDraft?.();
        }
      },
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
    return () => {
      unregister();
      finishingSessionRef.current = null;
      shouldRestoreFocusRef.current = false;
      pendingButtonFocusRef.current = undefined;
      clearSelectionRef();
    };
  }, [callbacksRef, clearSelectionRef, consumeSelectionRef, editor, rootRef, sendKey, store]);

  const start = useCallback(
    ({ fromShortcut = false }: { fromShortcut?: boolean } = {}): boolean => {
      const pendingFocus = pendingButtonFocusRef.current;
      pendingButtonFocusRef.current = undefined;
      if (!confirmed || !sessions) return false;
      if (
        store.get(liveCaptureAtom) !== undefined ||
        store.get(voiceAutoSendPendingAtom) ||
        store.get(detachedDictationSendsAtom).has(sendKey) ||
        restoresPending(store.get(dictationRestoresAtom), store.get(voiceDraftRestoresAtom))
      ) {
        return false;
      }
      setLocalNotice(undefined);
      clearSelectionRef();
      if (fromShortcut) {
        try {
          selectEndIfUnselected(editor);
        } catch {
          // Editor may have an uninitialized tree in headless unit tests.
        }
      }
      const initialSelection = editor.selection;
      shouldRestoreFocusRef.current = fromShortcut
        ? true
        : (pendingFocus ?? isEditorFocused(editor, rootRef));
      const startPromise = startLiveDictation(store, {
        client: new DictationClient(sessions),
        roomId,
        originApiUrl: apiUrl,
        sessionId,
        createSession: callbacksRef.current.createSession,
      });
      const startedCapture = store.get(liveCaptureAtom);
      const startedSession =
        startedCapture?.kind === 'dictation' ? startedCapture.session : undefined;
      if (startedSession && initialSelection) {
        selectionRef.current = {
          session: startedSession,
          rangeRef: SlateEditor.rangeRef(editor, initialSelection),
        };
      }
      if (fromShortcut) focusEditor();
      void startPromise.then((started) => {
        if (started) return;
        if (!startedSession || selectionRef.current?.session === startedSession) {
          clearSelectionRef();
        }
        const current = store.get(liveCaptureAtom);
        if (!current || current.session === startedSession) {
          shouldRestoreFocusRef.current = false;
        }
      });
      return true;
    },
    [
      apiUrl,
      callbacksRef,
      clearSelectionRef,
      confirmed,
      editor,
      focusEditor,
      restoresPending,
      roomId,
      rootRef,
      sendKey,
      sessionId,
      sessions,
      store,
    ]
  );

  const getLiveStatus = useCallback((): 'idle' | 'sendable' | 'blocked' => {
    const currentDetached = store.get(detachedDictationSendsAtom).get(sendKey);
    if (currentDetached) {
      return currentDetached.status === 'sending' ? 'blocked' : 'idle';
    }
    const current = store.get(liveCaptureAtom);
    if (current?.kind !== 'dictation') return 'idle';
    const phase = current.session.getSnapshot().phase;
    if (phase === 'idle') return 'idle';
    if ((phase === 'recording' || phase === 'paused') && !isLocalEchoEventId(threadId)) {
      return 'sendable';
    }
    return 'blocked';
  }, [sendKey, store, threadId]);

  const detachForSend = useCallback(() => {
    if (store.get(detachedDictationSendsAtom).has(sendKey)) return undefined;
    if (isLocalEchoEventId(threadId)) return undefined;
    const current = store.get(liveCaptureAtom);
    if (current?.kind !== 'dictation') return undefined;
    const claimed = claimLiveDictation(store, current.session);
    if (!claimed) return undefined;
    shouldRestoreFocusRef.current = false;
    pendingButtonFocusRef.current = undefined;
    const savedSelection =
      consumeSelectionRef(claimed) ?? (editor.selection ? structuredClone(editor.selection) : null);
    return { session: claimed, savedSelection };
  }, [consumeSelectionRef, editor, sendKey, store, threadId]);

  const completeLiveDictation = useCallback(
    (session: DictationSession, action: 'finish' | 'retry') => {
      if (selectionRef.current && selectionRef.current.session !== session) {
        clearSelectionRef();
      }
      if (!selectionRef.current && editor.selection) {
        selectionRef.current = {
          session,
          rangeRef: SlateEditor.rangeRef(editor, editor.selection),
        };
      }
      finishingSessionRef.current = session;
      const wantedFocus = shouldRestoreFocusRef.current;
      shouldRestoreFocusRef.current = false;
      const sameAccount = captureAccountGuard(store);
      const targetSendKey = sendKey;
      const targetDraftKey = draftKey;
      const promise = action === 'finish' ? session.finish() : session.retryFailed();
      void promise
        .then((result) => {
          if (result.status === 'completed') {
            if (!sameAccount()) {
              if (selectionRef.current?.session === session) clearSelectionRef();
              if (result.journalId) releaseCapture(result.journalId);
              return;
            }
            if (result.text.trim().length > 0) {
              const owner = getMountedOwner(store, targetSendKey);
              if (owner) {
                owner.insertDictatedText(result.text, wantedFocus, session);
              } else {
                const draftAtom = roomIdToMsgDraftAtomFamily(targetDraftKey);
                const currentDraft = store.get(draftAtom);
                const merged = mergeDictatedDoc(currentDraft, result.text, null, null);
                store.set(draftAtom, merged.children);
              }
            } else if (selectionRef.current?.session === session) {
              clearSelectionRef();
            }
            if (result.journalId) void deleteCapture(result.journalId).catch(() => undefined);
            clearLiveCapture(store, session);
          } else if (result.status === 'cancelled') {
            if (!sameAccount()) {
              if (selectionRef.current?.session === session) clearSelectionRef();
              return;
            }
            shouldRestoreFocusRef.current = false;
            if (selectionRef.current?.session === session) clearSelectionRef();
            clearLiveCapture(store, session);
          }
        })
        .finally(() => {
          if (finishingSessionRef.current === session) {
            finishingSessionRef.current = null;
          }
        });
    },
    [clearSelectionRef, draftKey, editor, sendKey, store]
  );

  const getLiveDictationSession = useCallback((): DictationSession | undefined => {
    const current = store.get(liveCaptureAtom);
    return current?.kind === 'dictation' ? current.session : undefined;
  }, [store]);

  const handleFinish = useCallback(() => {
    const current = getLiveDictationSession();
    if (!current) return;
    const { phase } = current.getSnapshot();
    if (phase !== 'recording' && phase !== 'paused') return;
    completeLiveDictation(current, 'finish');
  }, [completeLiveDictation, getLiveDictationSession]);

  const handleRetry = useCallback(() => {
    const current = getLiveDictationSession();
    if (!current || current.getSnapshot().phase !== 'failed') return;
    completeLiveDictation(current, 'retry');
  }, [completeLiveDictation, getLiveDictationSession]);

  const handleInsertPartial = useCallback(() => {
    const current = getLiveDictationSession();
    if (!current) return;
    const { text, journalId } = current.takePartialText();
    if (
      insertDictatedText(editor, text, consumeSelectionRef(current), {
        focus: consumeRestoreFocus(),
      })
    ) {
      callbacksRef.current.saveDraft?.();
    }
    if (journalId) void deleteCapture(journalId).catch(() => undefined);
    clearLiveCapture(store, current);
  }, [
    callbacksRef,
    consumeRestoreFocus,
    consumeSelectionRef,
    editor,
    getLiveDictationSession,
    store,
  ]);

  const handleRequestDiscardLive = useCallback(() => {
    const current = getLiveDictationSession();
    if (!current) return;
    const snap = current.getSnapshot();
    if (snap.phase === 'idle') return;
    if (canCancelWithoutConfirm(snap)) {
      clearSelectionRef();
      const shouldFocus = consumeRestoreFocus();
      void discardLiveCapture(store, current).then(() => {
        if (shouldFocus) focusEditor();
      });
      return;
    }
    setDiscardTarget({
      kind: 'live',
      session: current,
      restoreFocus: consumeRestoreFocus(),
    });
  }, [clearSelectionRef, consumeRestoreFocus, focusEditor, getLiveDictationSession, store]);

  const handleRequestDiscardDetached = useCallback(() => {
    if (!detachedEntry || detachedEntry.status !== 'failed') return;
    setDiscardTarget({ kind: 'detached', entry: detachedEntry });
  }, [detachedEntry]);

  const handleCancelDiscard = useCallback(() => {
    setDiscardTarget((prev) => {
      if (prev?.kind === 'live' && prev.restoreFocus) {
        shouldRestoreFocusRef.current = true;
      }
      return undefined;
    });
  }, []);

  const handleConfirmDiscard = useCallback(async (): Promise<void> => {
    const target = discardTargetRef.current;
    if (!target) return;
    try {
      if (target.kind === 'live') {
        const current = store.get(liveCaptureAtom);
        if (current?.kind !== 'dictation' || current.session !== target.session) return;
        clearSelectionRef();
        await discardLiveCapture(store, target.session);
        if (target.restoreFocus) focusEditor();
      } else {
        if (store.get(detachedDictationSendsAtom).get(sendKey) !== target.entry) return;
        await target.entry.discard();
      }
    } finally {
      setDiscardTarget(undefined);
    }
  }, [clearSelectionRef, discardTargetRef, focusEditor, sendKey, store]);

  const handlePause = useCallback(() => {
    void liveSession?.pause();
  }, [liveSession]);

  const handleResume = useCallback(() => {
    void liveSession?.resume();
  }, [liveSession]);

  const handleDismissError = useCallback(() => {
    setLocalNotice(undefined);
    liveSession?.clearError();
  }, [liveSession]);

  // Register this composer for single-winner Mod+Shift+D resolution.
  const composerEntryRef = useRef<DictationComposerEntry>({} as DictationComposerEntry);
  Object.assign(composerEntryRef.current, {
    store,
    root: () => rootRef.current,
    container: () => containerRef?.current ?? null,
    thread,
    confirmed: () => confirmed,
    showingLive: () =>
      !store.get(detachedDictationSendsAtom).has(sendKey) &&
      store.get(liveCaptureAtom)?.kind === 'dictation',
    startFromShortcut: () => start({ fromShortcut: true }),
    finish: handleFinish,
  });

  useEffect(() => registerDictationComposer(composerEntryRef.current), []);

  // Escape in a focused composer opens DiscardCaptureDialog (or cancels initial 0-audio
  // requesting directly), even in rooms where dictation cannot be started.
  useEffect(() => {
    if (
      !showingLive ||
      (livePhase !== 'requesting' && livePhase !== 'recording' && livePhase !== 'paused')
    ) {
      return undefined;
    }
    const onBubbleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || isComposingKey(event)) return;
      if (
        event.key === 'Escape' &&
        discardTargetRef.current === undefined &&
        rootRef.current?.contains(document.activeElement) &&
        rootRef.current.querySelector('[role="listbox"]') === null &&
        openOverlay() === 'none' &&
        !computerOwnsKeyboardEvent(event)
      ) {
        event.preventDefault();
        event.stopPropagation();
        handleRequestDiscardLive();
      }
    };
    window.addEventListener('keydown', onBubbleKeyDown);
    return () => window.removeEventListener('keydown', onBubbleKeyDown);
  }, [discardTargetRef, handleRequestDiscardLive, livePhase, rootRef, showingLive]);

  const discardDialogOpen =
    discardTarget !== undefined &&
    (discardTarget.kind === 'live'
      ? liveSession === discardTarget.session
      : detachedEntry === discardTarget.entry);

  // Clear stale discard target if the session ended externally while unconfirmed.
  useEffect(() => {
    if (discardTarget !== undefined && !discardDialogOpen && !discardInFlight) {
      setDiscardTarget(undefined);
    }
  }, [discardDialogOpen, discardInFlight, discardTarget]);

  const detachedSending = detachedEntry?.status === 'sending';
  const active = livePhase !== 'idle';
  const canSend =
    !detachedEntry &&
    (livePhase === 'recording' || livePhase === 'paused') &&
    !isLocalEchoEventId(threadId);
  const blocksSubmit = detachedSending || (active && !canSend);
  const disabled =
    !confirmed ||
    !sessions ||
    detachedEntry !== undefined ||
    liveCapture !== undefined ||
    voiceAutoSendPending ||
    restoresPending();
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

  const showCapsule =
    capsuleSnapshot.phase !== 'idle' || capsuleSnapshot.errorMessage !== undefined;
  const keepDiscardDialog =
    discardTarget !== undefined || (discardInFlight && discardDialogWasMountedRef.current);
  discardDialogWasMountedRef.current = keepDiscardDialog;

  const capsule =
    showCapsule || keepDiscardDialog ? (
      <>
        {showCapsule && (
          <DictationCapsule
            snapshot={capsuleSnapshot}
            sending={detachedEntry !== undefined}
            showingLive={showingLive}
            onCancel={handleRequestDiscardLive}
            onPause={handlePause}
            onResume={handleResume}
            onFinish={handleFinish}
            onRetry={detachedEntry ? detachedEntry.retryAndSend : handleRetry}
            onInsertPartial={detachedEntry ? detachedEntry.insertPartial : handleInsertPartial}
            onDiscard={detachedEntry ? handleRequestDiscardDetached : handleRequestDiscardLive}
            onDismissError={handleDismissError}
          />
        )}
        {keepDiscardDialog && (
          <DiscardCaptureDialog
            kind="dictation"
            open={discardDialogOpen}
            onCancel={handleCancelDiscard}
            onDiscard={handleConfirmDiscard}
          />
        )}
      </>
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

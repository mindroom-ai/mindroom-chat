import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { listenForChatUiActions } from './chatUiController';
import { type ChatUiAction, readChatUiAction } from './chatUiProtocol';

export type ChatUiActionOptions = {
  mx: MatrixClient;
  room: Room;
  /** The thread on screen; undefined for the room's main timeline. */
  threadId?: string;
  /** Agents on these homeservers may open their UI on their own, from live requests. */
  autoOpenFromHomeservers?: readonly string[];
  /** Whether the room view can carry out an action now. */
  ready: boolean;
  perform: (action: ChatUiAction) => void;
  /** Shows the conversation an action belongs to: its thread, or the room for none. */
  navigate: (threadId: string | undefined) => void;
  /** Why an action cannot run now, for its button to say; undefined when it can. */
  unavailable: (action: ChatUiAction) => string | undefined;
};

export type ChatUiActions = {
  /** The action a message requests of this viewer, read from the event as it is now. */
  read: (event: MatrixEvent) => ChatUiAction | undefined;
  unavailable: (action: ChatUiAction) => string | undefined;
  /** Runs a message's action on an explicit click, after showing its conversation. */
  activate: (event: MatrixEvent) => void;
};

/** What message buttons use to run MindRoom UI requests (`io.mindroom.ui_action`). */
export const ChatUiActionContext = createContext<ChatUiActions | undefined>(undefined);

const isForeground = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState !== 'hidden' && document.hasFocus();

/**
 * Runs the UI actions agents request (show the computer, a canvas, a settings page, the
 * members). Rendering a request never runs it: a click does, or a live request from an allowed
 * homeserver while the app is in the foreground. An action for another conversation first
 * navigates there and runs once that conversation is on screen.
 */
export const useChatUiActions = (options: ChatUiActionOptions): ChatUiActions => {
  const { mx, room, threadId, autoOpenFromHomeservers, ready } = options;
  // Callbacks of the committed render; a render that suspends or is discarded never replaces them.
  const committed = useRef(options);
  useLayoutEffect(() => {
    committed.current = options;
  });
  const [pending, setPending] = useState<ChatUiAction>();

  const run = useCallback((action: ChatUiAction) => {
    const current = committed.current;
    if (current.unavailable(action)) return;
    if (action.threadId !== current.threadId || !current.ready) {
      setPending(action);
      if (action.threadId !== current.threadId) current.navigate(action.threadId);
      return;
    }
    current.perform(action);
  }, []);

  // A deferred action runs once its conversation is shown.
  useEffect(() => {
    if (!pending || pending.threadId !== threadId || !ready) return;
    setPending(undefined);
    const current = committed.current;
    if (!current.unavailable(pending)) current.perform(pending);
  }, [pending, ready, threadId]);

  // A room change drops whatever was waiting for the old room.
  useEffect(() => {
    setPending(undefined);
  }, [room]);

  useEffect(
    () =>
      listenForChatUiActions({
        mx,
        room,
        threadId,
        autoOpenFromHomeservers,
        onAction: run,
        isForeground,
      }),
    [autoOpenFromHomeservers, mx, room, run, threadId]
  );

  const read = useCallback(
    (event: MatrixEvent) => readChatUiAction(event, mx.getSafeUserId(), room),
    [mx, room]
  );
  // What a button shows follows this render; what runs on an event follows the committed one.
  const { unavailable } = options;
  const activate = useCallback(
    (event: MatrixEvent) => {
      // Membership and authority are read again now; what rendered earlier may be stale.
      const action = read(event);
      if (action) run(action);
    },
    [read, run]
  );

  return useMemo(() => ({ read, unavailable, activate }), [activate, read, unavailable]);
};

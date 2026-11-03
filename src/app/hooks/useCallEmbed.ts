import {
  createContext,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { CallEmbed, ElementWidgetActions } from '../plugins/call';
import { callEmbedAtom } from '../state/callEmbed';
import { useMatrixClient } from './useMatrixClient';
import { useTheme } from './useTheme';
import { useAppLanguageCode } from './useAppLanguageCode';

/** How long a widget may take to confirm a hangup before the call is torn down locally. */
export const CALL_END_FALLBACK_MS = 5000;

const CALL_TITLE_KEY = 'sharedUi.callEmbed.title';

export type CallPreferences = {
  microphone?: boolean;
  video?: boolean;
  sound?: boolean;
};










  return ref;
};

/** The call this tab has joined, if any. */
export const useCallEmbed = (): CallEmbed | undefined => useAtomValue(callEmbedAtom);

/**
 * Starts a call in a room. Rendering never needs the embed container, so the returned function
 * may be created anywhere; it throws when called while no container is mounted.
 */



  const theme = useTheme();
  const language = useAppLanguageCode();
  const containerRef = useContext(CallEmbedRefContext);
  const setCallEmbed = useSetAtom(callEmbedAtom);

  return useCallback(
    (room: Room, preferences?: CallPreferences): CallEmbed => {
      const container = containerRef?.current;
      if (!container) throw new Error('Failed to start call, No embed container element found!');



      const embed = new CallEmbed(mx, room, widget, container, t(CALL_TITLE_KEY), preferences);
      setCallEmbed(embed);
      return embed;
    },
    [mx, t, theme.kind, language, containerRef, setCallEmbed, dm]
  );
};

/** Whether the embed has joined its call; resets when another embed replaces it. */
export const useCallJoined = (embed?: CallEmbed): boolean => {
  const [joinedState, setJoinedState] = useState(() => ({
    embed,
    joined: embed?.joined ?? false,
  }));

  useEffect(() => {
    if (!embed) return undefined;
    setJoinedState({ embed, joined: embed.joined });
    const action = `action:${ElementWidgetActions.JoinCall}`;
    const handleJoin = () => setJoinedState({ embed, joined: true });
    embed.call.on(action, handleJoin);
    return () => {
      embed.call.off(action, handleJoin);
    };
  }, [embed]);

  return joinedState.embed === embed ? joinedState.joined : embed?.joined ?? false;
};

/** Keeps the embed's accessible title in the app language without reloading the call. */
export const useCallEmbedTitleSync = (embed?: CallEmbed): void => {
  const { t } = useTranslation();
  const title = t(CALL_TITLE_KEY);

  useEffect(() => {
    embed?.setTitle(title);
  }, [embed, title]);
};

/** Where the fixed call host covers the container, in viewport coordinates. */
export const getCallEmbedViewportPlacement = (container: HTMLElement) => {
  const rect = container.getBoundingClientRect();
  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
};

type CallEndState = {
  ending: boolean;
  deadline?: ReturnType<typeof setTimeout>;
  finish?: () => void;
  listeners: Set<() => void>;
};

// Shared by every End control of an embed, so they show one request and send one hangup.
const callEndStates = new WeakMap<CallEmbed, CallEndState>();

const getCallEndState = (embed: CallEmbed): CallEndState => {
  let state = callEndStates.get(embed);
  if (!state) {
    state = { ending: false, listeners: new Set() };
    callEndStates.set(embed, state);
  }
  return state;
};

const clearDeadline = (state: CallEndState) => {
  if (state.deadline === undefined) return;
  clearTimeout(state.deadline);
  state.deadline = undefined;
};

const finishCall = (embed: CallEmbed) => {
  const state = getCallEndState(embed);
  clearDeadline(state);
  state.finish?.();
};

const setEnding = (embed: CallEmbed, ending: boolean) => {
  const state = getCallEndState(embed);
  if (state.ending === ending) return;
  state.ending = ending;
  state.listeners.forEach((listener) => listener());
};

/**
 * Ends `embed`'s call. A joined call (`requestHangup`) asks the widget to hang up and finishes
 * when it closes, or after `CALL_END_FALLBACK_MS` by disposing the embed when the widget never
 * answers. A call that has not joined finishes at once.
 */
export const useCallEnd = (
  embed: CallEmbed,
  requestHangup: boolean
): [ending: boolean, endCall: () => void] => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const { listeners } = getCallEndState(embed);
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    [embed]
  );
  const ending = useSyncExternalStore(
    subscribe,
    () => getCallEndState(embed).ending,
    () => false
  );

  const endCall = useCallback(() => {
    const state = getCallEndState(embed);
    if (state.ending) return;
    setEnding(embed, true);
    if (!requestHangup) {
      finishCall(embed);
      return;
    }
    embed.hangup().catch(() => undefined);
    state.deadline = setTimeout(() => {
      state.deadline = undefined;
      embed.dispose();
      finishCall(embed);
    }, CALL_END_FALLBACK_MS);
  }, [embed, requestHangup]);

  return [ending, endCall];
};

/**
 * Finishes `embed`'s call through `finish` when its widget closes, and gives End controls the
 * same `finish`. A newer embed replacing this one cancels the old hangup deadline.
 */
export const useCallEndLifecycle = (embed: CallEmbed, finish: () => void): void => {
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const currentEmbed = useAtomValue(callEmbedAtom);

  useEffect(() => {
    const state = getCallEndState(embed);
    state.finish = () => finishRef.current();
    const action = `action:${ElementWidgetActions.Close}`;
    const handleClose = () => finishCall(embed);
    embed.call.on(action, handleClose);
    return () => {
      embed.call.off(action, handleClose);
      clearDeadline(state);
      state.finish = undefined;
    };
  }, [embed]);

  useEffect(() => {
    if (currentEmbed === embed) return;
    clearDeadline(getCallEndState(embed));
  }, [currentEmbed, embed]);
};

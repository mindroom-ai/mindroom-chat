import {
  createContext,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { IWidgetApiRequest } from 'matrix-widget-api';
import { useSetAtom } from 'jotai';
import {
  CallEmbed,
  CallRoomRetiredError,
  ElementCallThemeKind,
  ElementWidgetActions,
  isCallRoomRetired,
  useClientWidgetApiEvent,
} from '../plugins/call';
import { useMatrixClient } from './useMatrixClient';
import { ThemeKind, useTheme } from './useTheme';
import { callEmbedAtom } from '../state/callEmbed';
import { getCallTermination } from '../state/callTerminationOwner';
import { useResizeObserver } from './useResizeObserver';
import { CallControlState } from '../plugins/call/CallControlState';
import { useCallMembersChange, useCallSession } from './useCall';
import { CallPreferences } from '../state/callPreferences';

const CallEmbedContext = createContext<CallEmbed | undefined>(undefined);

export const CallEmbedContextProvider = CallEmbedContext.Provider;

export const useCallEmbed = (): CallEmbed | undefined => {
  const callEmbed = useContext(CallEmbedContext);

  return callEmbed;
};

const CallEmbedRefContext = createContext<RefObject<HTMLDivElement> | undefined>(undefined);
export const CallEmbedRefContextProvider = CallEmbedRefContext.Provider;
export const useCallEmbedRef = (): RefObject<HTMLDivElement> => {
  const ref = useContext(CallEmbedRefContext);
  if (!ref) {
    throw new Error('CallEmbedRef is not provided!');
  }
  return ref;
};

export const createCallEmbed = (
  mx: MatrixClient,
  room: Room,
  dm: boolean,
  themeKind: ElementCallThemeKind,
  container: HTMLElement,
  pref?: CallPreferences
): CallEmbed => {
  // A retired ephemeral room's kick/leave/forget teardown has already
  // started and can be neither aborted nor undone; a call started here
  // would be torn down from under the user within seconds. This factory is
  // the single chokepoint every call-start surface goes through, which is
  // what makes destructive teardown of retired rooms race-free.
  if (isCallRoomRetired(room.roomId)) {
    throw new CallRoomRetiredError();
  }
  const rtcSession = mx.matrixRTC.getRoomSession(room);
  const ongoing = rtcSession.memberships.length > 0;

  const intent = CallEmbed.getIntent(dm, ongoing, pref?.video);
  const widget = CallEmbed.getWidget(mx, room, intent, themeKind);
  const controlState = pref && new CallControlState(pref.microphone, pref.video, pref.sound);

  const embed = new CallEmbed(mx, room, widget, container, controlState);

  return embed;
};

export const useCallStart = (dm = false) => {
  const mx = useMatrixClient();
  const theme = useTheme();
  const setCallEmbed = useSetAtom(callEmbedAtom);
  // Surfaces like user profiles mount this hook for every rendered user, so a
  // missing CallEmbedRef provider must fail when a call is started (catchable
  // by the caller), never during render of the host surface.
  const callEmbedRef = useContext(CallEmbedRefContext);

  const startCall = useCallback(
    (room: Room, pref?: CallPreferences) => {
      const container = callEmbedRef?.current;
      if (!container) {
        throw new Error('Failed to start call, No embed container element found!');
      }
      const callEmbed = createCallEmbed(mx, room, dm, theme.kind, container, pref);

      setCallEmbed(callEmbed);
    },
    [mx, dm, theme, setCallEmbed, callEmbedRef]
  );

  return startCall;
};

/** User-presentable copy for a call start refused on a retired room. */
export const CALL_ROOM_RETIRED_USER_MESSAGE = 'This call has ended and its room is closing.';

/**
 * Run a call-start attempt from a plain UI event handler. `createCallEmbed`
 * refuses retired rooms by throwing, and a click handler must never throw
 * uncaught. Returns undefined when the call started, or a user-presentable
 * refusal message for surface-appropriate feedback when it did not.
 */
export const attemptCallStart = (start: () => void): string | undefined => {
  try {
    start();
    return undefined;
  } catch (error) {
    console.warn('[call] failed to start the call', error);
    return error instanceof CallRoomRetiredError
      ? CALL_ROOM_RETIRED_USER_MESSAGE
      : 'Failed to start the call.';
  }
};

export const useCallJoined = (embed?: CallEmbed): boolean => {
  const [joined, setJoined] = useState(embed?.joined ?? false);

  useClientWidgetApiEvent(
    embed?.call,
    ElementWidgetActions.JoinCall,
    useCallback(() => {
      setJoined(true);
    }, [])
  );

  useEffect(() => {
    // Keyed to the embed identity: a direct embed→embed replacement must not
    // keep reporting the predecessor's joined state over the successor's
    // pre-join iframe.
    setJoined(embed?.joined ?? false);
  }, [embed]);

  return joined;
};

export type CallTerminationControls = {
  /** True during the bounded shared ending interval across all End surfaces. */
  ending: boolean;
  /** Idempotent End action; repeat presses against an in-flight end are no-ops. */
  endCall: () => void;
};

const CallTerminationContext = createContext<CallTerminationControls | undefined>(undefined);
export const CallTerminationContextProvider = CallTerminationContext.Provider;

export const useCallTermination = (): CallTerminationControls => {
  const controls = useContext(CallTerminationContext);
  if (!controls) {
    throw new Error('CallTermination is not provided!');
  }
  return controls;
};

/**
 * Consumes the shared termination coordinator for the current embed and
 * exposes the `ending`/`endCall` pair used by both End surfaces (CINNY-129).
 * From-widget Hangup marks teardown progress; Close (or the host deadline,
 * or a transport rejection) runs the single idempotent local finalizer.
 *
 * This hook is a pure consumer: the coordinator is created and disposed by
 * the `callEmbedAtom` setter (see `state/callTerminationOwner.ts`), so its
 * lifetime is anchored to the embed's publication, never to React
 * commit/effect timing. Mount, unmount and StrictMode replays of this hook
 * cannot create a duplicate coordinator or kill an in-flight ending — a
 * provider unmount mid-ending leaves the armed deadline alive so the
 * termination still finalizes.
 */
export function useCallTerminationController(callEmbed?: CallEmbed): CallTerminationControls {
  const termination = callEmbed ? getCallTermination(callEmbed) : undefined;

  const acknowledgeWidgetRequest = useCallback(
    (ev: CustomEvent<IWidgetApiRequest>) => {
      // Without an explicit reply, matrix-widget-api auto-responds with an
      // "unsupported action" error while Element Call is mid-leave — the
      // transport stays alive through the whole ending window now.
      ev.preventDefault();
      try {
        callEmbed?.call.transport.reply(ev.detail, {});
      } catch {
        // Best-effort: the transport may already be stopped mid-teardown.
      }
    },
    [callEmbed]
  );

  useClientWidgetApiEvent(
    callEmbed?.call,
    ElementWidgetActions.HangupCall,
    useCallback(
      (ev: CustomEvent<IWidgetApiRequest>) => {
        acknowledgeWidgetRequest(ev);
        termination?.handleWidgetHangup();
      },
      [acknowledgeWidgetRequest, termination]
    )
  );
  useClientWidgetApiEvent(
    callEmbed?.call,
    ElementWidgetActions.Close,
    useCallback(
      (ev: CustomEvent<IWidgetApiRequest>) => {
        acknowledgeWidgetRequest(ev);
        termination?.handleWidgetClose();
      },
      [acknowledgeWidgetRequest, termination]
    )
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => termination?.subscribe(onStoreChange) ?? (() => undefined),
    [termination]
  );
  const getEnding = useCallback(() => termination?.isEnding() ?? false, [termination]);
  const ending = useSyncExternalStore(subscribe, getEnding);
  const endCall = useCallback(() => termination?.endCall(), [termination]);

  return useMemo(() => ({ ending, endCall }), [ending, endCall]);
}

export const useCallMemberSoundSync = (embed: CallEmbed) => {
  const callSession = useCallSession(embed.room);
  useCallMembersChange(
    callSession,
    useCallback(() => embed.control.applySound(), [embed])
  );
};

export const useCallThemeSync = (embed: CallEmbed) => {
  const theme = useTheme();

  useEffect(() => {
    const name: ElementCallThemeKind = theme.kind === ThemeKind.Dark ? 'dark' : 'light';

    embed.setTheme(name);
  }, [theme.kind, embed]);
};

export const getCallEmbedViewportPlacement = (
  container: HTMLDivElement
): { top: string; left: string; width: string; height: string } => {
  const { top, left, width, height } = container.getBoundingClientRect();

  return {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
};

export const useCallEmbedPlacementSync = (containerViewRef: RefObject<HTMLDivElement>): void => {
  const callEmbedRef = useCallEmbedRef();

  const syncCallEmbedPlacement = useCallback(() => {
    const embedEl = callEmbedRef.current;
    const container = containerViewRef.current;
    if (!embedEl || !container) return;

    Object.assign(embedEl.style, getCallEmbedViewportPlacement(container));
  }, [callEmbedRef, containerViewRef]);

  useResizeObserver(
    syncCallEmbedPlacement,
    useCallback(() => containerViewRef.current, [containerViewRef])
  );
};

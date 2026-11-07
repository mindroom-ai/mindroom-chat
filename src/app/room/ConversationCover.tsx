import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Room } from 'matrix-js-sdk';
import { useSetAtom } from 'jotai';
import { ErrorBoundary } from 'react-error-boundary';
import { color } from 'folds';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { useInert } from '../lib/hooks/useInert';
import { tabbablesOf } from '../lib/overlayFocus';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import type { ConversationCover as PluginCover } from '../plugins/conversationCovers';
import { isPluginEnabled } from '../plugins/pluginConfig';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins } from '../plugins/registry';
import { isComposingKey } from '../shortcuts/shortcuts';
import { headerInset } from '../ui/styles/RoomOverlay.css';

/** A plugin's cover and its plugin's tag. */
type TaggedCover = { cover: PluginCover; tag: string };

// Over the conversation, its dock and its composer, which come earlier in the room area at the
// same z-index or below; under the header and its slot (z-index 6).
const LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  insetInline: 0,
  insetBlockStart: headerInset,
  insetBlockEnd: 0,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
  background: color.Background.Container,
  color: color.Background.OnContainer,
  outline: 'none',
};

/** Where the focus is, and the page's selection, which holds the composer's caret. */
const readFocus = () => {
  const selection = document.getSelection();
  return {
    focused: document.activeElement,
    caret: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined,
  };
};

type CoverLayerProps = {
  entry: TaggedCover;
  room: Room;
  conversationRef: RefObject<HTMLElement>;
  onFailure: (thrown: unknown, componentStack?: string | null) => void;
};

/**
 * A cover over the conversation. While it shows, the conversation under it is inert, and read
 * receipts, typing notices and file drops wait (`conversationCoveredAtom`). The focus moves into it
 * as it shows, Tab and Shift+Tab go round inside it, and the focus goes back where it was when it
 * goes, unless the person has moved it elsewhere.
 */
function CoverLayer({ entry: { cover }, room, conversationRef, onFailure }: CoverLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const setCovered = useSetAtom(conversationCoveredAtom);
  // Where the focus was (a click in the cover moves the caret): read as the cover first renders,
  // before a field of its own takes the focus.
  const [before] = useState(readFocus);
  // Before the focus effect: no longer inert when the focus moves back.
  useInert(conversationRef, true);
  useLayoutEffect(() => {
    setCovered(true);
    return () => setCovered(false);
  }, [setCovered]);
  useLayoutEffect(() => {
    // A cover that took over from another (in the next room, or after one that failed) rendered
    // while the focus was in that one, which has given the focus back by now.
    if (!before.focused?.isConnected) Object.assign(before, readFocus());
    const takeFocus = () => {
      const layer = layerRef.current;
      if (layer && !layer.contains(document.activeElement)) layer.focus({ preventScroll: true });
    };
    takeFocus();
    // A composer popover that held the focus (the emoji board) takes it back, then closes as the
    // conversation hides, in the render this commit sets off, and leaves the focus nowhere: the
    // cover takes it then. Focus that went anywhere else stays there.
    queueMicrotask(() => {
      if (!document.activeElement || document.activeElement === document.body) takeFocus();
    });
    // Focus the person moved out of the cover stays there: once this commit is done, React gives
    // the focus back to the element that had it when that is still in the page.
    return () => {
      const { focused, caret } = before;
      if (!(focused instanceof HTMLElement) || !focused.isConnected) return;
      focused.focus({ preventScroll: true });
      // Only a caret in that element: one elsewhere could take the focus with it.
      if (!caret || !focused.contains(caret.startContainer)) return;
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(caret);
    };
  }, [before]);

  // Tab and Shift+Tab go round inside the cover, unless something in it took the key: from its last
  // control (or its first, or itself) the cover moves the focus to the other end. Where the browser
  // still takes it out (past a control it skips, such as Safari's buttons), it comes back to the
  // other end. Keys and focus from layers a component portals elsewhere are theirs.
  const tabbingRef = useRef<{ backwards: boolean }>();
  const controlAt = (backwards: boolean): HTMLElement | undefined => {
    const controls = layerRef.current ? tabbablesOf(layerRef.current) : [];
    // Tab skips a control whose tabindex is negative. A text editor with none, whose `tabIndex`
    // reads -1 all the same, it reaches.
    const inOrder = controls.filter(
      (control) => !control.hasAttribute('tabindex') || control.tabIndex >= 0
    );
    return backwards ? inOrder[inOrder.length - 1] : inOrder[0];
  };
  const keepTabInside = (event: KeyboardEvent) => {
    const layer = layerRef.current;
    if (!layer || event.defaultPrevented || !layer.contains(event.target as Node)) return;
    const backwards = event.shiftKey;
    const active = document.activeElement;
    const end = controlAt(!backwards);
    if (active === end || (backwards && active === layer) || !end) {
      event.preventDefault();
      (controlAt(backwards) ?? layer).focus({ preventScroll: true });
      return;
    }
    tabbingRef.current = { backwards };
    window.setTimeout(() => {
      tabbingRef.current = undefined;
    }, 0);
  };
  const bringTabBack = (event: FocusEvent) => {
    const layer = layerRef.current;
    const tabbing = tabbingRef.current;
    if (!layer || !tabbing || !layer.contains(event.target as Node)) return;
    if (event.relatedTarget instanceof Node && layer.contains(event.relatedTarget)) return;
    tabbingRef.current = undefined;
    // After the browser has finished moving the focus out, which a move now would lose to.
    window.setTimeout(() => {
      (controlAt(tabbing.backwards) ?? layer).focus({ preventScroll: true });
    }, 0);
  };

  // Escape in the cover closes it when its plugin allows, unless something in it took the key or an
  // input method is composing; Escape in a popover its component portals elsewhere is the popover's.
  const closeOnEscape = (event: KeyboardEvent) => {
    if (!cover.close || event.defaultPrevented || isComposingKey(event.nativeEvent)) return;
    if (!layerRef.current?.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      cover.close(room);
    } catch (thrown) {
      onFailure(thrown);
    }
  };

  const { Component } = cover;
  return (
    <div
      ref={layerRef}
      tabIndex={-1}
      data-conversation-cover
      style={LAYER_STYLE}
      onKeyDown={(event) => {
        if (event.key === 'Tab') keepTabInside(event);
        else if (event.key === 'Escape') closeOnEscape(event);
      }}
      onBlur={bringTabBack}
    >
      <ErrorBoundary
        fallback={null}
        onError={(thrown: unknown, info) => onFailure(thrown, info.componentStack)}
      >
        {/* A component that loads its code waits here, not in place of the room. */}
        <Suspense fallback={null}>
          <Component room={room} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

/**
 * What client plugins draw over the room's conversation (docs/architecture.md "Client plugins"):
 * of the `conversationCovers` of the plugins config.json leaves on, the first in build order whose
 * condition holds, under the header and its slot. One that throws (its condition, subscription,
 * close or component) goes and is reported under its plugin's tag, and the next whose condition
 * holds shows instead; the view mounts this afresh in each room, where the failed one tries again.
 */
export function ConversationCover({
  room,
  conversationRef,
}: {
  room: Room;
  /** The conversation the cover hides. */
  conversationRef: RefObject<HTMLElement>;
}) {
  const config = useOptionalClientConfig();
  const enabled = useMemo(
    () =>
      registeredPlugins.flatMap(({ id, tag, conversationCovers }) =>
        isPluginEnabled(config, id)
          ? conversationCovers.map((cover): TaggedCover => ({ cover, tag }))
          : []
      ),
    [config]
  );
  // The covers that failed in this room, each taken away once it has.
  const failedRef = useRef(new Set<TaggedCover>());
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const fail = useCallback(
    (entry: TaggedCover, thrown: unknown, componentStack?: string | null) => {
      failedRef.current.add(entry);
      // eslint-disable-next-line no-console
      console.error(`[plugin ${entry.tag}] its conversation cover failed`, thrown);
      reportBoundaryError(pluginFailure(entry.tag, thrown), componentStack);
      refresh();
    },
    []
  );

  // A condition is asked while the room renders, or as React checks a change, where it cannot fail
  // its cover yet: what it threw waits for the commit, or for the check to end.
  const thrownRef = useRef(new Map<TaggedCover, unknown>());
  const holds = (entry: TaggedCover): boolean => {
    try {
      return entry.cover.covers(room) === true;
    } catch (thrown) {
      thrownRef.current.set(entry, thrown);
      return false;
    }
  };
  const failThrown = useCallback(() => {
    thrownRef.current.forEach((thrown, entry) => fail(entry, thrown));
    thrownRef.current.clear();
  }, [fail]);
  useLayoutEffect(failThrown);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const changed = () => {
        onChange();
        failThrown();
      };
      const stops = enabled.map((entry) => {
        try {
          return entry.cover.subscribe(room, changed);
        } catch (thrown) {
          fail(entry, thrown);
          return undefined;
        }
      });
      return () =>
        stops.forEach((stop, index) => {
          try {
            stop?.();
          } catch (thrown) {
            fail(enabled[index]!, thrown);
          }
        });
    },
    [enabled, fail, failThrown, room]
  );
  const shown = useSyncExternalStore(subscribe, () =>
    enabled.find((entry) => !failedRef.current.has(entry) && holds(entry))
  );

  if (!shown) return null;
  return (
    <CoverLayer
      key={enabled.indexOf(shown)}
      entry={shown}
      room={room}
      conversationRef={conversationRef}
      onFailure={(thrown, componentStack) => fail(shown, thrown, componentStack)}
    />
  );
}

import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
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

/** Whether a cover's condition holds in the room; one that throws does not. */
const holds = ({ cover }: TaggedCover, room: Room): boolean => {
  try {
    return cover.covers(room) === true;
  } catch {
    return false;
  }
};

type CoverLayerProps = {
  entry: TaggedCover;
  room: Room;
  conversationRef: RefObject<HTMLElement>;
  onFailure: () => void;
};

/**
 * A cover over the conversation. While it shows, the conversation under it is inert, and read
 * receipts, typing notices and file drops wait (`conversationCoveredAtom`). The focus moves into it
 * as it shows, and goes back where it was when it goes, unless the person has moved it elsewhere.
 */
function CoverLayer({ entry: { cover, tag }, room, conversationRef, onFailure }: CoverLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const setCovered = useSetAtom(conversationCoveredAtom);
  // Before the focus effect: inert before the focus moves in, no longer when it moves back.
  useInert(conversationRef, true);
  useLayoutEffect(() => {
    setCovered(true);
    return () => setCovered(false);
  }, [setCovered]);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const before = document.activeElement;
    // The page's selection holds the composer's caret, and a click in the cover moves it.
    const selection = document.getSelection();
    const caret = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    if (layer && !layer.contains(before)) layer.focus({ preventScroll: true });
    // Focus the person moved out of the cover stays there: once this commit is done, React gives
    // the focus back to the element that had it when that is still in the page.
    return () => {
      if (!(before instanceof HTMLElement) || !before.isConnected) return;
      before.focus({ preventScroll: true });
      // Only a caret in that element: one elsewhere could take the focus with it.
      if (!caret || !before.contains(caret.startContainer)) return;
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(caret);
    };
  }, []);

  // Escape in the cover closes it when its plugin allows, unless something in it took the key or an
  // input method is composing.
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || isComposingKey(event.nativeEvent))
      return;
    event.preventDefault();
    event.stopPropagation();
    cover.close?.(room);
  };

  const { Component } = cover;
  return (
    <div
      ref={layerRef}
      tabIndex={-1}
      data-conversation-cover
      style={LAYER_STYLE}
      onKeyDown={cover.close ? closeOnEscape : undefined}
    >
      <ErrorBoundary
        fallback={null}
        onError={(thrown: unknown, info) => {
          // eslint-disable-next-line no-console
          console.error(`[plugin ${tag}] its conversation cover failed`, thrown);
          reportBoundaryError(pluginFailure(tag, thrown), info.componentStack);
          onFailure();
        }}
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
 * condition holds, under the header and its slot. One that throws goes and is reported under its
 * plugin's tag, and the next whose condition holds shows instead; the view mounts this afresh in
 * each room, where the failed one tries again.
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
  const [failed, setFailed] = useState<readonly TaggedCover[]>([]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const stops = enabled.map(({ cover }) => {
        try {
          return cover.subscribe(room, onChange);
        } catch {
          return undefined;
        }
      });
      return () =>
        stops.forEach((stop) => {
          try {
            stop?.();
          } catch {
            // A plugin that cannot stop listening only hears changes it no longer needs.
          }
        });
    },
    [enabled, room]
  );
  const shown = useSyncExternalStore(subscribe, () =>
    enabled.find((entry) => !failed.includes(entry) && holds(entry, room))
  );

  if (!shown) return null;
  return (
    <CoverLayer
      key={enabled.indexOf(shown)}
      entry={shown}
      room={room}
      conversationRef={conversationRef}
      onFailure={() => setFailed((list) => [...list, shown])}
    />
  );
}

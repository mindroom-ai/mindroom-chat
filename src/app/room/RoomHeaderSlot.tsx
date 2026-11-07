import type { CSSProperties } from 'react';
import type { Room } from 'matrix-js-sdk';
import { ErrorBoundary } from 'react-error-boundary';
import { color } from 'folds';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { isPluginEnabled } from '../plugins/pluginConfig';
import { registeredPlugins } from '../plugins/registry';

// The conversation scrolls under the header, and under the slot with it.
const SLOT_STYLE: CSSProperties = {
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
};

/** A thrown value as text; String() fails on some objects, such as one without a prototype. */
const textOf = (thrown: unknown): string => {
  try {
    return String(thrown);
  } catch {
    return Object.prototype.toString.call(thrown);
  }
};

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render under the room header`, thrown);
  // A plugin may throw anything, not only an Error.
  const error = thrown instanceof Error ? thrown : new Error(textOf(thrown));
  reportBoundaryError(
    { name: error.name, message: `[plugin ${tag}] ${error.message}`, stack: error.stack },
    componentStack
  );
};

/**
 * What client plugins show under the room header (docs/architecture.md "Client plugins"): the
 * `roomHeaderSlot` components of each plugin config.json leaves on, in build order, across the
 * conversation column. A component that throws shows nothing and is reported under its plugin's
 * tag; each mounts afresh in every room, so one that failed in a room tries again in the next.
 */
export function RoomHeaderSlot({ room }: { room: Room }) {
  const config = useOptionalClientConfig();
  const slot = registeredPlugins.flatMap(({ id, tag, roomHeaderSlot }) =>
    isPluginEnabled(config, id)
      ? roomHeaderSlot.map((Component, index) => (
          <ErrorBoundary
            key={`${room.roomId}:${tag}:${index}`}
            fallback={null}
            onError={(thrown: unknown, info) => reportFailure(tag, thrown, info.componentStack)}
          >
            <Component room={room} />
          </ErrorBoundary>
        ))
      : []
  );
  if (slot.length === 0) return null;
  return <div style={SLOT_STYLE}>{slot}</div>;
}

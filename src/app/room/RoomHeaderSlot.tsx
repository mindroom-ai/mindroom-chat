import type { ComponentProps } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { isPluginEnabled } from '../plugins/pluginConfig';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins, type RoomHeaderSlotComponent } from '../plugins/registry';

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render under the room header`, thrown);
  reportBoundaryError(pluginFailure(tag, thrown), componentStack);
};

/**
 * What client plugins show under the room header (docs/client-plugins.md "Room header slot"): the
 * `roomHeaderSlot` components of each plugin config.json leaves on, in build order, across the
 * conversation column, each given `headerRef`, the element holding the header's row and the slot.
 * The slot paints nothing of its own: it shows that element's surface and text colour.
 * A component that throws shows nothing and is reported under its plugin's tag; each mounts afresh
 * in every room, so one that failed in a room tries again in the next.
 */
export function RoomHeaderSlot({ room, headerRef }: ComponentProps<RoomHeaderSlotComponent>) {
  const config = useOptionalClientConfig();
  const slot = registeredPlugins.flatMap(({ id, tag, roomHeaderSlot }) =>
    isPluginEnabled(config, id)
      ? roomHeaderSlot.map((Component, index) => (
          <ErrorBoundary
            key={`${room.roomId}:${tag}:${index}`}
            fallback={null}
            onError={(thrown: unknown, info) => reportFailure(tag, thrown, info.componentStack)}
          >
            <Component room={room} headerRef={headerRef} />
          </ErrorBoundary>
        ))
      : []
  );
  if (slot.length === 0) return null;
  return <div>{slot}</div>;
}
